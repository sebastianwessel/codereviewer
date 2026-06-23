import { describe, expect, test } from 'vitest'
import {
  type EvidenceRecord,
  type ModelSuspicion
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import {
  TaskReviewInputSchema,
  type FindingInvestigationInput,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import { providerIssueForError } from './model-provider-issues.js'
import { proofInvestigationExecutionForCandidate } from './model-proof-investigation-execution.js'

const configHash =
  '5555555555555555555555555555555555555555555555555555555555555555'

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

const task: WorkflowReviewTask = {
  id: 'task_exec',
  kind: 'file',
  round: 1,
  paths: ['src/task.ts'],
  factIds: [],
  evidenceIds: ['ev_task1'],
  candidateIds: [],
  contextEntryIds: [],
  priority: 1,
  reviewContext: [
    {
      kind: 'file',
      path: 'src/task.ts',
      content: 'export const changed = true\n',
      ledgerEntryId: 'ctx_abcdef1'
    }
  ]
}

const candidate: CandidateFinding = {
  id: 'cand_exec',
  taskId: 'task_exec',
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

const suspicion: ModelSuspicion = {
  id: 'susp_exec',
  taskId: 'task_exec',
  category: 'bug',
  severityHint: 'high',
  title: 'Changed branch can lose data',
  hypothesis: 'The changed branch can lose data.',
  primaryLocation: candidate.location,
  contextRequests: [],
  requestedContext: [],
  evidenceIds: ['ev_task1'],
  status: 'investigating',
  proposedBy: 'review-agent'
}

const taskInput = TaskReviewInputSchema.parse({
  runId: 'run-proof-exec',
  task,
  reviewIntents: [],
  reviewedDiffRanges: [
    {
      path: 'src/task.ts',
      startLine: 1,
      endLine: 20
    }
  ],
  evidence: [evidence],
  candidates: [],
  instructions: [],
  skills: [],
  sharedDigest: '(no admitted shared context yet)',
  provenance: {
    reviewer: 'review-agent',
    signalVersions: {},
    configHash
  }
})

describe('model proof investigation execution', () => {
  test('returns runnerless default output without provider issues', async () => {
    await expect(
      proofInvestigationExecutionForCandidate({
        taskInput,
        candidate,
        suspicion,
        contextEvidence: [],
        contextReviewContext: [],
        evidenceIds: ['ev_task1'],
        maxTaskInputBytes: undefined,
        investigateFinding: undefined,
        providerIssueForError,
        signal: undefined
      })
    ).resolves.toEqual({
      output: {
        verdict: 'needs-more-evidence',
        rationaleSummary:
          'No investigation runner ran, so the cited evidence was not verified into a proof packet.',
        evidenceIds: ['ev_task1'],
        contextRequests: [],
        requestedContext: [],
        contradictionChecks: []
      },
      providerIssues: []
    })
  })

  test('passes constructed investigation input and signal to the runner', async () => {
    const seenInputs: FindingInvestigationInput[] = []
    const controller = new AbortController()

    const result = await proofInvestigationExecutionForCandidate({
      taskInput,
      candidate,
      suspicion,
      contextEvidence: [],
      contextReviewContext: [],
      evidenceIds: ['ev_task1'],
      maxTaskInputBytes: undefined,
      investigateFinding: async (input, signal) => {
        seenInputs.push(input)
        expect(signal).toBe(controller.signal)

        return {
          verdict: 'proved',
          rationaleSummary: 'The runner proved the suspicion.',
          evidenceIds: input.evidence.map((record) => record.id),
          contextRequests: [],
          requestedContext: [],
          changedBehavior: 'The changed branch loses data.',
          executionOrDataPath: 'The changed branch is reachable.',
          violatedInvariant: 'Payload data must be preserved.',
          impact: 'Callers can lose data.',
          introducedByChange: 'The reviewed branch changed persistence.',
          contradictionChecks: ['No contradiction was found.'],
          fixDirection: 'Preserve payload data before returning.'
        }
      },
      providerIssueForError,
      signal: controller.signal
    })

    expect(seenInputs).toHaveLength(1)
    expect(seenInputs[0]?.candidate.id).toBe('cand_exec')
    expect(seenInputs[0]?.evidence.map((record) => record.id)).toEqual([
      'ev_task1'
    ])
    expect(result).toMatchObject({
      output: {
        verdict: 'proved',
        rationaleSummary: 'The runner proved the suspicion.',
        evidenceIds: ['ev_task1']
      },
      providerIssues: []
    })
  })

  test('recovers packet construction failures before calling the runner', async () => {
    let called = false

    const result = await proofInvestigationExecutionForCandidate({
      taskInput,
      candidate,
      suspicion,
      contextEvidence: [],
      contextReviewContext: [],
      evidenceIds: ['ev_task1'],
      maxTaskInputBytes: 1,
      investigateFinding: async () => {
        called = true
        throw new Error('should not run')
      },
      providerIssueForError,
      signal: undefined
    })

    expect(called).toBe(false)
    expect(result).toMatchObject({
      output: {
        verdict: 'needs-more-evidence',
        rationaleSummary:
          'Suspicion investigation packet exceeded the provider budget before proof could be established.',
        evidenceIds: []
      },
      providerIssues: [
        {
          stage: 'suspicion-investigation-packet',
          recovered: true
        }
      ]
    })
  })

  test('recovers provider call failures', async () => {
    const result = await proofInvestigationExecutionForCandidate({
      taskInput,
      candidate,
      suspicion,
      contextEvidence: [],
      contextReviewContext: [],
      evidenceIds: ['ev_task1'],
      maxTaskInputBytes: undefined,
      investigateFinding: async () => {
        throw new Error('provider timed out')
      },
      providerIssueForError,
      signal: undefined
    })

    expect(result).toMatchObject({
      output: {
        verdict: 'needs-more-evidence',
        rationaleSummary:
          'Suspicion investigation failed before a proof could be established.',
        evidenceIds: []
      },
      providerIssues: [
        {
          code: 'provider_timeout',
          stage: 'suspicion-investigation',
          recovered: true,
          message: 'provider timed out'
        }
      ]
    })
  })
})
