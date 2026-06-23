import {
  ModelFindingInvestigationResultSchema,
  type FindingInvestigationResult
} from './model-agent-contracts.js'

export const proofRunnerlessInvestigationOutput = (input: {
  readonly evidenceIds: readonly string[]
}): FindingInvestigationResult =>
  // No investigation runner executed, so the engine has not actually proved the
  // suspicion. A self-asserted `proved` here (the previous behavior when any
  // evidence id was attached) inflated false positives because such candidates
  // entered admission as proofs without an investigator verdict. Per VIS-001,
  // only a real investigator verdict may become a proof; absent one, the result
  // is always inconclusive.
  ModelFindingInvestigationResultSchema.parse({
    verdict: 'needs-more-evidence',
    rationaleSummary:
      input.evidenceIds.length === 0
        ? 'Model suspicion was not tied to enough exact evidence to form a proof packet.'
        : 'No investigation runner ran, so the cited evidence was not verified into a proof packet.',
    evidenceIds: input.evidenceIds
  })

export const proofMissingInvestigationOutput = (): FindingInvestigationResult =>
  ModelFindingInvestigationResultSchema.parse({
    verdict: 'needs-more-evidence',
    rationaleSummary:
      'Suspicion investigation did not produce a proof or refutation result.',
    evidenceIds: []
  })
