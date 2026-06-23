import {
  ModelFindingInvestigationResultSchema,
  type FindingInvestigationResult
} from './model-agent-contracts.js'
import {
  type ProviderIssue,
  type ProviderIssueForError
} from './model-provider-issues.js'

export type ProofInvestigationProviderRecovery = {
  readonly output: FindingInvestigationResult
  readonly providerIssues: readonly ProviderIssue[]
}

export const proofInvestigationProviderRecovery = (
  input: {
    readonly error: unknown
    readonly stage: string
    readonly rationaleSummary: string
    readonly providerIssueForError: ProviderIssueForError
  }
): ProofInvestigationProviderRecovery => ({
  output: ModelFindingInvestigationResultSchema.parse({
    verdict: 'needs-more-evidence',
    rationaleSummary: input.rationaleSummary,
    evidenceIds: []
  }),
  providerIssues: [
    input.providerIssueForError({
      error: input.error,
      stage: input.stage,
      recovered: true
    })
  ]
})
