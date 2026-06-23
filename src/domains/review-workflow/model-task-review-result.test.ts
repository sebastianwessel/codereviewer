import { describe, expect, test } from 'vitest'
import {
  type EvidenceRecord,
  type InvestigationTrace,
  type ModelSuspicion,
  type ProofPacket,
  type PromotionDecision,
  type RefutationResult
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { type TaskReviewResult } from './model-agent-contracts.js'
import { assembleModelTaskReviewResult } from './model-task-review-result.js'

const candidateFor = (suffix: 'primary' | 'sibling'): CandidateFinding => ({
  id: suffix === 'primary' ? 'cand_primary' : 'cand_sibling',
  taskId: 'task_result',
  category: 'bug',
  severity: 'high',
  title: `${suffix} candidate`,
  description: `${suffix} candidate description`,
  location: {
    path: `src/${suffix}.ts`,
    startLine: 7,
    side: 'file'
  },
  evidenceIds: [`ev_${suffix}`],
  proposedBy: 'review-agent'
})

const evidenceFor = (suffix: 'primary' | 'sibling'): EvidenceRecord => ({
  id: `ev_${suffix}`,
  kind: 'diff',
  summary: `${suffix} evidence`,
  location: {
    path: `src/${suffix}.ts`,
    startLine: 7,
    side: 'new'
  },
  source: 'diff',
  redactionApplied: true
})

const suspicionFor = (suffix: 'primary' | 'sibling'): ModelSuspicion => ({
  id: `susp_${suffix}`,
  taskId: 'task_result',
  category: 'bug',
  severityHint: 'high',
  title: `${suffix} suspicion`,
  hypothesis: `${suffix} hypothesis`,
  primaryLocation: {
    path: `src/${suffix}.ts`,
    startLine: 7,
    side: 'file'
  },
  contextRequests: [],
  requestedContext: [],
  evidenceIds: [`ev_${suffix}`],
  status: 'proved',
  proposedBy: 'review-agent'
})

const traceFor = (suffix: 'primary' | 'sibling'): InvestigationTrace => ({
  suspicionId: `susp_${suffix}`,
  toolCalls: [],
  contextLedgerEntryIds: [],
  budget: {
    maxReads: 0,
    usedReads: 0,
    maxSearches: 0,
    usedSearches: 0,
    maxRounds: 1,
    usedRounds: 1
  },
  result: 'proof'
})

const proofFor = (suffix: 'primary' | 'sibling'): ProofPacket => ({
  id: `proof_${suffix}`,
  suspicionId: `susp_${suffix}`,
  candidateId: suffix === 'primary' ? 'cand_primary' : 'cand_sibling',
  changedBehavior: `${suffix} changed behavior`,
  executionOrDataPath: `${suffix} execution path`,
  violatedInvariant: `${suffix} invariant`,
  impact: `${suffix} impact`,
  introducedByChange: `${suffix} introduced by change`,
  evidenceIds: [`ev_${suffix}`],
  contradictionChecks: [`${suffix} contradiction check`],
  fixDirection: `${suffix} fix direction`
})

const refutationFor = (suffix: 'primary' | 'sibling'): RefutationResult => ({
  id: `refute_${suffix}`,
  proofPacketId: `proof_${suffix}`,
  verdict: 'proved',
  summary: `${suffix} refutation summary`,
  evidenceIds: [`ev_${suffix}`],
  checks: []
})

const promotionFor = (suffix: 'primary' | 'sibling'): PromotionDecision => ({
  candidateId: suffix === 'primary' ? 'cand_primary' : 'cand_sibling',
  proofPacketId: `proof_${suffix}`,
  refutationId: `refute_${suffix}`,
  status: 'actionable',
  reason: `${suffix} promotion reason`,
  policy: 'promotion-policy-v1'
})

const artifactsFor = (suffix: 'primary' | 'sibling') => ({
  evidenceRecords: [evidenceFor(suffix)],
  modelSuspicions: [suspicionFor(suffix)],
  investigationTraces: [traceFor(suffix)],
  proofPackets: [proofFor(suffix)],
  refutationResults: [refutationFor(suffix)],
  promotionDecisions: [promotionFor(suffix)],
  providerIssues: [
    {
      code: 'provider_error',
      stage: `${suffix}-stage`,
      recovered: true,
      message: `${suffix} issue`
    }
  ]
})

describe('model task review result assembly', () => {
  test('preserves primary-before-sibling ordering across result artifacts', () => {
    const primaryCandidate = candidateFor('primary')
    const siblingCandidate = candidateFor('sibling')

    const result: TaskReviewResult = assembleModelTaskReviewResult({
      primaryCandidates: [primaryCandidate],
      primaryArtifacts: artifactsFor('primary'),
      siblingArtifacts: {
        candidates: [siblingCandidate],
        modelTaskDiagnostics: [],
        ...artifactsFor('sibling')
      },
      modelTaskDiagnostics: []
    })

    expect(result.candidates.map((candidate) => candidate.id)).toEqual([
      'cand_primary',
      'cand_sibling'
    ])
    expect(result.evidenceRecords.map((evidence) => evidence.id)).toEqual([
      'ev_primary',
      'ev_sibling'
    ])
    expect(result.modelSuspicions.map((suspicion) => suspicion.id)).toEqual([
      'susp_primary',
      'susp_sibling'
    ])
    expect(result.investigationTraces.map((trace) => trace.suspicionId)).toEqual([
      'susp_primary',
      'susp_sibling'
    ])
    expect(result.proofPackets.map((proofPacket) => proofPacket.id)).toEqual([
      'proof_primary',
      'proof_sibling'
    ])
    expect(result.refutationResults.map((refutation) => refutation.id)).toEqual([
      'refute_primary',
      'refute_sibling'
    ])
    expect(result.promotionDecisions.map((decision) => decision.candidateId)).toEqual([
      'cand_primary',
      'cand_sibling'
    ])
    expect(result.providerIssues.map((issue) => issue.stage)).toEqual([
      'primary-stage',
      'sibling-stage'
    ])
  })
})
