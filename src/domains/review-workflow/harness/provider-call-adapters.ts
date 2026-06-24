import {
  normalizeFindingRefutationResult,
  type FindingRefutationInput,
  type FindingRefutationResult
} from '../pipeline/agent-contracts.js'

type ProviderCallLogger = {
  readonly debug: (
    message: string,
    metadata?: Readonly<Record<string, unknown>>
  ) => void
}

export const runRefutationProviderCall = async (
  input: {
    readonly refutationInput: FindingRefutationInput
    readonly refuteFinding: (
      input: FindingRefutationInput,
      signal: AbortSignal | undefined
    ) => Promise<FindingRefutationResult>
    readonly logger: ProviderCallLogger
    readonly signal?: AbortSignal | undefined
  }
): Promise<FindingRefutationResult> => {
  input.logger.debug('Refutation check provider call started.', {
    candidate_id: input.refutationInput.candidate.id,
    path: input.refutationInput.candidate.location.path,
    evidence_count: input.refutationInput.evidence.length,
    context_count: input.refutationInput.reviewContext.length
  })
  const refutation = await input.refuteFinding(
    input.refutationInput,
    input.signal
  )
  const normalizedRefutation = normalizeFindingRefutationResult(refutation)

  input.logger.debug('Refutation check provider call completed.', {
    candidate_id: input.refutationInput.candidate.id,
    verdict: normalizedRefutation.verdict
  })

  return normalizedRefutation
}

export type { ProviderCallLogger }
