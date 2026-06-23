import { describe, expect, test } from 'vitest'
import {
  type EvidenceRecord,
  type InvestigationTrace,
  type ProofPacket,
  type RefutationResult,
  type ReviewIntent
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import {
  ReviewWorkflowInputSchema,
  type ReviewWorkflowInput
} from './workflow-contracts.js'
import { reviewAggregateFindingProofs } from './model-aggregate-review.js'

const configHash =
  '2222222222222222222222222222222222222222222222222222222222222222'

const candidateFor = (index: number): CandidateFinding => ({
  id: `cand_agg${index}`,
  taskId: `task_agg${index}`,
  category: 'bug',
  severity: 'high',
  title: `Changed branch ${index} loses data`,
  description: `The changed branch ${index} can lose data.`,
  location: {
    path: `src/agg${index}.ts`,
    startLine: 7,
    side: 'new'
  },
  evidenceIds: [`ev_agg${index}`],
  proposedBy: 'review-agent'
})

const evidenceFor = (index: number): EvidenceRecord => ({
  id: `ev_agg${index}`,
  kind: 'diff',
  summary: `Changed branch ${index} loses data.`,
  location: {
    path: `src/agg${index}.ts`,
    startLine: 7,
    side: 'new'
  },
  source: 'diff',
  redactionApplied: true
})

const proofPacketFor = (index: number, filler = ''): ProofPacket => ({
  id: `proof_agg${index}`,
  suspicionId: `susp_agg${index}`,
  candidateId: `cand_agg${index}`,
  changedBehavior: `Changed branch can drop the payload. ${filler}`,
  executionOrDataPath: `The updated path bypasses persistence. ${filler}`,
  violatedInvariant: `Payloads must be persisted. ${filler}`,
  impact: `Callers can lose data. ${filler}`,
  introducedByChange: `The changed branch skips persistence. ${filler}`,
  evidenceIds: [`ev_agg${index}`],
  contradictionChecks: ['No alternate persistence path restores the payload.'],
  fixDirection: `Persist the payload before returning. ${filler}`
})

const refutationFor = (index: number): RefutationResult => ({
  id: `ref_agg${index}`,
  proofPacketId: `proof_agg${index}`,
  verdict: 'proved',
  summary: 'The proof is supported.',
  evidenceIds: [`ev_agg${index}`],
  checks: [
    {
      kind: 'proof-review',
      result: 'passed',
      summary: 'No contradiction was found.',
      evidenceIds: [`ev_agg${index}`]
    }
  ]
})

const investigationTrace: InvestigationTrace = {
  suspicionId: 'susp_agg1',
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
}

const reviewIntent: ReviewIntent = {
  id: 'intent_agg',
  title: 'Verify aggregate behavior',
  objective: 'Verify related changed branches.',
  paths: ['src/agg1.ts', 'src/agg2.ts'],
  taskIds: ['task_agg1', 'task_agg2'],
  focusAreas: ['data persistence'],
  riskAreas: ['data loss'],
  verificationQuestions: ['Do changed branches persist payloads?'],
  source: 'model'
}

const workflowInput = (
  input: {
    readonly judgeFindings?: boolean
    readonly maxTaskInputBytes?: number
  } = {}
): ReviewWorkflowInput =>
  ReviewWorkflowInputSchema.parse({
    runId: 'run-aggregate-review',
    reviewedPaths: ['src/agg1.ts', 'src/agg2.ts'],
    evidence: [evidenceFor(1), evidenceFor(2)],
    candidates: [candidateFor(1), candidateFor(2)],
    instructions: [],
    skills: [],
    judgeFindings: input.judgeFindings ?? true,
    ...(input.maxTaskInputBytes === undefined
      ? {}
      : { maxTaskInputBytes: input.maxTaskInputBytes }),
    provenance: {
      reviewer: 'review-agent',
      signalVersions: {},
      configHash
    }
  })

describe('aggregate finding proof review', () => {
  test('skips aggregate review when optional judging is disabled', async () => {
    const outcome = await reviewAggregateFindingProofs({
      workflowInput: workflowInput({ judgeFindings: false }),
      aggregateFindingProofs: async () => {
        throw new Error('should not run')
      },
      candidates: [candidateFor(1), candidateFor(2)],
      sharedDigest: '(no admitted shared context yet)',
      reviewIntents: [reviewIntent],
      proofPackets: [proofPacketFor(1), proofPacketFor(2)],
      refutationResults: [refutationFor(1), refutationFor(2)],
      investigationTraces: [investigationTrace],
      evidence: [evidenceFor(1), evidenceFor(2)]
    })

    expect(outcome.aggregateResults).toEqual([])
    expect(outcome.providerIssues).toEqual([])
  })

  test('maps non-valid aggregate decisions into rejected findings and admission decisions', async () => {
    const outcome = await reviewAggregateFindingProofs({
      workflowInput: workflowInput(),
      aggregateFindingProofs: async () => ({
        verdict: 'mixed',
        summary: 'The first proof is duplicate and the second needs evidence.',
        evidenceIds: ['ev_agg1'],
        decisions: [
          {
            candidateId: 'cand_agg1',
            verdict: 'false-positive',
            summary: 'This proof duplicates a stronger finding.',
            evidenceIds: ['ev_agg1'],
            relatedCandidateIds: ['cand_agg2']
          },
          {
            candidateId: 'cand_agg2',
            verdict: 'needs-more-evidence',
            summary: 'This proof needs a persistence confirmation.',
            evidenceIds: ['ev_agg2'],
            relatedCandidateIds: ['cand_agg1']
          }
        ],
        similarIssueChecks: []
      }),
      candidates: [candidateFor(1), candidateFor(2)],
      sharedDigest: '(no admitted shared context yet)',
      reviewIntents: [reviewIntent],
      proofPackets: [proofPacketFor(1), proofPacketFor(2)],
      refutationResults: [refutationFor(1), refutationFor(2)],
      investigationTraces: [investigationTrace],
      evidence: [evidenceFor(1), evidenceFor(2)]
    })

    expect(outcome.aggregateResults).toHaveLength(1)
    expect([...outcome.rejectedCandidateIds]).toEqual([
      'cand_agg1',
      'cand_agg2'
    ])
    expect([...outcome.coveredCandidateIds]).toEqual([
      'cand_agg1',
      'cand_agg2'
    ])
    expect(outcome.rejectedFindings.map((finding) => finding.reason)).toEqual([
      'refuted',
      'insufficient-evidence'
    ])
    expect(
      outcome.admissionDecisions.map((decision) => decision.rejectedReason)
    ).toEqual(['refuted', 'insufficient-evidence'])
  })

  test('records aggregate packet budget failures as recovered provider issues', async () => {
    const filler = 'x'.repeat(950)
    const proofPackets = Array.from({ length: 20 }, (_value, index) =>
      proofPacketFor(index + 1, filler)
    )
    const candidates = Array.from({ length: 20 }, (_value, index) =>
      candidateFor(index + 1)
    )
    const evidence = Array.from({ length: 20 }, (_value, index) =>
      evidenceFor(index + 1)
    )
    const refutations = Array.from({ length: 20 }, (_value, index) =>
      refutationFor(index + 1)
    )

    const outcome = await reviewAggregateFindingProofs({
      workflowInput: ReviewWorkflowInputSchema.parse({
        ...workflowInput({ maxTaskInputBytes: 10000 }),
        reviewedPaths: candidates.map((candidate) => candidate.location.path),
        candidates,
        evidence
      }),
      aggregateFindingProofs: async () => {
        throw new Error('should not run')
      },
      candidates,
      sharedDigest: '(no admitted shared context yet)',
      reviewIntents: [],
      proofPackets,
      refutationResults: refutations,
      investigationTraces: [],
      evidence
    })

    expect(outcome.aggregateResults).toEqual([])
    expect(outcome.providerIssues).toEqual([
      expect.objectContaining({
        code: 'task_packet_budget_exceeded',
        stage: 'aggregate-packet',
        recovered: true
      })
    ])
  })

  test('records aggregate provider failures as recovered provider issues', async () => {
    const outcome = await reviewAggregateFindingProofs({
      workflowInput: workflowInput(),
      aggregateFindingProofs: async () => {
        throw new Error('aggregate timeout')
      },
      candidates: [candidateFor(1), candidateFor(2)],
      sharedDigest: '(no admitted shared context yet)',
      reviewIntents: [reviewIntent],
      proofPackets: [proofPacketFor(1), proofPacketFor(2)],
      refutationResults: [refutationFor(1), refutationFor(2)],
      investigationTraces: [investigationTrace],
      evidence: [evidenceFor(1), evidenceFor(2)]
    })

    expect(outcome.aggregateResults).toEqual([])
    expect(outcome.providerIssues).toEqual([
      expect.objectContaining({
        code: 'provider_timeout',
        stage: 'aggregate-proof-review',
        recovered: true
      })
    ])
  })
})
