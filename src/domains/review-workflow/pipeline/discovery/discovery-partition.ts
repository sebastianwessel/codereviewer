// Spec 27: spread a task's changed files across several discovery calls, so yield
// scales with the scope under review rather than with how many tasks assembly
// happened to produce.
//
// The spec 26 A/B isolated the effect by accident: both arms reviewed identical code
// with identical prompts, and the provider refused zero packets, so reactive
// splitting never engaged. The only difference was how many calls the same code was
// spread across — 106 candidates against 75, 43.7% recall against 35.2%. The
// per-task candidate cap is not what binds (the whole-change arm averaged 3.6 against
// a cap of 12). What binds is attention inside one call.
//
// Measured law (spec 27, Correction): a file that gets any attention yields ~1.2
// findings — invariant across a 19x range of files-per-call and two corpora — while
// per-call yield is SUB-LINEAR in scope, about 0.46 * files^0.70. So partitioning
// raises the SHARE of files that get looked at (11% -> 27%); it never raises per-file
// yield. Recall saturates at 2 files per call: going to 1 keeps producing candidates,
// but they are additional unlisted-real defects rather than more of the listed ones.
//
// Partitioning is by FILE, never by bytes. Files are the unit the reviewer reasons
// about and the unit findings are reported against; a byte rule would reintroduce
// exactly the content-dependent guess spec 26 removed.
//
// A SECOND split composes on top of it (spec 27, Sub-File Partitioning, added
// 2026-08-07, off by default and unmeasured): splitting the file SET does nothing on
// a change that touches one file, which on the security corpus is most of the
// corpus, so a file's body is spread over several calls by declaration. Its unit is
// a declaration from the AST, so the byte rule stays out of both splits.
//
// This is NOT a second pass over the same context. Repeated passes were measured and
// rejected (2026-07-26: sweep and lens both failed to beat baseline at +40-47% cost)
// because a second look at identical material re-derives the same findings.
// Partitioned calls see DIFFERENT material, which is why the spec 26 arms diverged.

import { defaultMaxDeclarationGroupsPerFile } from '../../../../shared/contracts/index.js'
import { type WorkflowReviewTask } from '../agent-contracts.js'
import {
  splitDocumentByDeclarations,
  type DeclarationSplitOptions
} from './declaration-groups.js'
import { partitionReviewContext, subTaskFrom } from './task-context-split.js'

/**
 * Split a task into discovery partitions of at most `maxFiles` review targets each.
 *
 * Returns the task unchanged (as a single partition) when partitioning would not
 * change anything: no limit configured, one or fewer targets, or the targets already
 * fit. Callers therefore always iterate the result and never branch on whether
 * partitioning applied.
 */
const partitionTaskByFile = (
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

/**
 * Spread a partition's reviewed file bodies over several calls, by declaration.
 *
 * Group `n` of the partition carries group `n` of every file that HAS one, so each
 * declaration group is shown exactly once and a call is never handed the same body
 * twice. A file with fewer groups than its siblings simply stops appearing, rather
 * than repeating its last group to fill the shape — repetition would be a second
 * look at identical material, which this project measured and rejected.
 *
 * The number of sub-tasks is therefore the largest group count among the
 * partition's files, and it is one (the partition itself, unchanged) whenever no
 * file split.
 */
const partitionTaskByDeclarations = (
  partition: WorkflowReviewTask,
  options: DeclarationSplitOptions
): readonly WorkflowReviewTask[] => {
  const { targets, contextOnly } = partitionReviewContext(partition)
  const groupsPerTarget = targets.map((target) =>
    splitDocumentByDeclarations(target, options)
  )
  const groupCount = Math.max(
    0,
    ...groupsPerTarget.map((groups) => groups.length)
  )

  if (groupCount < 2) {
    return [partition]
  }

  const subTasks: WorkflowReviewTask[] = []

  for (let index = 0; index < groupCount; index += 1) {
    subTasks.push(
      subTaskFrom(
        partition,
        `declarations:${index}`,
        groupsPerTarget
          .map((groups) => groups[index])
          .filter(
            (group): group is (typeof targets)[number] => group !== undefined
          ),
        contextOnly
      )
    )
  }

  return subTasks
}

/**
 * Every discovery call this task will issue, as a sub-task apiece.
 *
 * Two independent splits compose here, in this order: by FILE
 * (`maxFilesPerDiscoveryCall`), then by DECLARATION inside each file partition
 * (`maxDeclarationsPerDiscoveryCall`). The second exists because the first cannot
 * engage at all on a single-file change, which is most of the security corpus.
 *
 * With `declarations` absent — the default — this is byte-for-byte the file
 * partitioning that shipped, including the identity return for a task that does not
 * split.
 */
export const partitionTaskForDiscovery = (
  task: WorkflowReviewTask,
  maxFiles: number | undefined,
  declarations?: DeclarationSplitOptions | undefined
): readonly WorkflowReviewTask[] => {
  const filePartitions = partitionTaskByFile(task, maxFiles)

  return declarations === undefined
    ? filePartitions
    : filePartitions.flatMap((partition) =>
        partitionTaskByDeclarations(partition, declarations)
      )
}

/**
 * The sub-file split options a workflow input asks for, or `undefined` for off.
 *
 * `maxDeclarationsPerDiscoveryCall` is the switch: the group cap alone means
 * nothing, so an input that carries only the cap leaves splitting off. Shared by
 * every caller that has to reproduce the exact call set — discovery itself and the
 * packet budget guard — because a guard that partitioned differently from the
 * discovery it guards would measure a packet nobody sends.
 */
export const declarationSplitOptionsFor = (input: {
  readonly maxDeclarationsPerDiscoveryCall?: number | undefined
  readonly maxDeclarationGroupsPerFile?: number | undefined
}): DeclarationSplitOptions | undefined =>
  input.maxDeclarationsPerDiscoveryCall === undefined
    ? undefined
    : {
        maxDeclarationsPerCall: input.maxDeclarationsPerDiscoveryCall,
        maxGroupsPerFile:
          input.maxDeclarationGroupsPerFile ??
          defaultMaxDeclarationGroupsPerFile
      }
