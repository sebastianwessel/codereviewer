import { describe, expect, test } from 'vitest'
import {
  type EvidenceRecord,
  type ProofPacket,
  type RefutationResult,
  type ReviewIntent
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { type WorkflowReviewTask } from './model-agent-contracts.js'
import {
  ReviewWorkflowInputSchema,
  type ReviewWorkflowInput
} from './workflow-contracts.js'
import { findingJudgeInputForCandidate } from './model-judge-packet.js'
import { isTaskPacketBudgetExceededError } from './model-task-packet.js'

const configHash =
  '1111111111111111111111111111111111111111111111111111111111111111'

const candidate: CandidateFinding = {
  id: 'cand_bug1',
  taskId: 'task_app1',
  category: 'bug',
  severity: 'high',
  title: 'Changed branch returns wrong value',
  description: 'The changed branch can return the wrong value.',
  location: {
    path: 'src/app.ts',
    startLine: 4,
    side: 'new'
  },
  evidenceIds: ['ev_diff1'],
  proposedBy: 'review-agent'
}

const evidence = (
  id: string,
  summary = 'Relevant evidence.'
): EvidenceRecord => ({
  id,
  kind: 'diff',
  summary,
  location: {
    path: 'src/app.ts',
    startLine: 4,
    side: 'new'
  },
  source: 'test',
  redactionApplied: false
})

const task = (
  reviewContextContent: string
): WorkflowReviewTask => ({
  id: 'task_app1',
  round: 1,
  kind: 'file',
  paths: ['src/app.ts'],
  factIds: [],
  evidenceIds: ['ev_diff1'],
  candidateIds: ['cand_bug1'],
  contextEntryIds: ['ctx_aaaaaaaa'],
  priority: 0,
  reviewContext: [
    {
      kind: 'file',
      path: 'src/app.ts',
      content: reviewContextContent,
      ledgerEntryId: 'ctx_aaaaaaaa'
    }
  ]
})

const workflowInput = (
  input: {
    readonly maxTaskInputBytes?: number
    readonly instructions?: readonly {
      readonly content: string
    }[]
  } = {}
): ReviewWorkflowInput =>
  ReviewWorkflowInputSchema.parse({
    runId: 'run-judge-packet',
    reviewedPaths: ['src/app.ts'],
    evidence: [evidence('ev_diff1'), evidence('ev_refutation1')],
    candidates: [candidate],
    instructions: (input.instructions ?? []).map((instruction, index) => ({
      path: `AGENTS-${index}.md`,
      content: instruction.content,
      allowed: true
    })),
    skills: [],
    ...(input.maxTaskInputBytes === undefined
      ? {}
      : { maxTaskInputBytes: input.maxTaskInputBytes }),
    provenance: {
      reviewer: 'review-agent',
      signalVersions: {},
      configHash
    }
  })

const proofPacket: ProofPacket = {
  id: 'proof_bug1',
  suspicionId: 'susp_bug1',
  candidateId: 'cand_bug1',
  changedBehavior: 'The changed branch returns the intermediate value.',
  executionOrDataPath: 'The positive path now bypasses the expected value.',
  violatedInvariant: 'Positive input must return the expected value.',
  impact: 'Callers can receive stale data.',
  introducedByChange: 'The conditional branch changed in this diff.',
  evidenceIds: ['ev_diff1'],
  contradictionChecks: ['No guard restores the expected value.'],
  fixDirection: 'Return expectedValue for the positive path.'
}

const refutationResult: RefutationResult = {
  id: 'ref_bug1',
  proofPacketId: 'proof_bug1',
  verdict: 'proved',
  summary: 'The proof is supported.',
  evidenceIds: ['ev_refutation1'],
  checks: [
    {
      kind: 'proof-review',
      result: 'passed',
      summary: 'The refutation check found no contradiction.',
      evidenceIds: ['ev_refutation1']
    }
  ]
}

const reviewIntent: ReviewIntent = {
  id: 'intent_main',
  title: 'Verify changed branch',
  objective: 'Verify the changed branch end to end.',
  paths: ['src/app.ts'],
  taskIds: ['task_app1'],
  focusAreas: ['branch behavior'],
  riskAreas: ['incorrect return value'],
  verificationQuestions: ['Does the positive path return expectedValue?'],
  source: 'model'
}

describe('finding judge packet', () => {
  test('preserves explicit follow-up context and evidence while dropping ambient context under budget', () => {
    const focusedContext = {
      kind: 'file' as const,
      path: 'src/app.ts',
      content: 'focused proof context',
      ledgerEntryId: 'ctx_bbbbbbbb'
    }
    const packet = findingJudgeInputForCandidate({
      workflowInput: workflowInput({ maxTaskInputBytes: 10000 }),
      tasks: [task(`ambient context ${'x'.repeat(12000)}`)],
      candidate,
      sharedDigest: '(no admitted shared context yet)',
      evidence: [
        evidence('ev_diff1'),
        evidence('ev_refutation1'),
        evidence('ev_followup1', 'Follow-up context evidence.')
      ],
      reviewIntents: [reviewIntent],
      proofPackets: [proofPacket],
      refutationResults: [refutationResult],
      additionalEvidenceIds: ['ev_followup1'],
      additionalReviewContext: [focusedContext]
    })

    expect(packet.input.reviewContext).toEqual([focusedContext])
    expect(packet.input.reviewIntents).toEqual([])
    expect(packet.input.evidence.map((record) => record.id).sort()).toEqual([
      'ev_diff1',
      'ev_followup1',
      'ev_refutation1'
    ])
    expect(packet.input.proofPackets).toEqual([proofPacket])
    expect(packet.input.refutationResults).toEqual([refutationResult])
  })

  test('omits optional shared digest before dropping judge review context', () => {
    const ambientTask = task('ambient judge context')
    const packet = findingJudgeInputForCandidate({
      workflowInput: workflowInput({ maxTaskInputBytes: 10000 }),
      tasks: [ambientTask],
      candidate,
      sharedDigest: 'large admitted digest '.repeat(700),
      evidence: [evidence('ev_diff1'), evidence('ev_refutation1')],
      reviewIntents: [],
      proofPackets: [proofPacket],
      refutationResults: [refutationResult]
    })

    expect(packet.input.reviewContext).toEqual(ambientTask.reviewContext)
    expect(packet.input.evidence.map((record) => record.id).sort()).toEqual([
      'ev_diff1',
      'ev_refutation1'
    ])
    expect(packet.input.sharedDigest).toBe(
      '(shared digest omitted for judge packet budget)'
    )
  })

  test('throws the shared packet budget error when the judge packet is irreducible', () => {
    let thrown: unknown

    try {
      findingJudgeInputForCandidate({
        workflowInput: workflowInput({
          maxTaskInputBytes: 10000,
          instructions: [{ content: 'irreducible instruction '.repeat(800) }]
        }),
        tasks: [task('small context')],
        candidate,
        sharedDigest: '(no admitted shared context yet)',
        evidence: [evidence('ev_diff1'), evidence('ev_refutation1')],
        reviewIntents: [],
        proofPackets: [proofPacket],
        refutationResults: [refutationResult]
      })
    } catch (error: unknown) {
      thrown = error
    }

    expect(isTaskPacketBudgetExceededError(thrown)).toBe(true)
  })
})
