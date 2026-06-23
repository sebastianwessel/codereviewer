import { describe, expect, test } from 'vitest'
import { type PromotionPolicyConfig } from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { type FindingInvestigationResult } from './model-agent-contracts.js'
import { proofPromotionArtifactsForCandidate } from './model-proof-promotion-artifacts.js'

const candidate: CandidateFinding = {
  id: 'cand_proofpromotion',
  taskId: 'task_proofpromotion',
  category: 'bug',
  severity: 'high',
  title: 'Changed branch drops state',
  description: 'The changed branch drops state before returning.',
  location: {
    path: 'src/task.ts',
    startLine: 9,
    side: 'new'
  },
  evidenceIds: ['ev_task1'],
  proposedBy: 'review-agent'
}

const promotionPolicy: PromotionPolicyConfig = {
  modelProof: 'actionable',
  modelWeakOrRefuted: 'artifact-only',
  staticAnalysisDuplicate: 'artifact-only',
  deterministicContradiction: 'rejected'
}

const investigationOutput: FindingInvestigationResult = {
  verdict: 'proved',
  rationaleSummary: 'The changed branch drops state and no guard restores it.',
  evidenceIds: ['ev_task1'],
  contextRequests: [],
  requestedContext: [],
  changedBehavior: 'The changed branch drops state.',
  executionOrDataPath: 'The reviewed branch is reachable from updateState.',
  violatedInvariant: 'State must be preserved across updates.',
  impact: 'Callers can lose persisted state.',
  introducedByChange: 'The diff changed the update branch.',
  contradictionChecks: ['No contradiction was found.']
}

describe('model proof promotion artifacts', () => {
  test('does not synthesize a proved refutation for ordinary model proofs', () => {
    const result = proofPromotionArtifactsForCandidate({
      candidate,
      suspicionId: 'susp_proofpromotion',
      proofEvidenceIds: ['ev_task1'],
      investigationOutput,
      promotionPolicy,
      staticAnalysisDuplicate: false,
      deterministicContradiction: false
    })

    expect(result.proofPacket).toEqual(
      expect.objectContaining({
        candidateId: 'cand_proofpromotion',
        suspicionId: 'susp_proofpromotion',
        evidenceIds: ['ev_task1']
      })
    )
    expect(result.refutationResult).toBeUndefined()
    expect(result.promotionDecision).toEqual(
      expect.objectContaining({
        candidateId: 'cand_proofpromotion',
        proofPacketId: result.proofPacket.id,
        status: 'actionable'
      })
    )
    expect(result.promotionDecision).not.toHaveProperty('refutationId')
  })

  test('refutes and rejects proof artifacts with deterministic contradiction evidence', () => {
    const result = proofPromotionArtifactsForCandidate({
      candidate,
      suspicionId: 'susp_proofpromotion',
      proofEvidenceIds: ['ev_task1'],
      investigationOutput,
      promotionPolicy,
      staticAnalysisDuplicate: false,
      deterministicContradiction: true
    })

    expect(result.proofPacket).toEqual(
      expect.objectContaining({
        candidateId: 'cand_proofpromotion',
        suspicionId: 'susp_proofpromotion',
        evidenceIds: ['ev_task1']
      })
    )
    const refutationResult = result.refutationResult
    expect(refutationResult).toEqual(
      expect.objectContaining({
        proofPacketId: result.proofPacket.id,
        verdict: 'refuted',
        summary: 'Deterministic contradiction evidence refuted the proof packet.'
      })
    )
    expect(result.promotionDecision).toEqual(
      expect.objectContaining({
        candidateId: 'cand_proofpromotion',
        proofPacketId: result.proofPacket.id,
        refutationId: refutationResult?.id,
        status: 'rejected'
      })
    )
    expect(result.promotionDecision.reason).toContain(
      'deterministicContradiction=rejected'
    )
  })

  test('demotes static-analysis duplicates without synthesizing a refutation', () => {
    const result = proofPromotionArtifactsForCandidate({
      candidate,
      suspicionId: 'susp_proofpromotion',
      proofEvidenceIds: ['ev_task1'],
      investigationOutput,
      promotionPolicy,
      staticAnalysisDuplicate: true,
      deterministicContradiction: false
    })

    expect(result.refutationResult).toBeUndefined()
    expect(result.promotionDecision).toEqual(
      expect.objectContaining({
        proofPacketId: result.proofPacket.id,
        status: 'artifact-only'
      })
    )
    expect(result.promotionDecision).not.toHaveProperty('refutationId')
    expect(result.promotionDecision.reason).toContain(
      'staticAnalysisDuplicate=artifact-only'
    )
  })

  test('truncates long rationale text when copying it into contradiction checks', () => {
    const result = proofPromotionArtifactsForCandidate({
      candidate,
      suspicionId: 'susp_proofpromotion',
      proofEvidenceIds: ['ev_task1'],
      investigationOutput: {
        ...investigationOutput,
        rationaleSummary: 'The provider returned a detailed proof. '.repeat(30)
      },
      promotionPolicy,
      staticAnalysisDuplicate: false,
      deterministicContradiction: false
    })

    expect(result.proofPacket.contradictionChecks[0]?.length).toBeLessThanOrEqual(
      500
    )
    expect(result.refutationResult).toBeUndefined()
  })
})
