import {
  type EvidenceRecord,
  type InvestigationTrace,
  type ModelTaskDiagnostic,
  type ModelSuspicion,
  type ProofPacket,
  type PromotionDecision,
  type RefutationResult
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import {
  TaskReviewResultSchema,
  type TaskReviewResult
} from './model-agent-contracts.js'
import { type ProviderIssue } from './model-provider-issues.js'

export type ModelTaskReviewArtifacts = {
  readonly evidenceRecords: readonly EvidenceRecord[]
  readonly modelSuspicions: readonly ModelSuspicion[]
  readonly investigationTraces: readonly InvestigationTrace[]
  readonly proofPackets: readonly ProofPacket[]
  readonly refutationResults: readonly RefutationResult[]
  readonly promotionDecisions: readonly PromotionDecision[]
  readonly providerIssues: readonly ProviderIssue[]
}

export type ModelTaskReviewSiblingArtifacts = ModelTaskReviewArtifacts & {
  readonly candidates: readonly CandidateFinding[]
  readonly modelTaskDiagnostics: readonly ModelTaskDiagnostic[]
}

export const assembleModelTaskReviewResult = (input: {
  readonly primaryCandidates: readonly CandidateFinding[]
  readonly primaryArtifacts: ModelTaskReviewArtifacts
  readonly siblingArtifacts: ModelTaskReviewSiblingArtifacts
  readonly modelTaskDiagnostics: readonly ModelTaskDiagnostic[]
}): TaskReviewResult =>
  TaskReviewResultSchema.parse({
    candidates: [
      ...input.primaryCandidates,
      ...input.siblingArtifacts.candidates
    ],
    evidenceRecords: [
      ...input.primaryArtifacts.evidenceRecords,
      ...input.siblingArtifacts.evidenceRecords
    ],
    modelSuspicions: [
      ...input.primaryArtifacts.modelSuspicions,
      ...input.siblingArtifacts.modelSuspicions
    ],
    investigationTraces: [
      ...input.primaryArtifacts.investigationTraces,
      ...input.siblingArtifacts.investigationTraces
    ],
    proofPackets: [
      ...input.primaryArtifacts.proofPackets,
      ...input.siblingArtifacts.proofPackets
    ],
    refutationResults: [
      ...input.primaryArtifacts.refutationResults,
      ...input.siblingArtifacts.refutationResults
    ],
    promotionDecisions: [
      ...input.primaryArtifacts.promotionDecisions,
      ...input.siblingArtifacts.promotionDecisions
    ],
    providerIssues: [
      ...input.primaryArtifacts.providerIssues,
      ...input.siblingArtifacts.providerIssues
    ],
    modelTaskDiagnostics: [
      ...input.modelTaskDiagnostics,
      ...input.siblingArtifacts.modelTaskDiagnostics
    ]
  })
