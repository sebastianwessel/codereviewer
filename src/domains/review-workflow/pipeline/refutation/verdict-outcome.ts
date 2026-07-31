import {
  REJECTED_FINDING_MESSAGE_MAX,
  RejectedFindingSchema,
  type EvidenceRecord,
  type RefutationResult
} from '../../../../shared/contracts/index.js'
import { type CandidateFinding } from '../../../admission/index.js'
import { truncateForContract } from '../../../../shared/text/truncate.js'
import { type FindingRefutationResult } from '../agent-contracts.js'
import {
  emptyAdmissionCandidateOutcome,
  type AdmissionCandidateOutcome
} from '../admission/outcome.js'
import { enrichProvedCandidate } from './evidence.js'

type RefutationOutcomeInput = {
  readonly candidate: CandidateFinding
  readonly refutation: FindingRefutationResult
  readonly refutationEvidence: EvidenceRecord
  readonly refutationResult: RefutationResult
}

type RejectedVerdict = {
  readonly status: 'rejected' | 'needs-more-evidence'
  readonly reason: 'refuted' | 'weak-evidence'
}

// Both refutation rejections record the same thing — the refuter's evidence, its
// result, and one rejected finding whose message is the rationale — and differ only
// in the (status, reason) pair the contract requires. Keeping one builder is what
// stops the two from drifting on the fields they must share.
const rejectedRefutationOutcome = (
  input: RefutationOutcomeInput,
  verdict: RejectedVerdict
): AdmissionCandidateOutcome => ({
  ...emptyAdmissionCandidateOutcome(),
  evidence: [input.refutationEvidence],
  refutationResults: [input.refutationResult],
  rejectedFindings: [
    RejectedFindingSchema.parse({
      candidateId: input.candidate.id,
      status: verdict.status,
      reason: verdict.reason,
      message: truncateForContract(
        input.refutation.rationaleSummary,
        REJECTED_FINDING_MESSAGE_MAX
      ),
      evidenceIds: [input.refutationEvidence.id]
    })
  ],
  admissionDecisions: [
    {
      candidateId: input.candidate.id,
      status: verdict.status,
      rejectedReason: verdict.reason
    }
  ]
})

export const refutedCandidateOutcome = (
  input: RefutationOutcomeInput
): AdmissionCandidateOutcome =>
  rejectedRefutationOutcome(input, { status: 'rejected', reason: 'refuted' })

export const weakEvidenceRejectedOutcome = (
  input: RefutationOutcomeInput
): AdmissionCandidateOutcome =>
  rejectedRefutationOutcome(input, {
    status: 'needs-more-evidence',
    reason: 'weak-evidence'
  })

export const admissibleRefutationOutcome = (
  input: RefutationOutcomeInput
): AdmissionCandidateOutcome => ({
  ...emptyAdmissionCandidateOutcome(),
  admissionCandidates: [
    enrichProvedCandidate({
      candidate: input.candidate,
      refutation: input.refutation,
      refutationEvidence: input.refutationEvidence
    })
  ],
  evidence: [input.refutationEvidence],
  refutationResults: [input.refutationResult],
  artifactOnlyCandidateIds:
    input.refutation.verdict === 'needs-more-evidence'
      ? [input.candidate.id]
      : []
})
