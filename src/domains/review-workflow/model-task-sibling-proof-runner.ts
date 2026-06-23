import { type PromotionPolicyConfig } from '../../shared/contracts/index.js'
import { type ContextRetriever } from '../context-retrieval/index.js'
import {
  TaskReviewResultSchema,
  type FindingInvestigationRunner,
  type ModelTaskSuggestions,
  type TaskReviewInput,
  type TaskReviewResult,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import { type ContextRequestArtifactCache } from './model-context-artifacts.js'
import { proofLoopArtifactsForTaskResult } from './model-proof-loop.js'
import { providerIssueForError } from './model-provider-issues.js'
import {
  type SelectedModelTaskSiblingCandidates
} from './model-task-sibling-selection.js'

type ModelTaskSiblingProofLogger = {
  readonly debug: (
    message: string,
    metadata?: Readonly<Record<string, unknown>>
  ) => void
}

export const runModelTaskSiblingProofSweep = async (input: {
  readonly taskInput: TaskReviewInput
  readonly task: WorkflowReviewTask
  readonly suggestions: ModelTaskSuggestions
  readonly selectedSiblings: SelectedModelTaskSiblingCandidates
  readonly contextRetriever?: ContextRetriever | undefined
  readonly promotionPolicy: PromotionPolicyConfig
  readonly maxInvestigationRounds?: number | undefined
  readonly maxTaskInputBytes?: number | undefined
  readonly investigateSuspicion: FindingInvestigationRunner
  readonly contextArtifactCache: ContextRequestArtifactCache
  readonly logger: ModelTaskSiblingProofLogger
  readonly signal?: AbortSignal | undefined
}): Promise<TaskReviewResult> => {
  const siblingProofArtifacts = await proofLoopArtifactsForTaskResult(
    input.taskInput,
    input.selectedSiblings.candidates,
    input.selectedSiblings.contextRequestsByCandidateId,
    input.selectedSiblings.requestedContextByCandidateId,
    input.contextRetriever,
    input.promotionPolicy,
    input.maxInvestigationRounds ?? 1,
    input.maxTaskInputBytes,
    input.investigateSuspicion,
    providerIssueForError,
    input.contextArtifactCache,
    input.signal
  )

  input.logger.debug('Sibling sweep provider call completed.', {
    task_id: input.task.id,
    suspicion_suggestion_count: input.suggestions.suspicions.length,
    candidate_count: input.selectedSiblings.candidates.length,
    proof_packet_count: siblingProofArtifacts.proofPackets.length,
    dropped_suspicion_reasons: input.selectedSiblings.droppedSuspicionReasons
  })

  return TaskReviewResultSchema.parse({
    candidates: input.selectedSiblings.candidates,
    ...siblingProofArtifacts
  })
}
