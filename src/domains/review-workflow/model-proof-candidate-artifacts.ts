import {
  type EvidenceRecord,
  type PromotionPolicyConfig
} from '../../shared/contracts/index.js'
import { type ContextRetrievalBudget } from '../context-retrieval/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { type ContextRequestArtifacts } from './model-context-artifacts.js'
import { type FindingInvestigationResult } from './model-agent-contracts.js'
import { investigationTraceForContextArtifacts } from './model-investigation-trace.js'
import { proofEvidencePoolFor } from './model-proof-evidence-pool.js'
import { proofEvidenceSelectionFor } from './model-proof-evidence-selection.js'
import { type ProofEvidenceSignals } from './model-proof-evidence-signals.js'
import { proofNonProvedPromotionDecision } from './model-proof-non-proved-promotion.js'
import { proofPromotionArtifactsForCandidate } from './model-proof-promotion-artifacts.js'
import {
  proofSuspicionForEvidence,
  type ProofSuspicionSeed
} from './model-proof-suspicion-seed.js'
import { proofSuspicionStatusForInvestigation } from './model-proof-suspicion-status.js'
import { type ProofLoopCandidateArtifacts } from './model-proof-task-result-aggregation.js'
import { proofTraceResultForInvestigation } from './model-proof-trace-result.js'
import { type ProviderIssue } from './model-provider-issues.js'

const requiredProofFields = [
  'changedBehavior',
  'executionOrDataPath',
  'violatedInvariant',
  'impact',
  'introducedByChange'
] as const

const missingRequiredProofFields = (
  investigationOutput: FindingInvestigationResult
): readonly string[] =>
  requiredProofFields.filter((field) => {
    const value = investigationOutput[field]

    return value === undefined || value.trim().length === 0
  })

export const proofCandidateArtifactsForInvestigation = (
  input: {
    readonly candidate: CandidateFinding
    readonly suspicionSeed: ProofSuspicionSeed
    readonly initialEvidenceRecords: readonly EvidenceRecord[]
    readonly contextArtifacts: ContextRequestArtifacts
    readonly seedEvidenceIds: readonly string[]
    readonly investigationOutput: FindingInvestigationResult
    readonly evidenceSignals: ProofEvidenceSignals
    readonly promotionPolicy: PromotionPolicyConfig
    readonly providerIssues: readonly ProviderIssue[]
    readonly retrievalBudget: ContextRetrievalBudget | undefined
    readonly usedInvestigationRounds: number
    readonly maxInvestigationRounds: number
  }
): ProofLoopCandidateArtifacts => {
  const evidencePool = proofEvidencePoolFor({
    initialEvidenceRecords: input.initialEvidenceRecords,
    contextEvidence: input.contextArtifacts.evidence,
    seedEvidenceIds: input.seedEvidenceIds
  })
  const { proofEvidenceIds, effectiveInvestigationVerdict } =
    proofEvidenceSelectionFor({
      investigationVerdict: input.investigationOutput.verdict,
      investigationEvidenceIds: input.investigationOutput.evidenceIds,
      availableEvidenceIds: evidencePool.availableEvidenceIds,
      fallbackEvidenceIds: evidencePool.fallbackEvidenceIds
    })
  const missingProofFields =
    effectiveInvestigationVerdict === 'proved'
      ? missingRequiredProofFields(input.investigationOutput)
      : []
  const effectiveVerdict =
    missingProofFields.length === 0
      ? effectiveInvestigationVerdict
      : 'needs-more-evidence'
  const effectiveRationaleSummary =
    missingProofFields.length === 0
      ? input.investigationOutput.rationaleSummary
      : `The investigation claimed a proved finding but is missing required proof fields: ${missingProofFields.join(', ')}.`
  const suspicion = proofSuspicionForEvidence({
    candidate: input.candidate,
    seed: input.suspicionSeed,
    evidenceIds: proofEvidenceIds,
    status: proofSuspicionStatusForInvestigation({
      effectiveInvestigationVerdict: effectiveVerdict
    })
  })
  const investigationTrace = investigationTraceForContextArtifacts({
    suspicionId: input.suspicionSeed.suspicionId,
    contextArtifacts: input.contextArtifacts,
    retrievalBudget: input.retrievalBudget,
    usedRounds: input.usedInvestigationRounds,
    maxRounds: input.maxInvestigationRounds,
    result: proofTraceResultForInvestigation({
      effectiveInvestigationVerdict: effectiveVerdict,
      providerIssueCount: input.providerIssues.length
    })
  })

  if (effectiveVerdict !== 'proved') {
    return {
      suspicion,
      investigationTrace,
      promotionDecision: proofNonProvedPromotionDecision({
        candidate: input.candidate,
        effectiveInvestigationVerdict: effectiveVerdict,
        rationaleSummary: effectiveRationaleSummary,
        modelWeakOrRefuted: input.promotionPolicy.modelWeakOrRefuted
      }),
      evidenceRecords: evidencePool.evidenceRecords,
      providerIssues: input.providerIssues
    }
  }

  const { proofPacket, refutationResult, promotionDecision } =
    proofPromotionArtifactsForCandidate({
      candidate: input.candidate,
      suspicionId: input.suspicionSeed.suspicionId,
      proofEvidenceIds,
      investigationOutput: input.investigationOutput,
      promotionPolicy: input.promotionPolicy,
      staticAnalysisDuplicate: input.evidenceSignals.staticAnalysisDuplicate,
      deterministicContradiction:
        input.evidenceSignals.deterministicContradiction
    })

  return {
    suspicion,
    investigationTrace,
    proofPacket,
    ...(refutationResult === undefined ? {} : { refutationResult }),
    promotionDecision,
    evidenceRecords: evidencePool.evidenceRecords,
    providerIssues: input.providerIssues
  }
}
