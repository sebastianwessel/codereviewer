import type { Logger } from '@purista/harness'
import { describe, expect, test } from 'vitest'
import {
  CodeReviewerConfigSchema,
  EvidenceRecordSchema
} from '../../shared/contracts/index.js'
import { sha256 } from '../../shared/hash/hash.js'
import { createNoContentEventRecorder } from '../observability/index.js'
import { createContextLedgerEntry } from '../review-planning/context-ledger.js'
import type { ReviewRunnerAdmissionState } from './review-runner-admission.js'
import {
  createCoverageSummary,
  createReviewReport,
  createReviewRunSummary,
  createSharedContextSnapshot,
  prepareReviewRunnerSuccessResult
} from './review-runner-results.js'

type CapturedLogRecord = {
  readonly message: string
  readonly fields?: Record<string, unknown>
}

const createInfoLogger = (): {
  readonly logger: Logger
  readonly records: CapturedLogRecord[]
} => {
  const records: CapturedLogRecord[] = []
  const logger: Logger = {
    trace: () => {},
    debug: () => {},
    info: (message, fields) => {
      records.push({ message, ...(fields === undefined ? {} : { fields }) })
    },
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: () => logger
  }

  return { logger, records }
}

describe('review runner results', () => {
  test('creates run summaries with provider and cost metadata', () => {
    const startedAt = new Date('2026-06-22T10:00:00.000Z')
    const completedAt = new Date('2026-06-22T10:00:02.500Z')
    const config = CodeReviewerConfigSchema.parse({
      review: { depth: 'thorough', baseRef: 'origin/main', headRef: 'HEAD' },
      provider: { id: 'openai', model: 'review-model' }
    })

    expect(
      createReviewRunSummary({
        repositoryRoot: '/repo/project',
        config,
        baseRef: 'main',
        headRef: 'feature',
        runId: 'run_test',
        startedAt,
        completedAt,
        configHash: sha256('config'),
        warnings: ['cost-unavailable'],
        runCost: {
          warnings: [],
          costUsd: 0.0123,
          inputTokens: 1000,
          outputTokens: 250
        }
      })
    ).toEqual({
      runId: 'run_test',
      startedAt: '2026-06-22T10:00:00.000Z',
      completedAt: '2026-06-22T10:00:02.500Z',
      mode: 'local',
      depth: 'thorough',
      repositoryRootHash: sha256('/repo/project'),
      baseRef: 'main',
      headRef: 'feature',
      configHash: sha256('config'),
      provider: 'openai',
      model: 'review-model',
      durationMs: 2500,
      costUsd: 0.0123,
      inputTokens: 1000,
      outputTokens: 250,
      warnings: ['cost-unavailable']
    })
  })

  test('summarizes complete and incomplete source coverage from ledger entries', () => {
    const completeEntry = createContextLedgerEntry({
      kind: 'file',
      path: 'src/a.ts',
      taskId: 'task_a',
      reason: 'task-context-source-chunk',
      decision: 'included',
      bytesConsidered: 7,
      bytesIncluded: 7,
      content: 'let a=1'
    })
    const partialEntry = createContextLedgerEntry({
      kind: 'file',
      path: 'src/b.ts',
      taskId: 'task_b',
      reason: 'task-context-source-chunk',
      decision: 'included',
      bytesConsidered: 9,
      bytesIncluded: 4,
      content: 'let b=22'
    })

    const coverage = createCoverageSummary({
      sourceFiles: [
        { path: 'src/a.ts', content: 'let a=1' },
        { path: 'src/b.ts', content: 'let b=22' }
      ],
      contextLedger: [completeEntry, partialEntry]
    })

    expect(coverage.status).toBe('incomplete')
    expect(coverage.reviewableFileCount).toBe(2)
    expect(coverage.coveredFileCount).toBe(1)
    expect(coverage.incompleteReasons).toEqual([
      'src/b.ts: Only 4 of 8 bytes were assigned to review tasks.'
    ])
    expect(coverage.files[0]).toEqual(
      expect.objectContaining({
        path: 'src/a.ts',
        status: 'complete',
        bytes: 7,
        coveredBytes: 7,
        taskIds: ['task_a']
      })
    )
    expect(coverage.files[1]).toEqual(
      expect.objectContaining({
        path: 'src/b.ts',
        status: 'incomplete',
        bytes: 8,
        coveredBytes: 4,
        taskIds: ['task_b']
      })
    )
  })

  test('reconstructs shared context snapshots from runner artifacts', () => {
    const evidence = EvidenceRecordSchema.parse({
      id: 'ev_alpha',
      kind: 'deterministic-signal',
      summary: 'Symbol alpha was detected.',
      location: { path: 'src/a.ts', startLine: 1, side: 'file' },
      source: 'deterministic-support-signal',
      redactionApplied: true
    })

    const snapshot = createSharedContextSnapshot({
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
            contentHash: sha256('alpha')
          }
        ],
        evidence: [evidence]
      },
      taskEvents: [
        {
          id: 'task_a',
          kind: 'file',
          round: 1,
          paths: ['src/a.ts'],
          state: 'completed',
          workerId: 'worker_1'
        }
      ],
      contextLedger: [],
      evidence: [evidence],
      candidates: [],
      admissionDecisions: [],
      admittedFindings: [],
      rejectedFindings: []
    })

    expect(snapshot.supportSignalFacts).toHaveLength(1)
    expect(snapshot.taskEvents).toHaveLength(1)
    expect(snapshot.currentTasks).toEqual([
      expect.objectContaining({ id: 'task_a', state: 'completed' })
    ])
    expect(snapshot.evidenceRecords).toEqual([evidence])
    expect(snapshot.sharedEntries.map((entry) => entry.kind)).toEqual([
      'support-signal-fact',
      'task-state'
    ])
  })

  test('creates schema-validated review reports', () => {
    const config = CodeReviewerConfigSchema.parse({})
    const run = createReviewRunSummary({
      repositoryRoot: '/repo/project',
      config,
      runId: 'run_report',
      startedAt: new Date('2026-06-22T10:00:00.000Z'),
      completedAt: new Date('2026-06-22T10:00:01.000Z'),
      configHash: sha256('config'),
      warnings: []
    })
    const coverage = createCoverageSummary({
      sourceFiles: [{ path: 'src/a.ts', content: 'let a=1' }],
      contextLedger: [
        createContextLedgerEntry({
          kind: 'file',
          path: 'src/a.ts',
          taskId: 'task_a',
          reason: 'task-context-source-chunk',
          decision: 'included',
          bytesConsidered: 7,
          bytesIncluded: 7,
          content: 'let a=1'
        })
      ]
    })

    const report = createReviewReport({
      run,
      coverage,
      admittedFindings: [],
      rejectedFindings: [],
      evidence: [],
      skippedFiles: [],
      qualityGate: undefined,
      reviewIntents: [],
      modelSuspicions: [],
      modelTaskDiagnostics: [],
      investigationTraces: [],
      proofPackets: [],
      refutationResults: [],
      aggregateResults: [],
      judgeResults: [],
      promotionDecisions: [],
      providerIssues: []
    })

    expect(report.schemaVersion).toBe('1.0')
    expect(report.run.runId).toBe('run_report')
    expect(report.coverage.status).toBe('complete')
    expect(report.artifacts).toEqual([])
  })

  test('prepares successful runner result with report metrics and shared context', () => {
    const config = CodeReviewerConfigSchema.parse({
      review: { depth: 'balanced' }
    })
    const sourceContent = 'let a=1'
    const sourceEntry = createContextLedgerEntry({
      kind: 'file',
      path: 'src/a.ts',
      taskId: 'task_a',
      reason: 'task-context-source-chunk',
      decision: 'included',
      bytesConsidered: Buffer.byteLength(sourceContent),
      bytesIncluded: Buffer.byteLength(sourceContent),
      content: sourceContent
    })
    const evidence = EvidenceRecordSchema.parse({
      id: 'ev_alpha',
      kind: 'deterministic-signal',
      summary: 'Symbol alpha was detected.',
      location: { path: 'src/a.ts', startLine: 1, side: 'file' },
      source: 'deterministic-support-signal',
      redactionApplied: true
    })
    const admission: ReviewRunnerAdmissionState = {
      evidence: [evidence],
      candidateFindings: [],
      admittedFindings: [],
      rejectedFindings: [],
      qualityGate: undefined,
      modelSuspicions: [],
      modelTaskDiagnostics: [],
      investigationTraces: [],
      proofPackets: [],
      refutationResults: [],
      aggregateResults: [],
      promotionDecisions: [],
      providerIssues: [],
      contextLedgerEntries: [],
      admissionDecisions: [],
      taskEvents: [
        {
          id: 'task_a',
          kind: 'file',
          round: 1,
          paths: ['src/a.ts'],
          state: 'completed'
        }
      ],
      reviewIntents: [],
      judgeResults: [],
      warnings: []
    }
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
          contentHash: sha256(sourceContent)
        }
      ],
      evidence: [evidence]
    } as const
    const coverage = createCoverageSummary({
      sourceFiles: [{ path: 'src/a.ts', content: sourceContent }],
      contextLedger: [sourceEntry]
    })
    const observability = createNoContentEventRecorder()
    const { logger, records } = createInfoLogger()

    const result = prepareReviewRunnerSuccessResult({
      repositoryRoot: '/repo/project',
      config,
      runId: 'run_success',
      startedAt: new Date('2026-06-22T10:00:00.000Z'),
      completedAt: new Date('2026-06-22T10:00:01.000Z'),
      configHash: sha256('config'),
      warnings: ['drift:documentation'],
      runCost: { warnings: [] },
      analysis,
      coverage,
      contextLedger: [sourceEntry],
      skippedFiles: [],
      admission,
      resolvedBaselineEntries: [],
      observability,
      logger
    })

    expect(result.report.run.runId).toBe('run_success')
    expect(result.report.coverage.status).toBe('complete')
    expect(result.contextLedger).toEqual([sourceEntry])
    expect(result.sharedContext.supportSignalFacts).toEqual(analysis.facts)
    expect(result.sharedContext.taskEvents).toEqual(admission.taskEvents)
    expect(result.sharedContext.evidenceRecords).toEqual([evidence])
    expect(result.reportMetrics).toEqual({
      admittedFindingCount: 0,
      rejectedFindingCount: 0,
      evidenceCount: 1
    })
    expect(
      observability
        .snapshot()
        .events.filter((event) => event.type === 'step-ended')
        .map((event) => ({
          step: event.step,
          attributes: event.attributes
        }))
    ).toEqual([
      {
        step: 'report_assembly',
        attributes: {
          admittedFindingCount: 0,
          rejectedFindingCount: 0,
          evidenceCount: 1
        }
      }
    ])
    expect(records).toEqual([
      {
        message: 'Review run completed.',
        fields: {
          admitted_finding_count: 0,
          rejected_finding_count: 0,
          evidence_count: 1,
          coverage_status: 'complete',
          quality_gate_passed: true
        }
      }
    ])
  })
})
