import type { Logger } from '@purista/harness'
import { describe, expect, test } from 'vitest'
import {
  CodeReviewerConfigSchema,
  type EvidenceRecord
} from '../../shared/contracts/index.js'
import type { CandidateFinding } from '../admission/index.js'
import type { DeterministicSignalExtraction } from '../deterministic-signals/index.js'
import type { DriftFinding } from '../drift/index.js'
import { createNoContentEventRecorder } from '../observability/index.js'
import { ReviewRunFailedError } from './review-runner-errors.js'
import { prepareReviewRunnerProviderState } from './review-runner-provider-state.js'
import {
  ReviewWorkflowInputSchema,
  ReviewWorkflowOutputSchema
} from './workflow-contracts.js'
import type { WorkflowReviewTask } from './model-agent-contracts.js'

const configHash =
  '9999999999999999999999999999999999999999999999999999999999999999'

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
  provider: {
    id: 'openai',
    model: 'gpt-5-mini'
  },
  review: {
    runTimeoutMs: 10000,
    maxConcurrentTasks: 1
  }
})

const evidence: EvidenceRecord = {
  id: 'ev_providerstate',
  kind: 'deterministic-signal',
  summary: 'Provider state evidence.',
  location: { path: 'src/a.ts', startLine: 1, side: 'file' },
  source: 'deterministic-support-signal',
  redactionApplied: true
}

const analysis: DeterministicSignalExtraction = {
  facts: [],
  evidence: [evidence]
}

const driftFindings: readonly DriftFinding[] = []
const supportSignalCandidates: readonly CandidateFinding[] = []

const task: WorkflowReviewTask = {
  id: 'task_provider_state',
  kind: 'file',
  round: 1,
  paths: ['src/a.ts'],
  factIds: [],
  evidenceIds: ['ev_providerstate'],
  candidateIds: [],
  contextEntryIds: [],
  priority: 0,
  reviewContext: []
}

const workflowInput = ReviewWorkflowInputSchema.parse({
  runId: 'run_provider_state',
  repositoryRoot: '/repo/project',
  reviewedPaths: ['src/a.ts'],
  evidence: [evidence],
  candidates: [],
  instructions: [],
  skills: [],
  tasks: [task],
  provenance: {
    reviewer: 'review-agent',
    signalVersions: {},
    configHash
  },
  baselineConfigured: false
})

const workflowOutput = ReviewWorkflowOutputSchema.parse({
  admittedFindings: [],
  rejectedFindings: [],
  evidence: [evidence],
  candidateFindings: [],
  contextLedgerEntries: [],
  reviewIntents: [],
  modelSuspicions: [],
  investigationTraces: [],
  proofPackets: [],
  refutationResults: [],
  aggregateResults: [],
  judgeResults: [],
  promotionDecisions: [],
  providerIssues: [],
  admissionDecisions: [],
  taskEvents: [],
  qualityGate: {
    passed: true,
    failingFindingIds: [],
    thresholds: {
      maxCritical: null,
      maxHigh: null,
      maxMedium: null,
      failOnProviderError: true,
      failOnNewOnly: false
    },
    baselineFilteringApplied: false
  },
  instructionHashes: [],
  skillHashes: [],
  warnings: []
})

const commonInput = {
  repositoryRoot: '/repo/project',
  config,
  driftFindings,
  runId: 'run_provider_state',
  startedAt: new Date('2026-06-23T00:00:00.000Z'),
  now: () => new Date('2026-06-23T00:00:01.000Z'),
  configHash,
  analysis,
  contextLedger: [],
  evidence: [evidence],
  supportSignalCandidates,
  workflowInput,
  tasks: [task],
  skillDefinitions: {},
  skillIds: [],
  environment: {},
  logger: createDebugLogger()
} as const

describe('review runner provider state', () => {
  test('runs the provider workflow and records live provider task events', async () => {
    const observability = createNoContentEventRecorder()
    const providerWorkflow = {
      output: workflowOutput,
      usage: {
        inputTokens: 3,
        outputTokens: 2
      }
    }

    const result = await prepareReviewRunnerProviderState({
      ...commonInput,
      observability,
      runTimedOut: () => false,
      runProviderWorkflow: async (input) => {
        input.onTaskEvent?.({
          id: 'task_provider_state',
          kind: 'file',
          round: 1,
          paths: ['src/a.ts'],
          state: 'completed',
          workerId: 'worker-1'
        })

        return providerWorkflow
      }
    })

    expect(result.providerWorkflow).toBe(providerWorkflow)
    expect(result.providerTaskEventsObservedLive).toBe(true)
    expect(
      observability
        .snapshot()
        .events.filter((event) => event.type === 'task-event')
        .map((event) => event.attributes)
    ).toEqual([
      {
        taskId: 'task_provider_state',
        kind: 'file',
        round: 1,
        state: 'completed',
        pathCount: 1,
        workerId: 'worker-1'
      }
    ])
  })

  test('converts timed-out provider workflow errors to partial run failures', async () => {
    const observability = createNoContentEventRecorder()

    await expect(
      prepareReviewRunnerProviderState({
        ...commonInput,
        observability,
        runTimedOut: () => true,
        runProviderWorkflow: async () => {
          throw new Error('provider timed out')
        }
      })
    ).rejects.toSatisfy(
      (error) =>
        error instanceof ReviewRunFailedError &&
        error.structuredError.code === 'review_run_timeout'
    )
  })
})
