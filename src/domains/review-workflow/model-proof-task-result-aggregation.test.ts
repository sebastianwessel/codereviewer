import { describe, expect, test } from 'vitest'
import {
  type EvidenceRecord,
  type InvestigationTrace,
  type ModelSuspicion,
  type ProofPacket,
  type PromotionDecision,
  type RefutationResult
} from '../../shared/contracts/index.js'
import { type ProviderIssue } from './model-provider-issues.js'
import {
  emptyProofTaskArtifacts,
  proofTaskArtifactsWithCandidate
} from './model-proof-task-result-aggregation.js'

const suspicion = (id: string): ModelSuspicion => ({
  id,
  taskId: 'task_aggregation',
  category: 'bug',
  severityHint: 'high',
  title: `Suspicion ${id}`,
  hypothesis: `Hypothesis for ${id}`,
  requestedContext: [],
  contextRequests: [],
  evidenceIds: [`ev_${id}`],
  status: 'proved',
  proposedBy: 'review-agent'
})

const trace = (
  suspicionId: string,
  result: InvestigationTrace['result'] = 'proof'
): InvestigationTrace => ({
  suspicionId,
  toolCalls: [],
  contextLedgerEntryIds: [],
  budget: {
    maxReads: 1,
    usedReads: 0,
    maxSearches: 1,
    usedSearches: 0,
    maxRounds: 1,
    usedRounds: 1
  },
  result
})

const evidence = (id: string): EvidenceRecord => ({
  id,
  kind: 'tool-read',
  summary: `Evidence ${id}`,
  source: 'proof-loop',
  redactionApplied: false
})

const proofPacket: ProofPacket = {
  id: 'proof_packet_aggregation',
  suspicionId: 'susp_a',
  candidateId: 'cand_a',
  changedBehavior: 'The changed branch now drops state.',
  executionOrDataPath: 'updateState reaches the changed branch.',
  violatedInvariant: 'State must be preserved across updates.',
  impact: 'Callers can lose persisted state.',
  introducedByChange: 'The diff changed the update branch.',
  evidenceIds: ['ev_a'],
  contradictionChecks: ['No contradiction was found.'],
  fixDirection: 'Preserve the existing state before returning.'
}

const refutationResult: RefutationResult = {
  id: 'refutation_aggregation',
  proofPacketId: 'proof_packet_aggregation',
  verdict: 'proved',
  summary: 'The proof remained valid after checks.',
  evidenceIds: ['ev_a'],
  checks: [
    {
      kind: 'proof-check',
      result: 'passed',
      summary: 'The cited evidence supports the proof.',
      evidenceIds: ['ev_a']
    }
  ]
}

const promotionDecision = (
  candidateId: string,
  status: PromotionDecision['status'] = 'actionable'
): PromotionDecision => ({
  candidateId,
  proofPacketId: status === 'actionable' ? 'proof_packet_aggregation' : undefined,
  refutationId: status === 'actionable' ? 'refutation_aggregation' : undefined,
  status,
  reason: `Promotion decision for ${candidateId}`,
  policy: 'promotion-policy-v1'
})

const providerIssue: ProviderIssue = {
  code: 'provider_error',
  stage: 'suspicion-investigation',
  recovered: true,
  message: 'Provider timed out.'
}

describe('model proof task result aggregation', () => {
  test('appends candidate artifacts in order and skips absent optional proof artifacts', () => {
    const first = proofTaskArtifactsWithCandidate({
      state: emptyProofTaskArtifacts(),
      candidateArtifacts: {
        suspicion: suspicion('susp_a'),
        investigationTrace: trace('susp_a'),
        proofPacket,
        refutationResult,
        promotionDecision: promotionDecision('cand_a'),
        evidenceRecords: [evidence('ev_a')],
        providerIssues: []
      }
    })

    const result = proofTaskArtifactsWithCandidate({
      state: first,
      candidateArtifacts: {
        suspicion: suspicion('susp_b'),
        investigationTrace: trace('susp_b', 'needs-more-evidence'),
        promotionDecision: promotionDecision('cand_b', 'artifact-only'),
        evidenceRecords: [evidence('ev_b')],
        providerIssues: [providerIssue]
      }
    })

    expect(result.modelSuspicions.map((entry) => entry.id)).toEqual([
      'susp_a',
      'susp_b'
    ])
    expect(result.investigationTraces.map((entry) => entry.suspicionId)).toEqual([
      'susp_a',
      'susp_b'
    ])
    expect(result.proofPackets).toEqual([proofPacket])
    expect(result.refutationResults).toEqual([refutationResult])
    expect(result.promotionDecisions.map((entry) => entry.candidateId)).toEqual([
      'cand_a',
      'cand_b'
    ])
    expect(result.evidenceRecords.map((entry) => entry.id)).toEqual([
      'ev_a',
      'ev_b'
    ])
    expect(result.providerIssues).toEqual([providerIssue])
  })
})
