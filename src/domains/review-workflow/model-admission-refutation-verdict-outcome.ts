import {
  REJECTED_FINDING_MESSAGE_MAX,
  RejectedFindingSchema,
  type EvidenceRecord,
  type RefutationResult
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { truncateForContract } from '../../shared/text/truncate.js'
import { type FindingRefutationResult } from './model-agent-contracts.js'
import {
  emptyAdmissionCandidateOutcome,
  type AdmissionCandidateOutcome
} from './model-admission-outcome.js'
import { enrichProvedCandidate } from './model-admission-refutation-evidence.js'

export const refutedCandidateOutcome = (input: {
  readonly candidate: CandidateFinding
  readonly refutation: FindingRefutationResult
  readonly refutationEvidence: EvidenceRecord
  readonly refutationResult: RefutationResult
}): AdmissionCandidateOutcome => ({
  ...emptyAdmissionCandidateOutcome(),
  evidence: [input.refutationEvidence],
  refutationResults: [input.refutationResult],
  rejectedFindings: [
    RejectedFindingSchema.parse({
      candidateId: input.candidate.id,
      status: 'rejected',
      reason: 'refuted',
      message: truncateForContract(input.refutation.rationaleSummary, REJECTED_FINDING_MESSAGE_MAX),
      evidenceIds: [input.refutationEvidence.id]
    })
  ],
  admissionDecisions: [
    {
      candidateId: input.candidate.id,
      status: 'rejected',
      rejectedReason: 'refuted'
    }
  ]
})

export const weakEvidenceRejectedOutcome = (input: {
  readonly candidate: CandidateFinding
  readonly refutation: FindingRefutationResult
  readonly refutationEvidence: EvidenceRecord
  readonly refutationResult: RefutationResult
}): AdmissionCandidateOutcome => ({
  ...emptyAdmissionCandidateOutcome(),
  evidence: [input.refutationEvidence],
  refutationResults: [input.refutationResult],
  rejectedFindings: [
    RejectedFindingSchema.parse({
      candidateId: input.candidate.id,
      status: 'needs-more-evidence',
      reason: 'weak-evidence',
      message: truncateForContract(input.refutation.rationaleSummary, REJECTED_FINDING_MESSAGE_MAX),
      evidenceIds: [input.refutationEvidence.id]
    })
  ],
  admissionDecisions: [
    {
      candidateId: input.candidate.id,
      status: 'needs-more-evidence',
      rejectedReason: 'weak-evidence'
    }
  ]
})

export const admissibleRefutationOutcome = (input: {
  readonly candidate: CandidateFinding
  readonly refutation: FindingRefutationResult
  readonly refutationEvidence: EvidenceRecord
  readonly refutationResult: RefutationResult
}): AdmissionCandidateOutcome => ({
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
