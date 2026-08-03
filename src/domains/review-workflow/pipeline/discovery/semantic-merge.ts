// Spec 05: the semantic finding merge.
//
// Discovery can describe one defect more than once. It happens inside a single
// call, which restates a defect at neighbouring lines, and it happens whenever a
// second call examines overlapping code — the additive security pass today, a
// decomposed discovery later — because those calls never see each other's
// output. Before this stage existed, merging was deduplication by the
// model-assigned id plus the security pass's `(path, line)` rule, and neither
// asks whether two candidates describe the same defect.
//
// Positional identity was rejected as the test, deliberately. Two findings one
// line apart are frequently one defect, and two findings on the SAME line are
// frequently two defects — a value used without the guard it needs and a wrong
// operator in that same expression are separate problems a reviewer needs both
// of. A line-distance threshold is wrong in both directions, and the direction
// in which it is wrong silently is the one that loses a real defect. So the
// same-defect question is semantic and is answered by a model that reads the
// descriptions.
//
// What the model is asked for is groups, never a discard. Which member of a
// group survives is decided here, deterministically, because that is the
// irreversible half of the decision.

import {
  compareSeverityDescending,
  RejectedFindingSchema,
  type CodeLocation,
  type RejectedFinding
} from '../../../../shared/contracts/index.js'
import { type CandidateFinding } from '../../../admission/index.js'
import {
  ModelSemanticMergeResultSchema,
  SemanticMergeInputSchema,
  semanticMergeGroups,
  type SemanticMergeRunner,
  type WorkflowReviewTask
} from '../agent-contracts.js'
import { providerIssueForError, type ProviderIssue } from '../provider-issues.js'

export type SemanticMergeOutcome = {
  // One terminal `duplicate` rejection per NON-representative group member. This
  // is how a group is reduced to a single admitted finding, and recording the
  // members rather than deleting them is what makes the merge auditable from the
  // report instead of only from a log line: the candidate is still listed among
  // the run's candidates, carrying a rejection that names the candidate it was
  // merged into.
  readonly rejectedFindings: readonly RejectedFinding[]
  readonly providerIssues: readonly ProviderIssue[]
  // Telemetry. `mergeCallCount` and `groupCount` answer two questions that look
  // identical from the outside and have opposite fixes: a merge that is not
  // firing (no calls) versus a merge that fires and finds nothing to group (calls
  // but no groups). Without both numbers the stage cannot be diagnosed at all.
  readonly mergeCallCount: number
  readonly groupCount: number
  readonly groupSizes: readonly number[]
}

type IndexedCandidate = {
  readonly candidate: CandidateFinding
  // Position in the task's candidate list, which is discovery order: the general
  // pass first, then the additive security pass. It is the final tie-break, so
  // the representative of a tied group is stable across identical inputs.
  readonly index: number
}

// Ranks two locations by how precisely they pin the defect, most specific first.
// A bounded span beats an unbounded one and a narrower span beats a wider one,
// because a reader is pointed at less code to inspect; a column-anchored
// location beats a whole-line one for the same reason. Discovery candidates
// carry only a start line today, so this tie-break is usually inert — it exists
// because the rule must be total and deterministic before decomposed discovery
// starts producing candidates with richer locations.
const compareLocationSpecificity = (
  left: CodeLocation,
  right: CodeLocation
): number => {
  const leftSpan =
    left.endLine === undefined
      ? Number.POSITIVE_INFINITY
      : left.endLine - left.startLine
  const rightSpan =
    right.endLine === undefined
      ? Number.POSITIVE_INFINITY
      : right.endLine - right.startLine

  if (leftSpan !== rightSpan) {
    return leftSpan - rightSpan
  }

  const leftColumns = left.startColumn === undefined ? 1 : 0
  const rightColumns = right.startColumn === undefined ? 1 : 0

  return leftColumns - rightColumns
}

// Spec 05's representative rule, in the order it prescribes: highest severity,
// then the most specific location, then the lowest candidate index. It is code
// and not a model judgement because dropping a candidate is the irreversible
// half of a merge.
const representativeOf = (
  group: readonly IndexedCandidate[]
): IndexedCandidate =>
  [...group].sort((left, right) => {
    const bySeverity = compareSeverityDescending(
      left.candidate.severity,
      right.candidate.severity
    )

    if (bySeverity !== 0) {
      return bySeverity
    }

    const bySpecificity = compareLocationSpecificity(
      left.candidate.location,
      right.candidate.location
    )

    return bySpecificity === 0 ? left.index - right.index : bySpecificity
  })[0]!

const mergedAwayRejection = (
  candidate: CandidateFinding,
  representative: CandidateFinding
): RejectedFinding =>
  RejectedFindingSchema.parse({
    candidateId: candidate.id,
    status: 'rejected',
    reason: 'duplicate',
    message: `Merged into candidate ${representative.id}, which the semantic finding merge grouped with it as one underlying defect.`,
    severity: candidate.severity
  })

const candidatesByPath = (
  candidates: readonly CandidateFinding[]
): ReadonlyMap<string, readonly IndexedCandidate[]> => {
  const byPath = new Map<string, IndexedCandidate[]>()

  for (const [index, candidate] of candidates.entries()) {
    const entry = { candidate, index }
    const existing = byPath.get(candidate.location.path)

    if (existing === undefined) {
      byPath.set(candidate.location.path, [entry])
      continue
    }

    existing.push(entry)
  }

  return byPath
}

/**
 * Groups one task's candidates by whether they describe the same underlying
 * defect, and reduces each group to its representative.
 *
 * One call per file, and only for a file that has at least two candidates: a
 * merge call for a single candidate can answer nothing and is pure cost. The
 * engine currently produces roughly one candidate per file, so this stage is
 * close to free today; it becomes load-bearing as soon as discovery is
 * decomposed into several calls per file, which produces duplicates by
 * construction.
 *
 * A failed merge call means no grouping for that file, never a lost review. The
 * failure is recorded as a recovered provider issue rather than swallowed, and
 * every failure is treated as recoverable here (unlike discovery, which rethrows
 * what it does not recognize) because losing this call costs at most a redundant
 * comment, while a genuine provider outage has already failed the discovery call
 * that runs before it.
 */
export const runSemanticFindingMerge = async (
  input: {
    readonly task: WorkflowReviewTask
    readonly candidates: readonly CandidateFinding[]
    readonly fileTextByPath: ReadonlyMap<string, string>
    readonly runMerge: SemanticMergeRunner
    readonly signal?: AbortSignal | undefined
  }
): Promise<SemanticMergeOutcome> => {
  const providerIssues: ProviderIssue[] = []
  const rejectedFindings: RejectedFinding[] = []
  const groupSizes: number[] = []
  let mergeCallCount = 0

  for (const [path, fileCandidates] of candidatesByPath(input.candidates)) {
    // A cancelled run stops here rather than working through the remaining files
    // to collect one aborted call per file: every failure below is deliberately
    // treated as recoverable, so without this check cancellation would look like
    // a burst of provider issues instead of a cancellation.
    if (input.signal?.aborted === true) {
      break
    }

    const fileText = input.fileTextByPath.get(path)

    // Nothing to merge, or nothing to merge it against: the spec's call receives
    // the candidates for one file TOGETHER WITH the file, so a file whose content
    // this task never carried cannot be judged and is left ungrouped.
    if (fileCandidates.length < 2 || fileText === undefined || fileText.length === 0) {
      continue
    }

    mergeCallCount += 1

    let groups: readonly (readonly string[])[]

    try {
      const result = ModelSemanticMergeResultSchema.parse(
        await input.runMerge(
          SemanticMergeInputSchema.parse({
            taskId: input.task.id,
            path,
            fileText,
            candidates: fileCandidates.map((entry) => entry.candidate)
          }),
          input.signal
        )
      )
      groups = semanticMergeGroups(
        result,
        fileCandidates.map((entry) => entry.candidate.id)
      )
    } catch (error) {
      providerIssues.push(
        providerIssueForError({
          error,
          stage: 'semantic_finding_merge',
          // Not recovered: this file's candidates go unmerged, so duplicates
          // that the merge existed to collapse survive into admission.
          recovered: false
        })
      )
      continue
    }

    const byId = new Map(
      fileCandidates.map((entry) => [entry.candidate.id, entry] as const)
    )

    for (const group of groups) {
      const members = group.flatMap((candidateId) => {
        const entry = byId.get(candidateId)

        return entry === undefined ? [] : [entry]
      })

      if (members.length < 2) {
        continue
      }

      const representative = representativeOf(members)

      groupSizes.push(members.length)

      for (const member of members) {
        if (member.candidate.id === representative.candidate.id) {
          continue
        }

        rejectedFindings.push(
          mergedAwayRejection(member.candidate, representative.candidate)
        )
      }
    }
  }

  return {
    rejectedFindings,
    providerIssues,
    mergeCallCount,
    groupCount: groupSizes.length,
    groupSizes
  }
}
