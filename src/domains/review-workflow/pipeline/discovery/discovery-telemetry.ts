// Roll the per-task discovery counters up into the run-level record the report
// carries (spec 27).
//
// Kept apart from the task that produces the numbers and from the completion that
// writes them out, because the only thing this step decides is how per-task rows
// combine — and getting that wrong is how an aggregate stops describing its parts.

import {
  ReviewDiscoveryReportSchema,
  type ReviewDiscoveryReport,
  type TaskDiscoveryTelemetry
} from '../../../../shared/contracts/index.js'

/**
 * Sum the per-task discovery telemetry into the run's record.
 *
 * Returns `undefined` when no task recorded any: a run that issued no discovery
 * call has nothing to state, and an all-zero record would assert it looked and
 * found nothing, which is a different claim.
 *
 * `rawFindingsPerCall` CONCATENATES rather than summing. It is the one field whose
 * value is its shape: the open question spec 27 leaves is whether findings per file
 * are capped near ~1.2 or merely average there, and only the distribution answers
 * it. Reducing it to a mean here would discard the measurement at the exact step
 * that exists to preserve it.
 */
export const summarizeDiscoveryTelemetry = (
  tasks: readonly TaskDiscoveryTelemetry[]
): ReviewDiscoveryReport | undefined => {
  if (tasks.length === 0) {
    return undefined
  }

  const sumOf = (
    pick: (task: TaskDiscoveryTelemetry) => number
  ): number => tasks.reduce((total, task) => total + pick(task), 0)

  return ReviewDiscoveryReportSchema.parse({
    totals: {
      callCount: sumOf((task) => task.callCount),
      rawFindingCount: sumOf((task) => task.rawFindingCount),
      rawFindingsPerCall: tasks.flatMap((task) => task.rawFindingsPerCall),
      candidateCount: sumOf((task) => task.candidateCount),
      droppedCount: sumOf((task) => task.droppedCount),
      suppressedByIdCount: sumOf((task) => task.suppressedByIdCount),
      suppressedByLocationCount: sumOf(
        (task) => task.suppressedByLocationCount
      ),
      cappedByLimitCount: sumOf((task) => task.cappedByLimitCount),
      contextOverflowSplitCount: sumOf(
        (task) => task.contextOverflowSplitCount
      ),
      // Summed like every other counter. `?? 0` is not a defaulted absence here:
      // every task row this run produced carries the number, because the producer
      // (`holistic-task-review.ts`) always writes it; the fallback only exists
      // because the FIELD is optional for reports written before it existed, and
      // this function only ever sees rows from the run in progress.
      readBudgetReductionCount: sumOf(
        (task) => task.readBudgetReductionCount ?? 0
      ),
      mergeCallCount: sumOf((task) => task.mergeCallCount),
      mergeGroupCount: sumOf((task) => task.mergeGroupCount),
      mergedAwayCount: sumOf((task) => task.mergedAwayCount)
    },
    tasks: [...tasks]
  })
}
