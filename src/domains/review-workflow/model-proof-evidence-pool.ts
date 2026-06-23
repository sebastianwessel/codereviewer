import { type EvidenceRecord } from '../../shared/contracts/index.js'

export type ProofEvidencePool = {
  readonly evidenceRecords: readonly EvidenceRecord[]
  readonly availableEvidenceIds: readonly string[]
  readonly fallbackEvidenceIds: readonly string[]
}

export const proofEvidencePoolFor = (
  input: {
    readonly initialEvidenceRecords: readonly EvidenceRecord[]
    readonly contextEvidence: readonly EvidenceRecord[]
    readonly seedEvidenceIds: readonly string[]
  }
): ProofEvidencePool => {
  const evidenceRecords = [
    ...input.initialEvidenceRecords,
    ...input.contextEvidence.filter(
      (record) =>
        !input.initialEvidenceRecords.some((existing) => existing.id === record.id)
    )
  ]
  const evidenceIds = [
    ...input.contextEvidence.map((evidence) => evidence.id),
    ...input.seedEvidenceIds
  ]

  return {
    evidenceRecords,
    availableEvidenceIds: evidenceIds,
    fallbackEvidenceIds: evidenceIds
  }
}
