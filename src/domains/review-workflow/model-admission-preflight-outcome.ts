import { type EvidenceRecord } from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import {
  isModelProposedCandidate,
  rejectedFindingForOutOfDiffScope
} from './model-admission-candidate-scope.js'
import {
  emptyAdmissionCandidateOutcome,
  type AdmissionCandidateOutcome
} from './model-admission-outcome.js'

export const supportSignalArtifactOnlyCandidateIds = (
  candidates: readonly CandidateFinding[]
): readonly string[] =>
  candidates
    .filter(
      (candidate) =>
        !isModelProposedCandidate(candidate) &&
        candidate.proposedBy !== 'deterministic-trusted-rule'
    )
    .map((candidate) => candidate.id)

export const noRefuterAdmissionOutcome = (input: {
  readonly candidates: readonly CandidateFinding[]
  readonly workflowEvidence: readonly EvidenceRecord[]
}): AdmissionCandidateOutcome => ({
  admissionCandidates: input.candidates,
  evidence: input.workflowEvidence,
  rejectedFindings: [],
  admissionDecisions: [],
  artifactOnlyCandidateIds: supportSignalArtifactOnlyCandidateIds(
    input.candidates
  ),
  judgeResults: [],
  refutationResults: [],
  providerIssues: []
})

export const supportSignalCandidateOutcome = (
  candidate: CandidateFinding
): AdmissionCandidateOutcome => ({
  ...emptyAdmissionCandidateOutcome(),
  admissionCandidates: [candidate],
  artifactOnlyCandidateIds:
    candidate.proposedBy === 'deterministic-trusted-rule' ? [] : [candidate.id]
})

export const outOfDiffScopeOutcome = (
  candidate: CandidateFinding
): AdmissionCandidateOutcome => {
  const rejectedFinding = rejectedFindingForOutOfDiffScope(candidate)

  return {
    ...emptyAdmissionCandidateOutcome(),
    rejectedFindings: [rejectedFinding],
    admissionDecisions: [
      {
        candidateId: candidate.id,
        status: 'needs-more-evidence',
        rejectedReason: 'not-in-scope'
      }
    ]
  }
}
