import { type ReviewIntent } from '../../shared/contracts/index.js'
import { assertDeterministicSignalEvidenceOwnsPath } from '../deterministic-signals/index.js'
import {
  TaskReviewInputSchema,
  type TaskReviewInput,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import {
  pathFromCandidate,
  pathFromEvidence,
  taskCoversPath
} from './workflow-task-planning.js'
import { type ReviewWorkflowInput } from './workflow-contracts.js'
import {
  createTaskPacketBudgetExceededError,
  isTaskPacketBudgetExceededError,
  serializedBytes
} from './model-packet-budget.js'

export type TaskReviewPacket = {
  readonly input: TaskReviewInput
}

const fitTaskReviewInputToBudget = (
  taskInput: TaskReviewInput,
  maxTaskInputBytes: number | undefined
): TaskReviewPacket => {
  if (maxTaskInputBytes === undefined) {
    return {
      input: taskInput
    }
  }

  const currentBytes = serializedBytes(taskInput)

  if (currentBytes <= maxTaskInputBytes) {
    return {
      input: taskInput
    }
  }

  if (taskInput.reviewIntents.length > 0) {
    const fallbackTaskInput = TaskReviewInputSchema.parse({
      ...taskInput,
      reviewIntents: []
    })
    const fallbackBytes = serializedBytes(fallbackTaskInput)

    if (fallbackBytes <= maxTaskInputBytes) {
      return {
        input: fallbackTaskInput
      }
    }
  }

  const withoutSharedDigest = TaskReviewInputSchema.parse({
    ...taskInput,
    reviewIntents: [],
    sharedDigest: '(shared digest omitted for task packet budget)'
  })

  if (serializedBytes(withoutSharedDigest) <= maxTaskInputBytes) {
    return {
      input: withoutSharedDigest
    }
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
  reviewIntents: readonly ReviewIntent[],
  sharedDigest: string
): TaskReviewPacket => {
  const evidence = input.evidence.filter((record) =>
    task.evidenceIds.length > 0
      ? task.evidenceIds.includes(record.id)
      : taskCoversPath(task, pathFromEvidence(record))
  )

  for (const record of evidence) {
    assertDeterministicSignalEvidenceOwnsPath(record)
  }

  const taskInput = TaskReviewInputSchema.parse({
    runId: input.runId,
    task,
    reviewIntents: reviewIntents.filter(
      (intent) =>
        intent.taskIds.includes(task.id) ||
        intent.paths.some((path) => task.paths.includes(path))
    ),
    reviewedDiffRanges: (input.reviewedDiffRanges ?? []).filter((range) =>
      taskCoversPath(task, range.path)
    ),
    evidence,
    candidates: input.candidates.filter((candidate) =>
      task.candidateIds.length > 0
        ? task.candidateIds.includes(candidate.id)
        : taskCoversPath(task, pathFromCandidate(candidate))
    ),
    instructions: input.instructions,
    skills: input.skills,
    sharedDigest,
    provenance: input.provenance
  })

  return fitTaskReviewInputToBudget(taskInput, input.maxTaskInputBytes)
}

export { isTaskPacketBudgetExceededError }
