import {
  type FindingInvestigationRunner
} from './model-agent-contracts.js'

type ModelTaskInvestigationLogger = {
  readonly debug: (
    message: string,
    metadata?: Readonly<Record<string, unknown>>
  ) => void
}

export const modelTaskInvestigationRunner = (input: {
  readonly logger: ModelTaskInvestigationLogger
  readonly investigateSuspicion: FindingInvestigationRunner
}): FindingInvestigationRunner => async (investigationInput, signal) => {
  input.logger.debug('Suspicion investigation provider call started.', {
    candidate_id: investigationInput.candidate.id,
    suspicion_id: investigationInput.suspicion.id,
    path: investigationInput.candidate.location.path,
    evidence_count: investigationInput.evidence.length,
    context_count: investigationInput.reviewContext.length
  })
  const investigation = await input.investigateSuspicion(
    investigationInput,
    signal
  )

  input.logger.debug('Suspicion investigation provider call completed.', {
    candidate_id: investigationInput.candidate.id,
    suspicion_id: investigationInput.suspicion.id,
    verdict: investigation.verdict
  })

  return investigation
}
