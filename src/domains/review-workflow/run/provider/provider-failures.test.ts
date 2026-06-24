import { describe, expect, test } from 'vitest'
import {
  CodeReviewerConfigSchema,
  EvidenceRecordSchema
} from '../../../../shared/contracts/index.js'
import type { CandidateFinding } from '../../../admission/index.js'
import type { DriftFinding } from '../../../drift/index.js'
import { ReviewTaskExecutionError } from '../../harness/workflow.js'
import type { WorkflowReviewTask } from '../../pipeline/agent-contracts.js'
import {
  createProviderTaskExecutionFailure,
  createProviderTimeoutFailure,
  createProviderWorkflowFailure
} from './provider-failures.js'

const config = CodeReviewerConfigSchema.parse({
  review: {
    mode: 'pr',
    depth: 'balanced',
    runTimeoutMs: 10000
  },
  paths: {
    artifactDir: '.codereviewer/runs'
  }
})

const driftFindings: readonly DriftFinding[] = [
  {
    id: 'docs-warning',
    category: 'documentation-drift',
    gate: 'warning',
    path: 'docs/example.md',
    message: 'Documentation drift.',
    evidence: 'docs',
    recommendation: 'Update docs.'
  }
]

const evidence = EvidenceRecordSchema.parse({
  id: 'ev_alpha',
  kind: 'deterministic-signal',
  summary: 'Symbol alpha was detected.',
  location: { path: 'src/a.ts', startLine: 1, side: 'file' },
  source: 'deterministic-support-signal',
  redactionApplied: true
})

const supportCandidate: CandidateFinding = {
  id: 'cand_support',
  taskId: 'task_alpha',
  category: 'bug',
  severity: 'medium',
  title: 'Support signal candidate',
  description: 'A support signal candidate.',
  location: { path: 'src/a.ts', startLine: 1, side: 'file' },
  evidenceIds: ['ev_alpha'],
  proposedBy: 'deterministic-support-signal',
  fixProposal: {
    summary: 'Inspect the changed line.',
    evidenceIds: ['ev_alpha'],
    safety: 'manual-review'
  }
}

const providerCandidate: CandidateFinding = {
  ...supportCandidate,
  id: 'cand_provider',
  proposedBy: 'model'
}

const task: WorkflowReviewTask = {
  id: 'task_alpha',
  kind: 'file',
  round: 1,
  paths: ['src/a.ts'],
  factIds: ['fact_alpha'],
  evidenceIds: ['ev_alpha'],
  candidateIds: [],
  contextEntryIds: [],
  priority: 0,
  reviewContext: []
}

const commonInput = {
  repositoryRoot: '/repo/project',
  config,
  configWarnings: ['config-warning'],
  driftFindings,
  runId: 'run_provider_failure',
  startedAt: new Date('2026-06-22T10:00:00.000Z'),
  completedAt: new Date('2026-06-22T10:00:02.000Z'),
  configHash:
    '1111111111111111111111111111111111111111111111111111111111111111',
  analysis: {
    facts: [
      {
        id: 'fact_alpha',
        language: 'typescript',
        kind: 'declaration',
        path: 'src/a.ts',
        name: 'alpha',
        line: 1,
        summary: 'alpha declaration',
        contentHash:
          '2222222222222222222222222222222222222222222222222222222222222222'
      }
    ],
    evidence: [evidence]
  },
  contextLedger: [],
  evidence: [evidence],
  supportSignalCandidates: [supportCandidate],
  observability: { events: [] }
} as const

describe('review runner provider failure helpers', () => {
  test('creates timeout partial failures with failed task events', () => {
    const failure = createProviderTimeoutFailure({
      ...commonInput,
      tasks: [task],
      timeoutMs: 10000
    })

    expect(failure.structuredError.code).toBe('review_run_timeout')
    expect(failure.partialState.runSummary.warnings).toEqual([
      'config-warning',
      'drift:documentation-drift',
      'partial-run'
    ])
    expect(failure.partialState.sharedContext.taskEvents.map((event) => ({
      id: event.id,
      state: event.state,
      workerId: event.workerId
    }))).toEqual([
      { id: 'task_alpha', state: 'planned', workerId: undefined },
      { id: 'task_alpha', state: 'failed', workerId: 'review-timeout' }
    ])
    expect(failure.partialState.sharedContext.candidateFindings).toEqual([
      supportCandidate
    ])
  })

  test('creates task-execution partial failures with recovered candidates', () => {
    const executionError = new ReviewTaskExecutionError({
      originalError: new Error('provider exploded'),
      partialResults: [{ candidates: [providerCandidate] }],
      taskEvents: [
        {
          id: 'task_alpha',
          kind: 'file',
          round: 1,
          paths: ['src/a.ts'],
          state: 'failed',
          workerId: 'worker-1',
          message: 'worker failed'
        }
      ]
    })

    const failure = createProviderTaskExecutionFailure({
      ...commonInput,
      executionError,
      timedOut: false
    })

    expect(failure.structuredError.code).toBe('provider_error')
    expect(failure.partialState.sharedContext.taskEvents).toEqual([
      {
        id: 'task_alpha',
        kind: 'file',
        round: 1,
        paths: ['src/a.ts'],
        state: 'failed',
        workerId: 'worker-1',
        message: 'worker failed'
      }
    ])
    expect(failure.partialState.sharedContext.candidateFindings).toEqual([
      supportCandidate,
      providerCandidate
    ])
    expect(failure.partialState.runSummary.warnings).toEqual([
      'config-warning',
      'drift:documentation-drift',
      'partial-run'
    ])
  })

  test('classifies timed-out workflow errors as timeout partial failures', () => {
    const failure = createProviderWorkflowFailure({
      ...commonInput,
      error: new Error('provider did not complete in time'),
      runTimedOut: true,
      tasks: [task],
      timeoutMs: 10000
    })

    expect(failure?.structuredError.code).toBe('review_run_timeout')
    expect(failure?.partialState.sharedContext.taskEvents.map((event) => ({
      id: event.id,
      state: event.state,
      workerId: event.workerId
    }))).toEqual([
      { id: 'task_alpha', state: 'planned', workerId: undefined },
      { id: 'task_alpha', state: 'failed', workerId: 'review-timeout' }
    ])
  })

  test('classifies task-execution workflow errors as recoverable provider partial failures', () => {
    const executionError = new ReviewTaskExecutionError({
      originalError: new Error('provider exploded'),
      partialResults: [{ candidates: [providerCandidate] }],
      taskEvents: [
        {
          id: 'task_alpha',
          kind: 'file',
          round: 1,
          paths: ['src/a.ts'],
          state: 'failed',
          workerId: 'worker-1',
          message: 'worker failed'
        }
      ]
    })

    const failure = createProviderWorkflowFailure({
      ...commonInput,
      error: executionError,
      runTimedOut: false,
      tasks: [task],
      timeoutMs: 10000
    })

    expect(failure?.structuredError.code).toBe('provider_error')
    expect(failure?.partialState.sharedContext.candidateFindings).toEqual([
      supportCandidate,
      providerCandidate
    ])
  })

  test('does not classify unrelated workflow errors', () => {
    const failure = createProviderWorkflowFailure({
      ...commonInput,
      error: new Error('plain provider setup error'),
      runTimedOut: false,
      tasks: [task],
      timeoutMs: 10000
    })

    expect(failure).toBeUndefined()
  })
})
