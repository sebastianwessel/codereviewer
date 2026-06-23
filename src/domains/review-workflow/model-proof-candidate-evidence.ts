import { type EvidenceRecord } from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'

export type ProofCandidateEvidence = {
  readonly seedEvidenceIds: readonly string[]
  readonly citedEvidence: readonly EvidenceRecord[]
}

export const proofCandidateEvidenceFor = (
  input: {
    readonly taskEvidence: readonly EvidenceRecord[]
    readonly candidate: CandidateFinding
  }
): ProofCandidateEvidence => {
  const candidateEvidenceIds = new Set(input.candidate.evidenceIds)

  return {
    seedEvidenceIds: input.candidate.evidenceIds.filter((evidenceId) =>
      input.taskEvidence.some((evidence) => evidence.id === evidenceId)
    ),
    citedEvidence: input.taskEvidence.filter((record) =>
      candidateEvidenceIds.has(record.id)
    )
  }
}
