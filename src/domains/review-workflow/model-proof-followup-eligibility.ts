import { type FindingInvestigationResult } from './model-agent-contracts.js'

export const proofShouldRequestFollowUpContext = (input: {
  readonly verdict: FindingInvestigationResult['verdict']
  readonly hasContextRetriever: boolean
  readonly usedInvestigationRounds: number
  readonly maxInvestigationRounds: number
  readonly contextRequestCount: number
  readonly requestedContextCount: number
}): boolean =>
  input.verdict === 'needs-more-evidence' &&
  input.hasContextRetriever &&
  input.usedInvestigationRounds < input.maxInvestigationRounds &&
  (input.contextRequestCount > 0 || input.requestedContextCount > 0)
