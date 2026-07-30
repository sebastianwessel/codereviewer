// Spec 27: spread a task's changed files across several discovery calls, so yield
// scales with the scope under review rather than with how many tasks assembly
// happened to produce.
//
// The spec 26 A/B isolated the effect by accident: both arms reviewed identical code
// with identical prompts, and the provider refused zero packets, so reactive
// splitting never engaged. The only difference was how many calls the same code was
// spread across — 106 candidates against 75, 43.7% recall against 35.2%. A discovery
// call returns roughly three to five candidates whether it is shown one file or
// forty; the per-task candidate cap is not what binds (arm 1 averaged 3.6 against a
// cap of 12). What binds is attention inside one call.
//
// Partitioning is by FILE, never by bytes. Files are the unit the reviewer reasons
// about and the unit findings are reported against; a byte rule would reintroduce
// exactly the content-dependent guess spec 26 removed.
//
// This is NOT a second pass over the same context. Repeated passes were measured and
// rejected (2026-07-26: sweep and lens both failed to beat baseline at +40-47% cost)
// because a second look at identical material re-derives the same findings.
// Partitioned calls see DIFFERENT material, which is why the spec 26 arms diverged.

import { type WorkflowReviewTask } from '../agent-contracts.js'
import { partitionReviewContext, subTaskFrom } from './task-context-split.js'

/**
 * Split a task into discovery partitions of at most `maxFiles` review targets each.
 *
 * Returns the task unchanged (as a single partition) when partitioning would not
 * change anything: no limit configured, one or fewer targets, or the targets already
 * fit. Callers therefore always iterate the result and never branch on whether
 * partitioning applied.
 */
export const partitionTaskForDiscovery = (
  task: WorkflowReviewTask,
  maxFiles: number | undefined
): readonly WorkflowReviewTask[] => {
  if (maxFiles === undefined) {
    return [task]
  }

  const { targets, contextOnly } = partitionReviewContext(task)

  if (targets.length <= maxFiles || targets.length <= 1) {
    return [task]
  }

  const partitions: WorkflowReviewTask[] = []

  for (let index = 0; index < targets.length; index += maxFiles) {
    partitions.push(
      subTaskFrom(
        task,
        `partition:${index / maxFiles}`,
        targets.slice(index, index + maxFiles),
        contextOnly
      )
    )
  }

  return partitions
}
