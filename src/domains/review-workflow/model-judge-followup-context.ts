import {
  EvidenceRecordSchema,
  type EvidenceRecord
} from '../../shared/contracts/index.js'
import { type ContextRequestArtifacts } from './model-context-artifacts.js'
import { type ReviewContextDocument } from './model-agent-contracts.js'

export type JudgeFollowUpContextState = {
  readonly workingEvidence: readonly EvidenceRecord[]
  readonly additionalEvidence: readonly EvidenceRecord[]
  readonly additionalEvidenceIds: readonly string[]
  readonly additionalReviewContext: readonly ReviewContextDocument[]
}

export const judgeFollowUpContextStateWithArtifacts = (
  input: {
    readonly state: JudgeFollowUpContextState
    readonly contextArtifacts: ContextRequestArtifacts
  }
): JudgeFollowUpContextState => {
  const existingEvidenceIds = new Set(
    input.state.workingEvidence.map((record) => record.id)
  )
  const newEvidence = input.contextArtifacts.evidence.filter(
    (record) => !existingEvidenceIds.has(record.id)
  )

  return {
    workingEvidence: [...input.state.workingEvidence, ...newEvidence],
    additionalEvidence: [
      ...input.state.additionalEvidence,
      ...newEvidence.map((record) => EvidenceRecordSchema.parse(record))
    ],
    additionalEvidenceIds: [
      ...input.state.additionalEvidenceIds,
      ...input.contextArtifacts.evidence
        .map((record) => record.id)
        .filter((id) => !input.state.additionalEvidenceIds.includes(id))
    ],
    additionalReviewContext: [
      ...input.state.additionalReviewContext,
      ...input.contextArtifacts.reviewContext.filter(
        (context) =>
          !input.state.additionalReviewContext.some(
            (existing) => existing.ledgerEntryId === context.ledgerEntryId
          )
      )
    ]
  }
}
