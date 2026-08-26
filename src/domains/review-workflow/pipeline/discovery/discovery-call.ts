// One discovery model call, and the failure policy every discovery call shares.
//
// Extracted so the general pass and the dedicated security pass (spec 15) cannot
// drift apart on what "this call failed" means. Each of them is a single model
// response whose loss must cost that response and nothing more.

import {
  ModelHolisticReviewResultSchema,
  type HolisticReviewRunner,
  type TaskReviewInput,
  type WorkflowReviewTask
} from '../agent-contracts.js'
import { createIndivisibleTaskError } from '../packet-budget.js'
import { providerIssueForError, type ProviderIssue } from '../provider-issues.js'
import { isContextLengthExceeded } from '../../../../shared/errors/context-overflow.js'
import {
  isProviderOutputTruncated,
  providerOutputTruncationOrSelf
} from '../../../../shared/errors/output-truncation.js'
import { reduceActiveReadBudget } from './cross-file-tools.js'
import { holisticReviewInputFor } from './review-packet.js'
import { MAX_REACTIVE_SPLIT_DEPTH, splitTaskInputInHalf } from './reactive-split.js'

// Ways a discovery CALL can fail without the review being broken: the agent
// exhausts its step allowance (a tool-enabled call whose model keeps requesting
// reads instead of answering), the model returns output that does not validate,
// the adapter cannot parse a structured object at all, or the response stopped at
// the output-token ceiling. Each is a property of one model response, not of the
// run. Letting any of them propagate fails the whole TASK and loses every finding
// it had — and, in an evaluation, silently drops the case from the comparison,
// which is how a measurement starts lying. Such a call yields no findings and is
// surfaced as a provider issue so the degradation stays visible instead of silent.
// Malformed structured-object JSON belongs here for a specific reason: it is what a
// response truncated mid-array looks like, and one over-long file should degrade to
// a recorded provider issue rather than fail an entire review or evaluation.
//
// `provider_output_truncated` (spec 05, amended 2026-08-17) is the same provider
// event, better diagnosed. `finishReason: 'length'` says the response was cut short
// whether the cut landed mid-token — producing the malformed JSON already listed
// above — or after a complete array element, producing a partial findings list that
// parses cleanly. Splitting one provider event into two run-level outcomes on where
// the cut happened to land is arbitrary, and it punishes the case the engine
// diagnoses better. So the truncated response costs this response, and nothing more.
//
// It is NOT recovered, and that is the whole safety argument: the issue below
// carries `recovered: false`, the quality gate fails on an unrecovered provider
// issue under the default `qualityGate.failOnProviderError`, and a partial review is
// therefore never certified as a clean one. The refusal is the gate declining to
// certify, not the process dying with every other task's completed work in hand.
// Coverage does NOT catch this — it certifies which source BYTES were shown, and a
// truncated answer about fully-shown source leaves coverage `complete`.
const isRecoverableDiscoveryFailure = (error: unknown): boolean =>
  isProviderOutputTruncated(error) ||
  (error instanceof Error &&
    /agent loop budget exceeded|iterations_exceeded|agent output validation failed|malformed structured object json/iu.test(
      error.message
    ))

export type DiscoveryCallResult = {
  readonly findings: readonly unknown[]
  readonly providerIssues: readonly ProviderIssue[]
  // Raw findings returned by each model call this invocation actually issued, in
  // issue order — one entry per LEAF call, so a call the provider refused and that
  // was halved contributes one entry per half rather than one for the whole. The
  // per-call shape is the point (spec 27): the open question is whether findings per
  // file are capped or merely average low, and a total cannot tell those apart.
  // `rawFindingsPerCall.length` is `1 + splitCount` by construction, which is the
  // same call count the debug line has always reported.
  readonly rawFindingsPerCall: readonly number[]
  // How many times this call had to be halved because the provider refused the
  // packet (spec 26). Zero is the expected case and the one worth noticing when it
  // stops being true: a run that split is doing something measurably different from
  // one that did not — several partial reviews instead of one whole-file review —
  // and before this nothing said so.
  readonly splitCount: number
  // How many times this call halved the retriever's per-read byte allowance before
  // retrying (spec 28), carried exactly as `splitCount` is and for the same reason.
  //
  // The retry path returns a result that looks like an ordinary first-attempt
  // success, so a run that strained hard enough to narrow its own reads — twice,
  // three times, down to the 4 000-byte floor — was indistinguishable from one that
  // never strained at all. The reduction is not local to this call either: it
  // mutates the ONE run-wide retriever (`cross-file-tools.ts` says so in as many
  // words), so every other task, including tasks already in flight, gets shorter
  // reads from that point on and nothing restores them. A degradation that changes
  // what every later task is shown has to be countable.
  readonly readBudgetReductionCount: number
  // The tasks a model call was ACTUALLY issued for. For an unsplit call that is the
  // task itself; for a split one it is the leaves, which are the only units that
  // carry a genuine sub-file line span. Admission checks a finding's line against
  // the span its own call was shown, and a synthetic sub-task id matches nothing in
  // the planned task list — so without this the check silently passed for every
  // partition and every reactive half.
  readonly reviewedTasks: readonly WorkflowReviewTask[]
}

const emptyResult = (
  providerIssues: readonly ProviderIssue[]
): DiscoveryCallResult => ({
  findings: [],
  providerIssues,
  splitCount: 0,
  readBudgetReductionCount: 0,
  // A call WAS issued; it just yielded nothing usable. Recording it as a zero-yield
  // call rather than as no call keeps the denominator honest — dropping it would
  // quietly inflate findings-per-call exactly when the provider is degrading.
  rawFindingsPerCall: [0],
  reviewedTasks: []
})

/**
 * Issue one discovery call, halving the task and retrying if the provider refuses
 * the packet as too large (spec 26).
 *
 * `buildText` rather than a prebuilt string: a half is a DIFFERENT task with
 * different context, so its prompt has to be rebuilt from it. Passing the finished
 * text would mean retrying the same oversized packet.
 */
export const runDiscoveryCall = async (
  input: {
    readonly runner: HolisticReviewRunner
    readonly taskInput: TaskReviewInput
    readonly buildText: (taskInput: TaskReviewInput) => string
    readonly signal: AbortSignal | undefined
    readonly stage: string
    readonly depth?: number
  }
): Promise<DiscoveryCallResult> => {
  const task = input.taskInput.task
  const depth = input.depth ?? 0

  try {
    const review = ModelHolisticReviewResultSchema.parse(
      await input.runner(
        holisticReviewInputFor(task, input.buildText(input.taskInput)),
        input.signal
      )
    )

    return {
      findings: review.findings,
      providerIssues: [],
      splitCount: 0,
      readBudgetReductionCount: 0,
      rawFindingsPerCall: [review.findings.length],
      reviewedTasks: [task]
    }
  } catch (error) {
    if (isContextLengthExceeded(error)) {
      // Reads first, splitting second. When the overflow came from a tool result,
      // splitting the task does not help: the halves fetch the same file and
      // overflow identically. Shrinking what a read returns is the only thing that
      // makes the next attempt smaller.
      if (reduceActiveReadBudget()) {
        const retried = await runDiscoveryCall({ ...input, depth })

        // Counted HERE rather than inside the retriever: the retriever halves a
        // number, and only this frame knows that the halving was paid for by a
        // refused provider call. The retry's own count is added to, not replaced,
        // because an overflow that repeats reduces again.
        return {
          ...retried,
          readBudgetReductionCount: retried.readBudgetReductionCount + 1
        }
      }

      return await splitAndRetry({ ...input, depth, error })
    }

    if (!isRecoverableDiscoveryFailure(error)) {
      throw error
    }

    // NOT recovered. The retrying paths above return their own result; reaching
    // here means the call was abandoned and this task contributed no candidates.
    // Reporting that as recovered told a reader the run had coped, and left the
    // quality gate — which fails on an unrecovered issue — with nothing to fire
    // on, so a provider outage read as a clean review.
    // Unwrapped before it is normalized. The normalizer reads the outermost error,
    // and the agent loop may have rewrapped a truncation in a generic failure — in
    // which case the issue would be recorded as `provider_error` and the operator
    // would lose the one remedy that fixes it. Every other failure is passed through
    // unchanged.
    return emptyResult([
      providerIssueForError({
        error: providerOutputTruncationOrSelf(error),
        stage: input.stage,
        recovered: false
      })
    ])
  }
}

const splitAndRetry = async (
  input: {
    readonly runner: HolisticReviewRunner
    readonly taskInput: TaskReviewInput
    readonly buildText: (taskInput: TaskReviewInput) => string
    readonly signal: AbortSignal | undefined
    readonly stage: string
    readonly depth: number
    readonly error: unknown
  }
): Promise<DiscoveryCallResult> => {
  const task = input.taskInput.task
  const halves =
    input.depth >= MAX_REACTIVE_SPLIT_DEPTH
      ? undefined
      : splitTaskInputInHalf(input.taskInput)

  if (halves === undefined) {
    // Bounded by DEPTH, never by a byte size, and terminal rather than truncating:
    // the packet is not trimmed to fit and the task is not silently dropped. The
    // original provider error is kept as the cause so the reason the run stopped
    // stays attributable to the provider that refused it.
    throw createIndivisibleTaskError({
      taskId: task.id,
      splitDepth: input.depth,
      documentCount: task.reviewContext.length
    })
  }

  // Sequential, not concurrent. A task is split precisely because it was too big,
  // and the halves are retried against the same provider under the same rate limit;
  // firing them together turns one oversize failure into a burst. The halves are
  // independent, so their findings simply concatenate.
  const results: DiscoveryCallResult[] = []

  for (const half of halves) {
    results.push(
      await runDiscoveryCall({
        runner: input.runner,
        taskInput: half,
        buildText: input.buildText,
        signal: input.signal,
        stage: input.stage,
        depth: input.depth + 1
      })
    )
  }

  return {
    findings: results.flatMap((result) => result.findings),
    providerIssues: results.flatMap((result) => result.providerIssues),
    // This split, plus any the halves themselves needed.
    splitCount:
      1 + results.reduce((total, result) => total + result.splitCount, 0),
    // The halves' reductions only. Reaching this point means the read budget could
    // NOT be reduced (or there was no scope to reduce), so this split itself
    // contributed none.
    readBudgetReductionCount: results.reduce(
      (total, result) => total + result.readBudgetReductionCount,
      0
    ),
    // The refused call is deliberately NOT an entry: it returned no findings
    // because the provider never read it, and counting it would report a
    // zero-yield look that never happened.
    rawFindingsPerCall: results.flatMap((result) => result.rawFindingsPerCall),
    reviewedTasks: results.flatMap((result) => result.reviewedTasks)
  }
}
