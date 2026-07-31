import {
  refutationVerdictsByCandidateId,
  type FindingRefutationBatchInput,
  type ModelFindingRefutationBatchResult
} from '../pipeline/agent-contracts.js'
import { type DebugLogger } from '../pipeline/debug-logger.js'

export const runRefutationProviderCall = async (
  input: {
    readonly refutationInput: FindingRefutationBatchInput
    readonly refuteFinding: (
      input: FindingRefutationBatchInput,
      signal: AbortSignal | undefined
    ) => Promise<ModelFindingRefutationBatchResult>
    readonly logger: DebugLogger
    readonly signal?: AbortSignal | undefined
  }
): Promise<ModelFindingRefutationBatchResult> => {
  input.logger.debug('Refutation check provider call started.', {
    task_id: input.refutationInput.candidates[0]?.taskId,
    candidate_count: input.refutationInput.candidates.length,
    evidence_count: input.refutationInput.evidence.length,
    context_count: input.refutationInput.reviewContext.length
  })
  const batch = await input.refuteFinding(input.refutationInput, input.signal)
  // A candidate the model failed to adjudicate is downgraded to
  // needs-more-evidence downstream, which silently weakens the review. Surface the
  // shortfall so a model that keeps dropping candidates is visible in the logs
  // rather than showing up only as unexplained recall loss.
  const boundVerdicts = refutationVerdictsByCandidateId(batch)
  const unadjudicatedCount = input.refutationInput.candidates.filter(
    (candidate) => !boundVerdicts.has(candidate.id)
  ).length

  input.logger.debug('Refutation check provider call completed.', {
    task_id: input.refutationInput.candidates[0]?.taskId,
    candidate_count: input.refutationInput.candidates.length,
    verdict_count: batch.verdicts.length,
    bound_verdict_count: boundVerdicts.size,
    unadjudicated_candidate_count: unadjudicatedCount
  })

  return batch
}
