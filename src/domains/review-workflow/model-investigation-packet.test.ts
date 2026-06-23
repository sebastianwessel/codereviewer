import { describe, expect, test } from 'vitest'
import {
  type EvidenceRecord,
  type ModelSuspicion
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import {
  TaskReviewInputSchema,
  type ReviewContextDocument,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import { findingInvestigationInputForCandidate } from './model-investigation-packet.js'
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
  summary = 'Changed branch can return an incorrect value.'
): EvidenceRecord => ({
  id,
  kind: 'diff',
  summary,
  location: {
    path: 'src/app.ts',
    startLine: 4,
    side: 'new'
  },
  source: 'diff',
  redactionApplied: true
})

const task = (
  input: {
    readonly reviewContext?: readonly ReviewContextDocument[]
    readonly verificationQuestions?: readonly string[]
  } = {}
): WorkflowReviewTask => ({
  id: 'task_app1',
  round: 1,
  kind: 'file',
  paths: ['src/app.ts'],
  factIds: [],
  evidenceIds: ['ev_diff1'],
  candidateIds: ['cand_bug1'],
  contextEntryIds: (input.reviewContext ?? []).map(
    (context) => context.ledgerEntryId
  ),
  reviewContext: [...(input.reviewContext ?? [])],
  ...(input.verificationQuestions === undefined
    ? {}
    : { verificationQuestions: [...input.verificationQuestions] }),
  priority: 0
})

const suspicion: ModelSuspicion = {
  id: 'susp_bug1',
  taskId: 'task_app1',
  category: 'bug',
  severityHint: 'high',
  title: candidate.title,
  hypothesis: candidate.description,
  primaryLocation: candidate.location,
  contextRequests: [],
  requestedContext: ['Inspect the changed branch.'],
  evidenceIds: ['ev_diff1', 'ev_tool1'],
  status: 'investigating',
  proposedBy: 'review-agent'
}

const reviewContext = (
  ledgerEntryId: string,
  content: string
): ReviewContextDocument => ({
  kind: 'file',
  path: 'src/app.ts',
  content,
  ledgerEntryId
})

const taskInput = (
  input: {
    readonly reviewContext?: readonly ReviewContextDocument[]
    readonly instructions?: readonly { readonly content: string }[]
    readonly sharedDigest?: string
  } = {}
) =>
  TaskReviewInputSchema.parse({
    runId: 'run-investigation-packet',
    task: task({
      reviewContext: input.reviewContext ?? [],
      verificationQuestions: [
        'Does the changed branch preserve the API invariant?'
      ]
    }),
    reviewIntents: [],
    reviewedDiffRanges: [
      {
        path: 'src/app.ts',
        startLine: 4,
        endLine: 4
      }
    ],
    evidence: [evidence('ev_diff1')],
    candidates: [candidate],
    instructions: (input.instructions ?? []).map((instruction, index) => ({
      path: `AGENTS-${index}.md`,
      content: instruction.content,
      allowed: true
    })),
    skills: [],
    sharedDigest: input.sharedDigest ?? '(no admitted shared context yet)',
    provenance: {
      reviewer: 'review-agent',
      signalVersions: {},
      configHash
    }
  })

describe('finding investigation packet', () => {
  test('deduplicates task context and sends compact proof questions', () => {
    const ambientContext = reviewContext('ctx_aaaaaaaa', 'ambient context')
    const retrievedContext = reviewContext('ctx_bbbbbbbb', 'focused context')
    const packet = findingInvestigationInputForCandidate({
      taskInput: taskInput({
        reviewContext: [ambientContext]
      }),
      candidate,
      suspicion,
      contextEvidence: [evidence('ev_tool1', 'Retrieved context evidence.')],
      contextReviewContext: [retrievedContext],
      evidenceIds: ['ev_diff1', 'ev_tool1']
    })

    expect(packet.input.task.reviewContext).toEqual([])
    expect(packet.input.reviewContext).toEqual([retrievedContext])
    expect(
      (packet.input as { readonly proofQuestions?: readonly string[] })
        .proofQuestions
    ).toEqual([
      'Does the changed branch preserve the API invariant?',
      'What changed behavior is introduced or materially exposed by the reviewed diff?',
      'What execution path, data flow, or configuration path makes the behavior reachable?',
      'Which invariant, contract, or security property is violated?',
      'What concrete impact follows if this behavior ships?',
      'What evidence or contradiction would refute the suspicion?'
    ])
  })

  test('preserves retrieved context while dropping ambient task context under budget', () => {
    const retrievedContext = reviewContext('ctx_bbbbbbbb', 'focused context')
    const packet = findingInvestigationInputForCandidate({
      taskInput: taskInput({
        reviewContext: [
          reviewContext('ctx_aaaaaaaa', `ambient context ${'x'.repeat(12000)}`)
        ]
      }),
      candidate,
      suspicion,
      contextEvidence: [evidence('ev_tool1', 'Retrieved context evidence.')],
      contextReviewContext: [retrievedContext],
      evidenceIds: ['ev_diff1', 'ev_tool1'],
      maxTaskInputBytes: 10000
    })

    expect(packet.input.reviewContext).toEqual([retrievedContext])
    expect(packet.input.evidence.map((record) => record.id).sort()).toEqual([
      'ev_diff1',
      'ev_tool1'
    ])
    expect(packet.input.candidate).toEqual(candidate)
    expect(packet.input.suspicion).toEqual(suspicion)
  })

  test('omits optional shared digest before dropping retrieved investigation context', () => {
    const retrievedContext = reviewContext('ctx_bbbbbbbb', 'focused context')
    const packet = findingInvestigationInputForCandidate({
      taskInput: taskInput({
        sharedDigest: 'large admitted digest '.repeat(700)
      }),
      candidate,
      suspicion,
      contextEvidence: [evidence('ev_tool1', 'Retrieved context evidence.')],
      contextReviewContext: [retrievedContext],
      evidenceIds: ['ev_diff1', 'ev_tool1'],
      maxTaskInputBytes: 10000
    })

    expect(packet.input.reviewContext).toEqual([retrievedContext])
    expect(packet.input.evidence.map((record) => record.id).sort()).toEqual([
      'ev_diff1',
      'ev_tool1'
    ])
    expect(packet.input.sharedDigest).toBe(
      '(shared digest omitted for investigation packet budget)'
    )
  })

  test('throws the shared packet budget error when the investigation packet is irreducible', () => {
    let thrown: unknown

    try {
      findingInvestigationInputForCandidate({
        taskInput: taskInput({
          instructions: [{ content: 'irreducible instruction '.repeat(800) }]
        }),
        candidate,
        suspicion,
        contextEvidence: [evidence('ev_tool1', 'Retrieved context evidence.')],
        contextReviewContext: [],
        evidenceIds: ['ev_diff1', 'ev_tool1'],
        maxTaskInputBytes: 10000
      })
    } catch (error: unknown) {
      thrown = error
    }

    expect(isTaskPacketBudgetExceededError(thrown)).toBe(true)
  })
})
