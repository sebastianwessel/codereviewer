import { type InvestigationTrace } from '../../shared/contracts/index.js'

export const proofTraceResultForInvestigation = (input: {
  readonly effectiveInvestigationVerdict:
    | 'proved'
    | 'refuted'
    | 'needs-more-evidence'
  readonly providerIssueCount: number
}): InvestigationTrace['result'] => {
  if (input.providerIssueCount > 0) {
    return 'provider-error'
  }

  return input.effectiveInvestigationVerdict === 'proved'
    ? 'proof'
    : input.effectiveInvestigationVerdict
}
