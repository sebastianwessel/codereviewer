import {
  RefutationResultSchema,
  type EvidenceRecord,
  type RefutationResult
} from '../../../../shared/contracts/index.js'
import type { CandidateFinding } from '../../../admission/index.js'
import { sha256 } from '../../../../shared/hash/hash.js'
import { truncateToFieldBound } from '../../../../shared/text/truncate.js'
import type { FindingRefutationResult } from '../agent-contracts.js'

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
    summary: truncateToFieldBound(
      input.refutation.rationaleSummary,
      RefutationResultSchema.shape.summary
    ),
    evidenceIds,
    checks: [
      {
        kind: 'active-refutation',
        result: checkResultForVerdict(input.refutation.verdict),
        // What the CHECK was, not a second copy of the rationale.
        //
        // This used to be the same `rationaleSummary` string as `summary` above,
        // cut to a shorter cap — so the proof block printed one argument twice,
        // the second time truncated. Raising the cap would have printed 1200
        // identical characters twice instead; the defect was the duplication, not
        // the number. The rationale is one line above, now uncut, and this line
        // says which check produced it.
        summary:
          'The refuter was asked to disprove this candidate using only the code, diff ranges, and evidence it was shown. The verdict and its reasoning are recorded above.',
        evidenceIds
      }
    ]
  })
}
