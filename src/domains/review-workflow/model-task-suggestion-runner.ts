import {
  type ModelTaskSuggestions,
  type TaskReviewInput
} from './model-agent-contracts.js'

type ModelTaskSuggestionLogger = {
  readonly debug: (
    message: string,
    metadata?: Readonly<Record<string, unknown>>
  ) => void
}

export type ModelTaskSuggestionRunner = (
  input: TaskReviewInput,
  signal: AbortSignal | undefined
) => Promise<ModelTaskSuggestions>

export const modelTaskSuggestionRunner = (input: {
  readonly logger: ModelTaskSuggestionLogger
  readonly reviewTask: ModelTaskSuggestionRunner
}): ModelTaskSuggestionRunner => async (taskInput, signal) => {
  input.logger.debug('Review task provider call started.', {
    task_id: taskInput.task.id,
    task_round: taskInput.task.round,
    path_count: taskInput.task.paths.length,
    task_context_count: taskInput.task.reviewContext.length,
    evidence_count: taskInput.evidence.length,
    candidate_count: taskInput.candidates.length
  })

  return input.reviewTask(taskInput, signal)
}
