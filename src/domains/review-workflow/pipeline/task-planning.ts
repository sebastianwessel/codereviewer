import type { EvidenceRecord } from '../../../shared/contracts/index.js'
import type { CandidateFinding } from '../../admission/index.js'
import { sha256 } from '../../../shared/hash/hash.js'
import {
  WorkflowReviewTaskSchema,
  type WorkflowReviewTask
} from './agent-contracts.js'
import type { ReviewWorkflowInput } from './contracts.js'

const taskIdForPath = (path: string): string =>
  `task_${sha256(path).slice(0, 16)}`

export const pathFromEvidence = (
  evidence: EvidenceRecord
): string | undefined => evidence.location?.path

export const pathFromCandidate = (candidate: CandidateFinding): string =>
  candidate.location.path

export const taskCoversPath = (
  task: WorkflowReviewTask,
  path: string | undefined
): boolean => path !== undefined && task.paths.includes(path)

export const tasksForWorkflowInput = (
  input: ReviewWorkflowInput
): readonly WorkflowReviewTask[] => {
  const inputTasks = input.tasks ?? []
  const inputReviewContext = input.reviewContext ?? []

  if (inputTasks.length > 0) {
    return inputTasks.map((task) =>
      task.reviewContext.length > 0
        ? task
        : WorkflowReviewTaskSchema.parse({
            ...task,
            reviewContext: inputReviewContext.filter(
              (context) =>
                context.path === undefined ||
                task.paths.includes(context.path)
            )
          })
    )
  }

  // A caller that supplied reviewed paths but no tasks gets one task per path,
  // each with no reviewer instructions. That is the only answer available and it
  // is not a dropped value: instructions are carried per task (spec 04 scoping
  // resolves them against a task's own files), so a caller that supplied no task
  // had no way to express an instruction in the first place. The real pipeline
  // always supplies tasks, assembled with their resolved instruction sets.
  return input.reviewedPaths.map((path) =>
    WorkflowReviewTaskSchema.parse({
      id: taskIdForPath(path),
      round: 1,
      kind: 'file',
      paths: [path],
      factIds: [],
      evidenceIds: input.evidence
        .filter((evidence) => pathFromEvidence(evidence) === path)
        .map((evidence) => evidence.id),
      candidateIds: input.candidates
        .filter((candidate) => pathFromCandidate(candidate) === path)
        .map((candidate) => candidate.id),
      reviewContext: inputReviewContext.filter(
        (context) => context.path === undefined || context.path === path
      ),
      contextEntryIds: inputReviewContext
        .filter((context) => context.path === undefined || context.path === path)
        .map((context) => context.ledgerEntryId),
      priority: 0
    })
  )
}
