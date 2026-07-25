import {
  type FindingRefutationBatchInput,
  type ModelFindingRefutationBatchResult
} from '../pipeline/agent-contracts.js'

type ProviderCallLogger = {
  readonly debug: (
    message: string,
    metadata?: Readonly<Record<string, unknown>>
  ) => void
}

export const runRefutationProviderCall = async (
  input: {
    readonly refutationInput: FindingRefutationBatchInput
    readonly refuteFinding: (
      input: FindingRefutationBatchInput,
      signal: AbortSignal | undefined
    ) => Promise<ModelFindingRefutationBatchResult>
    readonly logger: ProviderCallLogger
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

  input.logger.debug('Refutation check provider call completed.', {
    task_id: input.refutationInput.candidates[0]?.taskId,
    candidate_count: input.refutationInput.candidates.length,
    verdict_count: batch.verdicts.length
  })

  return batch
}

export type { ProviderCallLogger }
