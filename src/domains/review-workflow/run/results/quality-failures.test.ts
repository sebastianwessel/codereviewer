import { describe, expect, test } from 'vitest'
import {
  CodeReviewerConfigSchema,
  EvidenceRecordSchema
} from '../../../../shared/contracts/index.js'
import { sha256 } from '../../../../shared/hash/hash.js'
import type { ReviewRunnerAdmissionState } from '../admission.js'
import { createCoverageSummary } from './results.js'
import {
  createReviewRunnerCostBudgetFailure,
  createReviewRunnerCoverageFailure
} from './quality-failures.js'

const config = CodeReviewerConfigSchema.parse({
  review: {
    mode: 'pr',
    depth: 'balanced',
    maxCostUsd: 0.01
  },
  paths: {
    artifactDir: '.codereviewer/runs'
  }
})

const evidence = EvidenceRecordSchema.parse({
  id: 'ev_alpha',
  kind: 'deterministic-signal',
  summary: 'Symbol alpha was detected.',
  location: { path: 'src/a.ts', startLine: 1, side: 'file' },
  source: 'deterministic-support-signal',
  redactionApplied: true
})

const analysis = {
  facts: [
    {
      id: 'fact_alpha',
      language: 'typescript',
      kind: 'declaration',
      path: 'src/a.ts',
      name: 'alpha',
      line: 1,
      summary: 'alpha declaration',
      contentHash: sha256('let alpha = 1')
    }
  ],
  evidence: [evidence]
} as const

const admission = {
  evidence: [evidence],
  candidateFindings: [],
  admittedFindings: [],
  rejectedFindings: [],
  qualityGate: undefined,
  refutationResults: [],
  providerIssues: [],
  contextLedgerEntries: [],
  admissionDecisions: [],
  taskEvents: [
    {
      id: 'task_alpha',
      kind: 'file',
      round: 1,
      paths: ['src/a.ts'],
      state: 'completed'
    }
  ],
  warnings: []
} satisfies ReviewRunnerAdmissionState

const commonInput = {
  repositoryRoot: '/repo/project',
  config,
  runId: 'run_quality_failure',
  startedAt: new Date('2026-06-22T10:00:00.000Z'),
  completedAt: new Date('2026-06-22T10:00:02.000Z'),
  configHash: sha256('config'),
  warnings: ['partial-run'],
  runCost: {
    warnings: [],
    costUsd: 0.02,
    inputTokens: 100,
    outputTokens: 20
  },
  analysis,
  admission,
  contextLedger: [],
  observability: { events: [] }
} as const

describe('review runner quality failure helpers', () => {
  test('creates coverage-incomplete partial failures with admission shared context', () => {
    const coverage = createCoverageSummary({
      sourceFiles: [{ path: 'src/a.ts', content: 'let alpha = 1' }],
      contextLedger: []
    })

    const failure = createReviewRunnerCoverageFailure({
      ...commonInput,
      coverage
    })

    expect(failure.structuredError.code).toBe('coverage_incomplete')
    expect(failure.structuredError.details).toEqual({
      reviewableFileCount: 1,
      coveredFileCount: 0,
      reviewableBytes: 13,
      coveredBytes: 0
    })
    expect(failure.partialState.sharedContext.supportSignalFacts).toEqual(
      analysis.facts
    )
    expect(failure.partialState.sharedContext.evidenceRecords).toEqual([evidence])
    expect(failure.partialState.runSummary.warnings).toEqual(['partial-run'])
    expect(failure.partialState.runSummary.costUsd).toBe(0.02)
  })

  test('creates cost-budget partial failures with cost metadata', () => {
    const failure = createReviewRunnerCostBudgetFailure({
      ...commonInput,
      maxCostUsd: 0.01,
      costUsd: 0.02
    })

    expect(failure.structuredError.code).toBe('cost_budget_exceeded')
    expect(failure.structuredError.details).toEqual({
      maxCostUsd: 0.01,
      costUsd: 0.02
    })
    expect(failure.partialState.runSummary.costUsd).toBe(0.02)
    expect(failure.partialState.runSummary.inputTokens).toBe(100)
    expect(failure.partialState.sharedContext.taskEvents).toEqual(
      admission.taskEvents
    )
  })
})
