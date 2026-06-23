import {
  type ModelSuspicionDropReason,
  type ModelTaskSuggestions,
  type WorkflowReviewTask
} from './model-agent-contracts.js'

type ModelTaskCompletionLogger = {
  readonly debug: (
    message: string,
    metadata?: Readonly<Record<string, unknown>>
  ) => void
}

type ModelTaskCompletionSelectedCandidates = {
  readonly candidates: readonly unknown[]
  readonly droppedSuspicionReasons: Readonly<Record<ModelSuspicionDropReason, number>>
}

type ModelTaskCompletionArtifacts = {
  readonly modelSuspicions: readonly unknown[]
  readonly proofPackets: readonly unknown[]
}

type ModelTaskCompletionSiblingArtifacts = ModelTaskCompletionArtifacts & {
  readonly candidates: readonly unknown[]
}

export const logModelTaskReviewCompletion = (input: {
  readonly task: WorkflowReviewTask
  readonly suggestions: ModelTaskSuggestions
  readonly selectedCandidates: ModelTaskCompletionSelectedCandidates
  readonly primaryArtifacts: ModelTaskCompletionArtifacts
  readonly siblingArtifacts: ModelTaskCompletionSiblingArtifacts
  readonly logger: ModelTaskCompletionLogger
}): void => {
  input.logger.debug('Review task provider call completed.', {
    task_id: input.task.id,
    task_round: input.task.round,
    suspicion_suggestion_count: input.suggestions.suspicions.length,
    candidate_count:
      input.selectedCandidates.candidates.length +
      input.siblingArtifacts.candidates.length,
    suspicion_count:
      input.primaryArtifacts.modelSuspicions.length +
      input.siblingArtifacts.modelSuspicions.length,
    proof_packet_count:
      input.primaryArtifacts.proofPackets.length +
      input.siblingArtifacts.proofPackets.length,
    dropped_suspicion_reasons:
      input.selectedCandidates.droppedSuspicionReasons
  })
}
