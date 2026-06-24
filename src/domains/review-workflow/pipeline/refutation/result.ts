import {
  RefutationResultSchema,
  type EvidenceRecord,
  type RefutationResult
} from '../../../../shared/contracts/index.js'
import { type CandidateFinding } from '../../../admission/index.js'
import { sha256 } from '../../../../shared/hash/hash.js'
import { truncateForContract } from '../../../../shared/text/truncate.js'
import { type FindingRefutationResult } from '../agent-contracts.js'

const checkResultForVerdict = (
  verdict: FindingRefutationResult['verdict']
): RefutationResult['checks'][number]['result'] =>
  verdict === 'proved' ? 'passed' : verdict === 'refuted' ? 'failed' : 'unknown'

export const activeRefutationResultForCandidate = (input: {
  readonly candidate: CandidateFinding
  readonly refutation: FindingRefutationResult
  readonly refutationEvidence: EvidenceRecord
}): RefutationResult => {
  const evidenceIds = [
    ...new Set([
      ...input.candidate.evidenceIds,
      input.refutationEvidence.id
    ])
  ]

  return RefutationResultSchema.parse({
    id: `refute_${sha256(
      `${input.candidate.id}:${input.refutation.verdict}:${input.refutationEvidence.id}`
    ).slice(0, 16)}`,
    candidateId: input.candidate.id,
    verdict: input.refutation.verdict,
    summary: truncateForContract(input.refutation.rationaleSummary, 1000),
    evidenceIds,
    checks: [
      {
        kind: 'active-refutation',
        result: checkResultForVerdict(input.refutation.verdict),
        summary: truncateForContract(input.refutation.rationaleSummary, 500),
        evidenceIds
      }
    ]
  })
}
