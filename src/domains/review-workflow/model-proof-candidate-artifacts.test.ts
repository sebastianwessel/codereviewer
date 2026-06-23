import { describe, expect, test } from 'vitest'
import {
  type EvidenceRecord,
  type PromotionPolicyConfig
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { type ProviderIssue } from './model-provider-issues.js'
import { proofCandidateArtifactsForInvestigation } from './model-proof-candidate-artifacts.js'
import {
  type ProofSuspicionSeed,
  proofSuspicionSeedForCandidate
} from './model-proof-suspicion-seed.js'

const candidate: CandidateFinding = {
  id: 'cand_final',
  taskId: 'task_final',
  category: 'bug',
  severity: 'high',
  title: 'Changed branch can lose data',
  description: 'The changed branch can lose data.',
  location: {
    path: 'src/task.ts',
    startLine: 9,
    side: 'file'
  },
  evidenceIds: ['ev_task1'],
  proposedBy: 'review-agent'
}

const seed: ProofSuspicionSeed = proofSuspicionSeedForCandidate({
  candidate,
  contextRequests: [],
  requestedContext: []
})

const promotionPolicy: PromotionPolicyConfig = {
  modelProof: 'actionable',
  modelWeakOrRefuted: 'artifact-only',
  staticAnalysisDuplicate: 'artifact-only',
  deterministicContradiction: 'rejected'
}

const evidence: EvidenceRecord = {
  id: 'ev_task1',
  kind: 'diff',
  summary: 'The changed file contains a suspicious branch.',
  location: {
    path: 'src/task.ts',
    startLine: 9,
    side: 'new'
  },
  source: 'diff',
  redactionApplied: true
}

const providerIssue: ProviderIssue = {
  code: 'provider_error',
  stage: 'suspicion-investigation-context',
  recovered: true,
  message: 'Context retrieval timed out.'
}

describe('model proof candidate artifacts', () => {
  test('finalizes non-proved investigations as weak promotions with provider issues', () => {
    const result = proofCandidateArtifactsForInvestigation({
      candidate,
      suspicionSeed: seed,
      initialEvidenceRecords: [],
      contextArtifacts: {
        evidence: [],
        reviewContext: []
      },
      seedEvidenceIds: [],
      investigationOutput: {
        verdict: 'needs-more-evidence',
        rationaleSummary: 'The investigation needs more evidence.',
        evidenceIds: [],
        contextRequests: [],
        requestedContext: [],
        contradictionChecks: []
      },
      evidenceSignals: {
        staticAnalysisDuplicate: false,
        deterministicContradiction: false
      },
      promotionPolicy,
      providerIssues: [providerIssue],
      retrievalBudget: undefined,
      usedInvestigationRounds: 1,
      maxInvestigationRounds: 2
    })

    expect(result).toEqual({
      suspicion: expect.objectContaining({
        id: seed.suspicionId,
        status: 'needs-more-evidence',
        evidenceIds: []
      }),
      investigationTrace: expect.objectContaining({
        suspicionId: seed.suspicionId,
        result: 'provider-error'
      }),
      promotionDecision: {
        candidateId: 'cand_final',
        status: 'artifact-only',
        reason: 'The investigation needs more evidence.',
        policy: 'promotion-policy-v1'
      },
      evidenceRecords: [],
      providerIssues: [providerIssue]
    })
    expect(result.proofPacket).toBeUndefined()
    expect(result.refutationResult).toBeUndefined()
  })

  test('finalizes proved investigations with proof and promotion artifacts pending active refutation', () => {
    const result = proofCandidateArtifactsForInvestigation({
      candidate,
      suspicionSeed: seed,
      initialEvidenceRecords: [evidence],
      contextArtifacts: {
        evidence: [],
        reviewContext: []
      },
      seedEvidenceIds: ['ev_task1'],
      investigationOutput: {
        verdict: 'proved',
        rationaleSummary: 'The changed branch loses data.',
        evidenceIds: ['ev_task1'],
        contextRequests: [],
        requestedContext: [],
        changedBehavior: 'The changed branch loses data.',
        executionOrDataPath: 'The changed branch is reachable.',
        violatedInvariant: 'Payload data must be preserved.',
        impact: 'Callers can lose data.',
        introducedByChange: 'The reviewed branch changed persistence.',
        contradictionChecks: ['No contradiction was found.'],
        fixDirection: 'Preserve payload data before returning.'
      },
      evidenceSignals: {
        staticAnalysisDuplicate: false,
        deterministicContradiction: false
      },
      promotionPolicy,
      providerIssues: [],
      retrievalBudget: undefined,
      usedInvestigationRounds: 1,
      maxInvestigationRounds: 2
    })

    expect(result.suspicion).toEqual(
      expect.objectContaining({
        id: seed.suspicionId,
        status: 'proved',
        evidenceIds: ['ev_task1']
      })
    )
    expect(result.investigationTrace).toEqual(
      expect.objectContaining({
        suspicionId: seed.suspicionId,
        result: 'proof'
      })
    )
    expect(result.proofPacket).toEqual(
      expect.objectContaining({
        candidateId: 'cand_final',
        suspicionId: seed.suspicionId,
        evidenceIds: ['ev_task1']
      })
    )
    expect(result.refutationResult).toBeUndefined()
    expect(result.promotionDecision).toEqual(
      expect.objectContaining({
        candidateId: 'cand_final',
        proofPacketId: result.proofPacket?.id,
        status: 'actionable'
      })
    )
    expect(result.promotionDecision).not.toHaveProperty('refutationId')
    expect(result.evidenceRecords).toEqual([evidence])
    expect(result.providerIssues).toEqual([])
  })

  test('demotes proved investigations that do not explicitly prove required proof dimensions', () => {
    const result = proofCandidateArtifactsForInvestigation({
      candidate,
      suspicionSeed: seed,
      initialEvidenceRecords: [evidence],
      contextArtifacts: {
        evidence: [],
        reviewContext: []
      },
      seedEvidenceIds: ['ev_task1'],
      investigationOutput: {
        verdict: 'proved',
        rationaleSummary: 'The model says this looks wrong.',
        evidenceIds: ['ev_task1'],
        contextRequests: [],
        requestedContext: [],
        contradictionChecks: []
      },
      evidenceSignals: {
        staticAnalysisDuplicate: false,
        deterministicContradiction: false
      },
      promotionPolicy,
      providerIssues: [],
      retrievalBudget: undefined,
      usedInvestigationRounds: 1,
      maxInvestigationRounds: 2
    })

    expect(result.suspicion).toEqual(
      expect.objectContaining({
        id: seed.suspicionId,
        status: 'needs-more-evidence',
        evidenceIds: ['ev_task1']
      })
    )
    expect(result.proofPacket).toBeUndefined()
    expect(result.refutationResult).toBeUndefined()
    expect(result.promotionDecision).toEqual(
      expect.objectContaining({
        candidateId: 'cand_final',
        status: 'artifact-only'
      })
    )
    expect(result.promotionDecision?.reason).toContain(
      'missing required proof fields'
    )
  })
})
