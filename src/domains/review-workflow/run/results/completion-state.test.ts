import type { Logger } from '@purista/harness'
import { describe, expect, test } from 'vitest'
import { createContextLedgerEntry } from '../../../review-planning/index.js'
import {
  CodeReviewerConfigSchema,
  type EvidenceRecord
} from '../../../../shared/contracts/index.js'
import type { DeterministicSignalExtraction } from '../../../deterministic-signals/index.js'
import { createNoContentEventRecorder } from '../../../observability/index.js'
import { prepareReviewRunnerCompletionState } from './completion-state.js'
import type { WorkflowReviewTask } from '../../pipeline/agent-contracts.js'

const configHash =
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

const createDebugLogger = (): Logger => {
  const logger: Logger = {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: () => logger
  }

  return logger
}

const config = CodeReviewerConfigSchema.parse({
  review: {
    maxConcurrentTasks: 1
  }
})

const evidence: EvidenceRecord = {
  id: 'ev_completion',
  kind: 'diagnostic',
  summary: 'Completion state evidence.',
  location: { path: 'src/a.ts', startLine: 1, side: 'file' },
  source: 'deterministic-support-signal',
  redactionApplied: true
}

const analysis: DeterministicSignalExtraction = {
  facts: [],
  evidence: [evidence]
}

const sourceFiles = [{ path: 'src/a.ts', content: 'abc' }] as const

const task: WorkflowReviewTask = {
  id: 'task_completion',
  kind: 'file',
  round: 1,
  paths: ['src/a.ts'],
  factIds: [],
  evidenceIds: ['ev_completion'],
  candidateIds: [],
  contextEntryIds: [],
  priority: 0,
  instructions: [],
  reviewContext: []
}

const contextLedger = [
  createContextLedgerEntry({
    kind: 'file',
    path: 'src/a.ts',
    taskId: 'task_completion',
    reason: 'task-context-source-chunk',
    decision: 'included',
    bytesConsidered: 3,
    bytesIncluded: 3,
    content: 'abc'
  })
] as const

describe('review runner completion state', () => {
  test('runs deterministic fallback admission, records task events, and returns success state', () => {
    const observability = createNoContentEventRecorder()
    const result = prepareReviewRunnerCompletionState({
      repositoryRoot: '/repo/project',
      config,
      configWarnings: [],
      driftFindings: [],
      runId: 'run_completion',
      startedAt: new Date('2026-06-23T00:00:00.000Z'),
      now: () => new Date('2026-06-23T00:00:01.000Z'),
      configHash,
      sourceFiles,
      skippedFiles: [],
      analysis,
      testMappings: [],
      contextLedger,
      evidence: [evidence],
      providerWorkflow: undefined,
      providerTaskEventsObservedLive: false,
      reviewedPaths: ['src/a.ts'],
      reviewedLineRanges: [{ path: 'src/a.ts', startLine: 1, endLine: 1 }],
      reviewedDiffRanges: [],
      admittedAt: new Date('2026-06-23T00:00:00.000Z').toISOString(),
      instructionHashes: [],
      skillHashes: [],
      baselineConfigured: false,
      tasks: [task],
      observability,
      logger: createDebugLogger()
    })

    expect(result.report.coverage.status).toBe('complete')
    expect(result.report.run.runId).toBe('run_completion')
    // An absent provider workflow is the ONE fact that proves no model searched
    // this change, and it is only available here. The report carries it out so no
    // surface has to infer it from `discovery` or `model`, both of which are also
    // absent for reasons that have nothing to do with whether a search ran.
    expect(result.report.run.modelSearch).toBe('not-performed')
    expect(result.report.run).not.toHaveProperty('model')
    expect(result.contextLedger).toEqual(contextLedger)
    expect(result.sharedContext.taskEvents.map((event) => event.state)).toEqual([
      'planned',
      'running',
      'completed'
    ])
    expect(
      observability
        .snapshot()
        .events.filter((event) => event.type === 'task-event')
        .map((event) => event.attributes.state)
    ).toEqual(['planned', 'running', 'completed'])
  })

  // Spec 29. The signal has to reach the report the run actually produces, and it
  // has to be computed from the SAME file set the deterministic registry analysed
  // — otherwise a source file whose test could never have been discovered gets
  // reported as one that has none.
  test('records the test-adequacy signal on the completed report', () => {
    const result = prepareReviewRunnerCompletionState({
      repositoryRoot: '/repo/project',
      config,
      configWarnings: [],
      driftFindings: [],
      runId: 'run_test_adequacy',
      startedAt: new Date('2026-06-23T00:00:00.000Z'),
      now: () => new Date('2026-06-23T00:00:01.000Z'),
      configHash,
      sourceFiles,
      // A path the change REMOVED. It has nothing at head that could carry a test,
      // so it must not appear anywhere in the signal.
      skippedFiles: [{ path: 'src/removed.ts', reason: 'deleted' }],
      analysis,
      testMappings: [],
      contextLedger,
      evidence: [evidence],
      providerWorkflow: undefined,
      providerTaskEventsObservedLive: false,
      reviewedPaths: ['src/a.ts'],
      reviewedLineRanges: [{ path: 'src/a.ts', startLine: 1, endLine: 1 }],
      reviewedDiffRanges: [],
      admittedAt: new Date('2026-06-23T00:00:00.000Z').toISOString(),
      instructionHashes: [],
      skillHashes: [],
      baselineConfigured: false,
      tasks: [task],
      observability: createNoContentEventRecorder(),
      logger: createDebugLogger()
    })

    expect(result.report.testAdequacy).toEqual({
      consideredFileCount: 1,
      pairedFileCount: 0,
      unpairedPaths: ['src/a.ts'],
      changedTestFileCount: 0,
      unknown: { unsupportedLanguageFileCount: 0, notAnalysedFileCount: 0 }
    })
    // Advisory and nothing more: the run still passes its gate and the signal is
    // nowhere among the findings.
    expect(result.report.qualityGate?.passed).toBe(true)
    expect(result.report.admittedFindings).toEqual([])
  })
})
