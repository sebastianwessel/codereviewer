import { type ModelSuspicion } from '../../shared/contracts/index.js'

export const proofSuspicionStatusForInvestigation = (input: {
  readonly effectiveInvestigationVerdict:
    | 'proved'
    | 'refuted'
    | 'needs-more-evidence'
}): ModelSuspicion['status'] => input.effectiveInvestigationVerdict
