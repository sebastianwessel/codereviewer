import { type FindingInvestigationResult } from './model-agent-contracts.js'

export type ProofEvidenceSelection = {
  readonly proofEvidenceIds: readonly string[]
  readonly effectiveInvestigationVerdict: FindingInvestigationResult['verdict']
}

export const proofEvidenceSelectionFor = (
  input: {
    readonly investigationVerdict: FindingInvestigationResult['verdict']
    readonly investigationEvidenceIds: readonly string[]
    readonly availableEvidenceIds: readonly string[]
    readonly fallbackEvidenceIds: readonly string[]
  }
): ProofEvidenceSelection => {
  const available = new Set(input.availableEvidenceIds)
  const cited = input.investigationEvidenceIds.filter((evidenceId) =>
    available.has(evidenceId)
  )
  const proofEvidenceIds =
    cited.length > 0 ? cited : input.fallbackEvidenceIds

  return {
    proofEvidenceIds,
    effectiveInvestigationVerdict:
      input.investigationVerdict === 'proved' && proofEvidenceIds.length === 0
        ? 'needs-more-evidence'
        : input.investigationVerdict
  }
}
