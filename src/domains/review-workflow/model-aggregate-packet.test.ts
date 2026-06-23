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
import {
  findingAggregateInputForProofs,
  findingAggregateResultForModelOutput
} from './model-aggregate-packet.js'
import { isTaskPacketBudgetExceededError } from './model-task-packet.js'

const configHash =
  '1111111111111111111111111111111111111111111111111111111111111111'

const candidateFor = (index: number): CandidateFinding => ({
  id: `cand_bug${index}`,
  taskId: `task_app${index}`,
  category: 'bug',
  severity: 'high',
  title: `Changed branch ${index} returns wrong value`,
  description: `The changed branch ${index} can return the wrong value.`,
  location: {
    path: `src/app${index}.ts`,
    startLine: 4,
    side: 'new'
  },
  evidenceIds: [`ev_diff${index}`],
  proposedBy: 'review-agent'
})

const evidenceFor = (index: number): EvidenceRecord => ({
  id: `ev_diff${index}`,
  kind: 'diff',
  summary: `Changed branch ${index} can return an incorrect value.`,
  location: {
    path: `src/app${index}.ts`,
    startLine: 4,
    side: 'new'
  },
  source: 'diff',
  redactionApplied: true
})

const proofPacketFor = (
  index: number,
  filler = ''
): ProofPacket => ({
  id: `proof_bug${index}`,
  suspicionId: `susp_bug${index}`,
  candidateId: `cand_bug${index}`,
  changedBehavior: `The changed branch returns the intermediate value. ${filler}`,
  executionOrDataPath: `The positive path now bypasses the expected value. ${filler}`,
  violatedInvariant: `Positive input must return the expected value. ${filler}`,
  impact: `Callers can receive stale data. ${filler}`,
  introducedByChange: `The conditional branch changed in this diff. ${filler}`,
  evidenceIds: [`ev_diff${index}`],
  contradictionChecks: ['No guard restores the expected value.'],
  fixDirection: `Return expectedValue for the positive path. ${filler}`
})

const refutationFor = (index: number): RefutationResult => ({
  id: `ref_bug${index}`,
  proofPacketId: `proof_bug${index}`,
  verdict: 'proved',
  summary: 'The proof is supported.',
  evidenceIds: [`ev_diff${index}`],
  checks: [
    {
      kind: 'proof-review',
      result: 'passed',
      summary: 'The refutation check found no contradiction.',
      evidenceIds: [`ev_diff${index}`]
    }
  ]
})

const reviewIntent: ReviewIntent = {
  id: 'intent_main',
  title: 'Verify changed branches',
  objective: 'Verify the changed branches end to end.',
  paths: ['src/app1.ts', 'src/app2.ts'],
  taskIds: ['task_app1', 'task_app2'],
  focusAreas: ['branch behavior'],
  riskAreas: ['incorrect return value'],
  verificationQuestions: ['Do changed branches return expectedValue?'],
  source: 'model'
}

const unrelatedReviewIntent: ReviewIntent = {
  id: 'intent_unrelated',
  title: 'Verify unrelated migration',
  objective: 'Verify an unrelated migration task.',
  paths: ['src/unrelated.ts'],
  taskIds: ['task_unrelated'],
  focusAreas: ['migration'],
  riskAreas: ['schema mismatch'],
  verificationQuestions: ['Does the unrelated migration preserve data?'],
  source: 'model'
}

const investigationTrace: InvestigationTrace = {
  suspicionId: 'susp_bug1',
  toolCalls: [
    {
      tool: 'read',
      status: 'completed',
      ledgerEntryId: 'ctx_aaaaaaaa',
      summary: `Investigated surrounding implementation. ${'x'.repeat(400)}`
    }
  ],
  contextLedgerEntryIds: ['ctx_aaaaaaaa'],
  budget: {
    maxReads: 1,
    usedReads: 1,
    maxSearches: 0,
    usedSearches: 0,
    maxRounds: 1,
    usedRounds: 1
  },
  result: 'proof'
}

const investigationTraceFor = (index: number): InvestigationTrace => ({
  ...investigationTrace,
  suspicionId: `susp_bug${index}`
})

const workflowInput = (maxTaskInputBytes?: number): ReviewWorkflowInput =>
  ReviewWorkflowInputSchema.parse({
    runId: 'run-aggregate-packet',
    reviewedPaths: ['src/app1.ts', 'src/app2.ts'],
    evidence: [evidenceFor(1), evidenceFor(2)],
    candidates: [candidateFor(1), candidateFor(2)],
    instructions: [],
    skills: [],
    ...(maxTaskInputBytes === undefined ? {} : { maxTaskInputBytes }),
    provenance: {
      reviewer: 'review-agent',
      signalVersions: {},
      configHash
    }
  })

describe('finding aggregate packet', () => {
  test('drops optional intent, trace, and shared digest context before proof evidence', () => {
    const packet = findingAggregateInputForProofs({
      workflowInput: workflowInput(10000),
      candidates: [candidateFor(1), candidateFor(2)],
      sharedDigest: `admitted context ${'x'.repeat(12000)}`,
      reviewIntents: [reviewIntent],
      proofPackets: [proofPacketFor(1), proofPacketFor(2)],
      refutationResults: [refutationFor(1), refutationFor(2)],
      investigationTraces: [investigationTrace],
      evidence: [evidenceFor(1), evidenceFor(2)]
    })

    expect(packet.input.reviewIntents).toEqual([])
    expect(packet.input.investigationTraces).toEqual([])
    expect(packet.input.sharedDigest).toBe(
      '(shared digest omitted for aggregate packet budget)'
    )
    expect(packet.input.candidates.map((candidate) => candidate.id)).toEqual([
      'cand_bug1',
      'cand_bug2'
    ])
    expect(packet.input.proofPackets).toHaveLength(2)
    expect(packet.input.refutationResults).toHaveLength(2)
    expect(packet.input.evidence.map((record) => record.id).sort()).toEqual([
      'ev_diff1',
      'ev_diff2'
    ])
  })

  test('scopes refutations, traces, and evidence to the provided proof packets', () => {
    const packet = findingAggregateInputForProofs({
      workflowInput: ReviewWorkflowInputSchema.parse({
        ...workflowInput(),
        evidence: [evidenceFor(1), evidenceFor(2), evidenceFor(3)]
      }),
      candidates: [candidateFor(1), candidateFor(2), candidateFor(3)],
      sharedDigest: '(no admitted shared context yet)',
      reviewIntents: [reviewIntent],
      proofPackets: [proofPacketFor(1), proofPacketFor(2)],
      refutationResults: [refutationFor(1), refutationFor(2), refutationFor(3)],
      investigationTraces: [
        investigationTraceFor(1),
        investigationTraceFor(2),
        investigationTraceFor(3)
      ],
      evidence: [evidenceFor(1), evidenceFor(2), evidenceFor(3)]
    })

    expect(packet.input.candidates.map((candidate) => candidate.id)).toEqual([
      'cand_bug1',
      'cand_bug2'
    ])
    expect(packet.input.refutationResults.map((result) => result.id)).toEqual([
      'ref_bug1',
      'ref_bug2'
    ])
    expect(packet.input.investigationTraces.map((trace) => trace.suspicionId)).toEqual([
      'susp_bug1',
      'susp_bug2'
    ])
    expect(packet.input.evidence.map((record) => record.id).sort()).toEqual([
      'ev_diff1',
      'ev_diff2'
    ])
  })

  test('scopes review intents to proof-covered candidates', () => {
    const packet = findingAggregateInputForProofs({
      workflowInput: workflowInput(),
      candidates: [candidateFor(1), candidateFor(2)],
      sharedDigest: '(no admitted shared context yet)',
      reviewIntents: [reviewIntent, unrelatedReviewIntent],
      proofPackets: [proofPacketFor(1)],
      refutationResults: [refutationFor(1)],
      investigationTraces: [investigationTraceFor(1)],
      evidence: [evidenceFor(1), evidenceFor(2)]
    })

    expect(packet.input.candidates.map((candidate) => candidate.id)).toEqual([
      'cand_bug1'
    ])
    expect(packet.input.reviewIntents.map((intent) => intent.id)).toEqual([
      'intent_main'
    ])
  })

  test('throws the shared packet budget error when aggregate proof material is irreducible', () => {
    let thrown: unknown
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

    try {
      findingAggregateInputForProofs({
        workflowInput: ReviewWorkflowInputSchema.parse({
          ...workflowInput(10000),
          reviewedPaths: candidates.map((candidate) => candidate.location.path),
          candidates,
          evidence
        }),
        candidates,
        sharedDigest: '(no admitted shared context yet)',
        reviewIntents: [],
        proofPackets,
        refutationResults: refutations,
        investigationTraces: [],
        evidence
      })
    } catch (error: unknown) {
      thrown = error
    }

    expect(isTaskPacketBudgetExceededError(thrown)).toBe(true)
  })

  test('normalizes aggregate model output to the aggregate packet scope', () => {
    const aggregateInput = findingAggregateInputForProofs({
      workflowInput: workflowInput(),
      candidates: [candidateFor(1), candidateFor(2)],
      sharedDigest: '(no admitted shared context yet)',
      reviewIntents: [reviewIntent],
      proofPackets: [proofPacketFor(1), proofPacketFor(2)],
      refutationResults: [refutationFor(1), refutationFor(2)],
      investigationTraces: [investigationTrace],
      evidence: [evidenceFor(1), evidenceFor(2)]
    }).input

    const result = findingAggregateResultForModelOutput({
      aggregateInput,
      output: {
        verdict: 'mixed',
        summary: 'One finding is valid and duplicate context needs pruning.',
        evidenceIds: ['ev_diff1', 'ev_unknown'],
        decisions: [
          {
            candidateId: 'cand_bug1',
            verdict: 'valid',
            summary: 'The first finding is supported.',
            evidenceIds: ['ev_diff2', 'ev_unknown'],
            relatedCandidateIds: ['cand_bug2', 'cand_unknown']
          },
          {
            candidateId: 'cand_unknown',
            verdict: 'false-positive',
            summary: 'This candidate is outside the aggregate packet.',
            evidenceIds: ['ev_diff1'],
            relatedCandidateIds: ['cand_bug1']
          }
        ],
        similarIssueChecks: [
          {
            kind: 'sibling-sweep',
            result: 'passed',
            summary: 'The related candidate was checked.',
            evidenceIds: ['ev_diff1', 'ev_diff2', 'ev_unknown']
          }
        ]
      }
    })

    expect(result.candidateIds).toEqual(['cand_bug1', 'cand_bug2'])
    expect(result.evidenceIds).toEqual(['ev_diff1'])
    expect(result.decisions).toEqual([
      {
        candidateId: 'cand_bug1',
        verdict: 'valid',
        summary: 'The first finding is supported.',
        evidenceIds: ['ev_diff2'],
        relatedCandidateIds: ['cand_bug2']
      }
    ])
    expect(result.similarIssueChecks).toEqual([
      {
        kind: 'sibling-sweep',
        result: 'passed',
        summary: 'The related candidate was checked.',
        evidenceIds: ['ev_diff1', 'ev_diff2']
      }
    ])
  })

  test('does not keep decisive aggregate verdicts without cited evidence', () => {
    const aggregateInput = findingAggregateInputForProofs({
      workflowInput: workflowInput(),
      candidates: [candidateFor(1), candidateFor(2)],
      sharedDigest: '(no admitted shared context yet)',
      reviewIntents: [reviewIntent],
      proofPackets: [proofPacketFor(1), proofPacketFor(2)],
      refutationResults: [refutationFor(1), refutationFor(2)],
      investigationTraces: [investigationTrace],
      evidence: [evidenceFor(1), evidenceFor(2)]
    }).input

    const result = findingAggregateResultForModelOutput({
      aggregateInput,
      output: {
        verdict: 'mixed',
        summary: 'The batch critic rejected one finding without evidence.',
        evidenceIds: [],
        decisions: [
          {
            candidateId: 'cand_bug1',
            verdict: 'false-positive',
            summary: 'This proof is contradicted.',
            evidenceIds: [],
            relatedCandidateIds: []
          },
          {
            candidateId: 'cand_bug2',
            verdict: 'valid',
            summary: 'This proof is supported only by an unknown reference.',
            evidenceIds: ['ev_unknown'],
            relatedCandidateIds: []
          }
        ],
        similarIssueChecks: []
      }
    })

    expect(result.decisions).toEqual([
      {
        candidateId: 'cand_bug1',
        verdict: 'needs-more-evidence',
        summary: 'This proof is contradicted.',
        evidenceIds: [],
        relatedCandidateIds: []
      },
      {
        candidateId: 'cand_bug2',
        verdict: 'needs-more-evidence',
        summary: 'This proof is supported only by an unknown reference.',
        evidenceIds: [],
        relatedCandidateIds: []
      }
    ])
  })

  test('does not keep a decisive aggregate result verdict without cited evidence', () => {
    const aggregateInput = findingAggregateInputForProofs({
      workflowInput: workflowInput(),
      candidates: [candidateFor(1), candidateFor(2)],
      sharedDigest: '(no admitted shared context yet)',
      reviewIntents: [reviewIntent],
      proofPackets: [proofPacketFor(1), proofPacketFor(2)],
      refutationResults: [refutationFor(1), refutationFor(2)],
      investigationTraces: [investigationTrace],
      evidence: [evidenceFor(1), evidenceFor(2)]
    }).input

    const result = findingAggregateResultForModelOutput({
      aggregateInput,
      output: {
        verdict: 'valid',
        summary: 'The batch is valid based only on an unknown reference.',
        evidenceIds: ['ev_unknown'],
        decisions: [
          {
            candidateId: 'cand_bug1',
            verdict: 'valid',
            summary: 'The first finding is supported only by unknown evidence.',
            evidenceIds: ['ev_unknown'],
            relatedCandidateIds: []
          }
        ],
        similarIssueChecks: []
      }
    })

    expect(result.verdict).toBe('needs-more-evidence')
    expect(result.evidenceIds).toEqual([])
    expect(result.decisions[0]?.verdict).toBe('needs-more-evidence')
  })
})
