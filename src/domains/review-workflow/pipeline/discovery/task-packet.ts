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
  isTaskPacketBudgetExceededError,
  serializedBytes
} from '../packet-budget.js'

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

  const withoutSharedDigest = TaskReviewInputSchema.parse({
    ...taskInput,
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
