// Spec 19: the un-anchored discovery pass.
//
// WHAT MAKES THIS PASS WORK IS WHAT IT IS NOT SHOWN. The primary discovery call
// is anchored to the diff. That anchor is what makes it precise, and it is also
// why it reports at most one defect per changed region. A controlled experiment
// (2026-07-27, production model, prompt and temperature) measured the mechanism:
// only 16 of 76 candidates from the diff-BEARING arm pointed at a line inside the
// unit they were shown, and one 1251-line file returned the same finding at line
// 820 from all 31 of its units — including the unit covering lines 1201-1251,
// where line 820 was not in the packet at all. The un-anchored arm placed 50 of 50
// candidates inside their own unit.
//
// So the decomposition is not the intervention; withholding the diff is. Running
// exactly this unit decomposition WITH the diff attached was measured and
// recovered almost nothing at N times the cost, because the diff pulled every
// unit's answer back to the same line. If a future change lets diff text back into
// this packet, the pass becomes inert while still costing a call per unit.
//
// The instructions are the primary pass's instructions, unchanged: this pass uses
// the same discovery agent and the same prompt builder, and differs only in what
// it is shown. It asks nothing extra, hints at nothing, and names no defect class.
//
// The same experiment had the un-anchored arm losing 6 of 7 controls: with no diff
// it has no reason to prioritise the changed line. It is a candidate generator,
// not a reviewer. Its candidates are therefore strictly ADDITIVE and feed the
// existing semantic merge, refutation, and admission unchanged.

import {
  TaskReviewInputSchema,
  type HolisticReviewRunner,
  type ReviewContextDocument,
  type TaskReviewInput,
  type WorkflowReviewTask
} from '../agent-contracts.js'
import { providerIssueForError, type ProviderIssue } from '../provider-issues.js'
import { runDiscoveryCall } from './discovery-call.js'
import { buildReviewText } from './review-packet.js'
import { type UnanchoredRunBudget } from './unanchored-run-budget.js'
import {
  unanchoredUnitsForSpan,
  unanchoredUnitText,
  type UnanchoredUnit,
  type UnanchoredUnitGeometry
} from './unanchored-units.js'

// Upper bound on ADDITIONAL candidates the un-anchored pass may contribute per
// task. Sized like the dedicated security pass's cap and for the same reason:
// every candidate costs one downstream refutation slot, and this pass produces
// speculative candidates that the refuter is expected to kill in quantity.
// Exported so the child-agent budget (harness/config.ts) reserves refutation for
// them — under-reserving starves refutation and leaks unfiltered findings.
export const UNANCHORED_MAX_CANDIDATES = 8

// The stage name every un-anchored call is recorded under, so a provider issue
// from this pass is distinguishable from one raised by the general call.
const unanchoredStage = 'holistic_review_unanchored'

export type UnanchoredPassOutcome = {
  // Raw model findings, in unit order. The caller turns them into candidates with
  // the same collection rules every other discovery call goes through, which is
  // where the additive cap and the "never displace an existing location" rule are
  // applied.
  readonly findings: readonly unknown[]
  readonly providerIssues: readonly ProviderIssue[]
  readonly unitsDerived: number
  readonly unitsReviewed: number
}

const isReviewedFileEntry = (
  entry: ReviewContextDocument,
  task: WorkflowReviewTask
): entry is ReviewContextDocument & { readonly path: string } =>
  entry.kind === 'file' &&
  typeof entry.path === 'string' &&
  entry.content.length > 0 &&
  task.paths.includes(entry.path)

/**
 * Builds the packet for one unit.
 *
 * Two properties are load-bearing and both are asserted by tests:
 *
 * 1. The raw diff passed to the prompt builder is the empty string, and the
 *    packet's reviewed range is the unit's own span. Nothing in the packet can
 *    therefore point the reviewer at a changed line, because the packet does not
 *    contain one. This reuses the same builder the "explicit file, no diff"
 *    production path already uses, rather than a second prompt that could drift.
 * 2. Only the unit's own file content is present. A task can carry several files;
 *    leaving the others in would restore the whole-file packet this pass exists to
 *    replace, and would make the declared reviewed range a claim about lines the
 *    reviewer was not being asked to read.
 *
 * Everything that is not source — referenced definitions, the change-intent brief
 * — is carried through untouched. The spec's intervention is withholding the diff,
 * and withholding more than the spec says would be a different experiment.
 */
const unitTaskInputFor = (
  taskInput: TaskReviewInput,
  fileEntry: ReviewContextDocument & { readonly path: string },
  unit: UnanchoredUnit
): TaskReviewInput | undefined => {
  const unitText = unanchoredUnitText(
    fileEntry.content,
    fileEntry.startLine ?? 1,
    unit
  )

  if (unitText.length === 0) {
    return undefined
  }

  const otherContext = taskInput.task.reviewContext.filter(
    (entry) => entry.kind !== 'file'
  )

  return TaskReviewInputSchema.parse({
    ...taskInput,
    reviewedDiffRanges: [
      {
        path: fileEntry.path,
        startLine: unit.startLine,
        endLine: unit.endLine
      }
    ],
    task: {
      ...taskInput.task,
      reviewContext: [
        {
          ...fileEntry,
          startLine: unit.startLine,
          endLine: unit.endLine,
          content: unitText
        },
        ...otherContext
      ]
    }
  })
}

/**
 * Reviews every changed file this task carries as bounded units with the diff
 * withheld, and returns the raw findings for the caller to admit additively.
 *
 * The pass is bounded before it spends anything: the units of a file are derived
 * first, the run budget grants how many of them may actually run, and the pass
 * reviews exactly that many, in order. The budget records what it withheld; this
 * function never truncates on its own, so there is one place that knows about a
 * bound and one place that reports it.
 *
 * A failed unit call costs that unit and is recorded as a recovered provider
 * issue. A review without this pass is a complete review, so nothing here is
 * allowed to become the reason a task fails.
 */
export const runUnanchoredDiscoveryPass = async (
  input: {
    readonly taskInput: TaskReviewInput
    readonly task: WorkflowReviewTask
    readonly geometry: UnanchoredUnitGeometry
    readonly budget: UnanchoredRunBudget
    readonly runReview: HolisticReviewRunner
    readonly signal?: AbortSignal | undefined
  }
): Promise<UnanchoredPassOutcome> => {
  const findings: unknown[] = []
  const providerIssues: ProviderIssue[] = []
  let unitsDerived = 0
  let unitsReviewed = 0

  for (const entry of input.taskInput.task.reviewContext) {
    if (!isReviewedFileEntry(entry, input.task)) {
      continue
    }

    const units = unanchoredUnitsForSpan(
      entry.startLine ?? 1,
      entry.content.split('\n').length,
      input.geometry
    )

    unitsDerived += units.length

    const granted = input.budget.claimUnits(units.length)

    for (const unit of units.slice(0, granted)) {
      // A cancelled run stops issuing units immediately. Without this check a
      // cancellation would keep spending the budget on calls that are already
      // doomed, and would surface as a burst of recovered provider issues rather
      // than as a cancellation.
      if (input.signal?.aborted === true) {
        return { findings, providerIssues, unitsDerived, unitsReviewed }
      }

      const unitTaskInput = unitTaskInputFor(input.taskInput, entry, unit)

      if (unitTaskInput === undefined) {
        continue
      }

      unitsReviewed += 1

      try {
        // The empty raw diff is the intervention. Do not pass the run's diff text
        // here: the configuration that did was measured and recovered almost
        // nothing at N times the cost.
        const result = await runDiscoveryCall(
          input.runReview,
          input.task,
          buildReviewText(unitTaskInput, ''),
          input.signal,
          unanchoredStage
        )

        findings.push(...result.findings)
        providerIssues.push(...result.providerIssues)
      } catch (error) {
        // Spec 19 requires this pass to be non-fatal: a review without it is a
        // complete review, so a failure it cannot classify must not take the task
        // down. Discovery's own policy rethrows an unrecognized error, because
        // losing the general call loses the review; losing this one loses only the
        // extra candidates. The pass stops rather than continuing, since an error
        // the call wrapper did not recognize (an outage, a cancelled run) will
        // repeat for every remaining unit and would otherwise be reported once per
        // unit.
        providerIssues.push(
          providerIssueForError({
            error,
            stage: unanchoredStage,
            recovered: true
          })
        )

        return { findings, providerIssues, unitsDerived, unitsReviewed }
      }
    }
  }

  return { findings, providerIssues, unitsDerived, unitsReviewed }
}
