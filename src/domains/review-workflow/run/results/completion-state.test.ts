import type { Logger } from '@purista/harness'
import { describe, expect, test } from 'vitest'
import { createContextLedgerEntry } from '../../../review-planning/context-ledger.js'
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
  kind: 'deterministic-signal',
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
      contextLedger,
      evidence: [evidence],
      supportSignalCandidates: [],
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
})
