import {
  type EvidenceRecord,
  type InvestigationTrace,
  type ModelSuspicion,
  type ProofPacket,
  type PromotionDecision,
  type RefutationResult
} from '../../shared/contracts/index.js'
import { type ProviderIssue } from './model-provider-issues.js'

export type ProofLoopCandidateArtifacts = {
  readonly suspicion: ModelSuspicion
  readonly investigationTrace: InvestigationTrace
  readonly proofPacket?: ProofPacket
  readonly refutationResult?: RefutationResult
  readonly promotionDecision: PromotionDecision
  readonly evidenceRecords: readonly EvidenceRecord[]
  readonly providerIssues: readonly ProviderIssue[]
}

export type ProofTaskArtifacts = {
  readonly modelSuspicions: ModelSuspicion[]
  readonly investigationTraces: InvestigationTrace[]
  readonly proofPackets: ProofPacket[]
  readonly refutationResults: RefutationResult[]
  readonly promotionDecisions: PromotionDecision[]
  readonly evidenceRecords: EvidenceRecord[]
  readonly providerIssues: ProviderIssue[]
}

export const emptyProofTaskArtifacts = (): ProofTaskArtifacts => ({
  modelSuspicions: [],
  investigationTraces: [],
  proofPackets: [],
  refutationResults: [],
  promotionDecisions: [],
  evidenceRecords: [],
  providerIssues: []
})

export const proofTaskArtifactsWithCandidate = (input: {
  readonly state: ProofTaskArtifacts
  readonly candidateArtifacts: ProofLoopCandidateArtifacts
}): ProofTaskArtifacts => {
  input.state.modelSuspicions.push(input.candidateArtifacts.suspicion)
  input.state.investigationTraces.push(
    input.candidateArtifacts.investigationTrace
  )
  input.state.evidenceRecords.push(
    ...input.candidateArtifacts.evidenceRecords
  )
  input.state.providerIssues.push(...input.candidateArtifacts.providerIssues)
  if (input.candidateArtifacts.proofPacket !== undefined) {
    input.state.proofPackets.push(input.candidateArtifacts.proofPacket)
  }
  if (input.candidateArtifacts.refutationResult !== undefined) {
    input.state.refutationResults.push(
      input.candidateArtifacts.refutationResult
    )
  }
  input.state.promotionDecisions.push(
    input.candidateArtifacts.promotionDecision
  )

  return input.state
}
