import { type PromotionPolicyConfig } from '../../shared/contracts/index.js'
import { type ContextRetriever } from '../context-retrieval/index.js'
import {
  type FindingInvestigationRunner,
  type TaskReviewInput
} from './model-agent-contracts.js'
import { type ContextRequestArtifactCache } from './model-context-artifacts.js'
import { proofLoopArtifactsForTaskResult } from './model-proof-loop.js'
import { providerIssueForError } from './model-provider-issues.js'
import { type SelectedModelTaskCandidates } from './model-task-candidate-selection.js'
import { modelTaskInvestigationRunner } from './model-task-investigation-runner.js'
import { type ModelTaskReviewArtifacts } from './model-task-review-result.js'

type ModelTaskPrimaryProofLogger = {
  readonly debug: (
    message: string,
    metadata?: Readonly<Record<string, unknown>>
  ) => void
}

export const runModelTaskPrimaryProof = async (input: {
  readonly taskInput: TaskReviewInput
  readonly selectedCandidates: SelectedModelTaskCandidates
  readonly contextRetriever?: ContextRetriever | undefined
  readonly promotionPolicy: PromotionPolicyConfig
  readonly maxInvestigationRounds?: number | undefined
  readonly maxTaskInputBytes?: number | undefined
  readonly investigateSuspicion: FindingInvestigationRunner
  readonly contextArtifactCache: ContextRequestArtifactCache
  readonly logger: ModelTaskPrimaryProofLogger
  readonly signal?: AbortSignal | undefined
}): Promise<ModelTaskReviewArtifacts> =>
  proofLoopArtifactsForTaskResult(
    input.taskInput,
    input.selectedCandidates.candidates,
    input.selectedCandidates.contextRequestsByCandidateId,
    input.selectedCandidates.requestedContextByCandidateId,
    input.contextRetriever,
    input.promotionPolicy,
    input.maxInvestigationRounds ?? 1,
    input.maxTaskInputBytes,
    modelTaskInvestigationRunner({
      logger: input.logger,
      investigateSuspicion: input.investigateSuspicion
    }),
    providerIssueForError,
    input.contextArtifactCache,
    input.signal
  )
