import { assertDeterministicSignalEvidenceOwnsPath } from '../../../deterministic-signals/index.js'
import {
  TaskReviewInputSchema,
  type TaskReviewInput,
  type WorkflowReviewTask
} from '../agent-contracts.js'
import {
  pathFromCandidate,
  pathFromEvidence,
  taskCoversPath
} from '../task-planning.js'
import { type ReviewWorkflowInput } from '../contracts.js'
import {
  createTaskPacketBudgetExceededError,
  serializedBytes
} from '../packet-budget.js'

const fitTaskReviewInputToBudget = (
  taskInput: TaskReviewInput,
  maxTaskInputBytes: number | undefined
): TaskReviewInput => {
  if (maxTaskInputBytes === undefined) {
    return taskInput
  }

  const currentBytes = serializedBytes(taskInput)

  if (currentBytes <= maxTaskInputBytes) {
    return taskInput
  }

  const withoutSharedDigest = TaskReviewInputSchema.parse({
    ...taskInput,
    sharedDigest: '(shared digest omitted for task packet budget)'
  })

  if (serializedBytes(withoutSharedDigest) <= maxTaskInputBytes) {
    return withoutSharedDigest
  }

  throw createTaskPacketBudgetExceededError({
    taskId: taskInput.task.id,
    maxTaskInputBytes,
    serializedBytes: currentBytes
  })
}

export const taskReviewInputFor = (
  input: ReviewWorkflowInput,
  task: WorkflowReviewTask,
  sharedDigest: string
): TaskReviewInput => {
  const evidence = input.evidence.filter((record) =>
    task.evidenceIds.length > 0
      ? task.evidenceIds.includes(record.id)
      : taskCoversPath(task, pathFromEvidence(record))
  )

  for (const record of evidence) {
    assertDeterministicSignalEvidenceOwnsPath(record)
  }

  const taskInput = TaskReviewInputSchema.parse({
    task,
    reviewedDiffRanges: (input.reviewedDiffRanges ?? []).filter((range) =>
      taskCoversPath(task, range.path)
    ),
    evidence,
    candidates: input.candidates.filter((candidate) =>
      task.candidateIds.length > 0
        ? task.candidateIds.includes(candidate.id)
        : taskCoversPath(task, pathFromCandidate(candidate))
    ),
    // No `instructions` key: the task's own, scope-resolved instruction
    // documents travel inside `task` (see `TaskReviewInputSchema`).
    skills: input.skills,
    sharedDigest,
    provenance: input.provenance
  })

  return fitTaskReviewInputToBudget(taskInput, input.maxTaskInputBytes)
}
