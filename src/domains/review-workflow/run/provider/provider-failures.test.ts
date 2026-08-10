import { describe, expect, test } from 'vitest'
import {
  CodeReviewerConfigSchema,
  EvidenceRecordSchema
} from '../../../../shared/contracts/index.js'
import type { CandidateFinding } from '../../../admission/index.js'
import type { DriftFinding } from '../../../drift/index.js'
import { ReviewTaskExecutionError } from '../../harness/workflow.js'
import {
  createProviderTaskExecutionFailure,
  createProviderWorkflowFailure
} from './provider-failures.js'

const config = CodeReviewerConfigSchema.parse({
  review: {
    mode: 'pr',
    depth: 'balanced',
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
  kind: 'diagnostic',
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
        endLine: 1,
        summary: 'alpha declaration',
        contentHash:
          '2222222222222222222222222222222222222222222222222222222222222222'
      }
    ],
    evidence: [evidence]
  },
  contextLedger: [],
  evidence: [evidence],
  observability: { events: [] }
} as const

describe('review runner provider failure helpers', () => {
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
    // Only the provider's own candidates survive a partial failure now. The
    // support-signal channel that used to be prepended here carried nothing: its
    // sole producer was the eval-gaming trusted-rule map.
    expect(failure.partialState.sharedContext.candidateFindings).toEqual([
      providerCandidate
    ])
    expect(failure.partialState.runSummary.warnings).toEqual([
      'config-warning',
      'drift:documentation-drift',
      'partial-run'
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
      error: executionError
    })

    expect(failure?.structuredError.code).toBe('provider_error')
    expect(failure?.partialState.sharedContext.candidateFindings).toEqual([
      providerCandidate
    ])
  })

  test('does not classify unrelated workflow errors', () => {
    const failure = createProviderWorkflowFailure({
      ...commonInput,
      error: new Error('plain provider setup error')
    })

    expect(failure).toBeUndefined()
  })
})
