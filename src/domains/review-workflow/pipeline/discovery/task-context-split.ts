// Shared machinery for building a SUB-TASK from a subset of a task's review targets.
//
// Two features need this and must not drift apart on it: reactive splitting (spec 26,
// halving a task the provider refused) and discovery partitioning (spec 27, spreading
// a task's files across several calls so yield scales with scope). Both have to route
// context and narrow paths identically, because both produce tasks whose findings are
// admitted against the content that call actually saw.

import { sha256 } from '../../../../shared/hash/hash.js'
import {
  type ReviewContextDocument,
  type WorkflowReviewTask
} from '../agent-contracts.js'

const isReviewTarget = (document: ReviewContextDocument): boolean =>
  document.kind === 'file'

// A sub-task needs its own id: sub-tasks run as distinct calls, and reusing the
// parent's id would collide their candidates (keyed by task id and location) and make
// the calls indistinguishable in the run record.
const subTaskId = (parentId: string, suffix: string): string =>
  `task_${sha256(`${parentId}:${suffix}`).slice(0, 16)}`

/**
 * Build a sub-task from a subset of review targets, attaching the context each needs.
 *
 * Context-only documents reach a sub-task when they are ABOUT one of its files, or
 * when they are not about any reviewed file at all:
 *
 * - no path (change intent describes the whole change) → every sub-task;
 * - path is one of this sub-task's own files → this sub-task;
 * - path is not a review target of the parent AT ALL → every sub-task.
 *
 * That third case is the one that matters and it was wrong. A referenced definition
 * is by construction an UNCHANGED dependency file, deliberately excluded from
 * `task.paths` so it can never become a review target — so matching it against a
 * sub-task's own paths never succeeds, and every R4 digest was silently dropped from
 * every partition. The reviewer lost exactly the callee contracts that let it judge
 * a caller, on precisely the large multi-file changes partitioning exists to serve.
 *
 * The unit tests did not catch it because their fixtures gave a referenced
 * definition the path of a CHANGED file, a state assembly cannot produce.
 */
export const subTaskFrom = (
  parent: WorkflowReviewTask,
  suffix: string,
  targets: readonly ReviewContextDocument[],
  contextOnly: readonly ReviewContextDocument[]
): WorkflowReviewTask => {
  const paths = [
    ...new Set(
      targets
        .map((document) => document.path)
        .filter((path): path is string => path !== undefined)
    )
  ].sort()
  const pathSet = new Set(paths)

  // Every file the PARENT reviews. A context document pointing outside this set is
  // external context, not a sibling's file, so withholding it from a sub-task would
  // simply lose it.
  const parentTargetPaths = new Set(
    parent.reviewContext
      .filter(isReviewTarget)
      .map((document) => document.path)
      .filter((path): path is string => path !== undefined)
  )

  return {
    ...parent,
    id: subTaskId(parent.id, suffix),
    // Findings stay restricted to this sub-task's OWN review targets. Keeping the
    // parent's full path list would let a call report a finding in a file it was
    // never shown, which admission would then anchor against content it never read.
    paths: paths.length > 0 ? paths : [...parent.paths],
    reviewContext: [
      ...targets,
      ...contextOnly.filter(
        (document) =>
          document.path === undefined ||
          pathSet.has(document.path) ||
          !parentTargetPaths.has(document.path)
      )
    ]
  }
}

export const partitionReviewContext = (
  task: WorkflowReviewTask
): {
  readonly targets: readonly ReviewContextDocument[]
  readonly contextOnly: readonly ReviewContextDocument[]
} => ({
  targets: task.reviewContext.filter(isReviewTarget),
  contextOnly: task.reviewContext.filter(
    (document) => !isReviewTarget(document)
  )
})
