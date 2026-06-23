import type {
  CodeReviewerConfig,
  EvidenceRecord
} from '../../shared/contracts/index.js'
import { normalizeError } from '../../shared/errors/error-normalizer.js'
import type { CandidateFinding } from '../admission/index.js'
import type { DeterministicSignalExtraction } from '../deterministic-signals/index.js'
import type { DriftFinding } from '../drift/index.js'
import type { NoContentObservabilitySnapshot } from '../observability/index.js'
import type { ContextLedgerEntry } from '../review-planning/context-ledger.js'
import {
  candidateFindingsFromTaskResults,
  sharedTaskEventFromWorkflow,
  timedOutTaskEventsFor
} from './review-runner-admission.js'
import {
  createReviewRunTimeoutError,
  isHarnessRunTimeoutError,
  type ReviewRunFailedError
} from './review-runner-errors.js'
import { driftWarningsFor } from './review-runner-drift.js'
import { createPartialReviewRunFailedError } from './review-runner-partial-state.js'
import { createSharedContextSnapshot } from './review-runner-results.js'
import {
  isReviewTaskExecutionError,
  type ReviewTaskExecutionError
} from './workflow-task-queue.js'
import type { WorkflowReviewTask } from './model-agent-contracts.js'

type ProviderFailureBaseInput = {
  readonly repositoryRoot: string
  readonly config: CodeReviewerConfig
  readonly configWarnings?: readonly string[] | undefined
  readonly driftFindings: readonly DriftFinding[]
  readonly baseRef?: string | undefined
  readonly headRef?: string | undefined
  readonly runId: string
  readonly startedAt: Date
  readonly completedAt: Date
  readonly configHash: string
  readonly analysis: DeterministicSignalExtraction
  readonly contextLedger: readonly ContextLedgerEntry[]
  readonly evidence: readonly EvidenceRecord[]
  readonly supportSignalCandidates: readonly CandidateFinding[]
  readonly observability: NoContentObservabilitySnapshot
}

const partialWarningsFor = (
  input: Pick<
    ProviderFailureBaseInput,
    'configWarnings' | 'driftFindings'
  >
): readonly string[] => [
  ...(input.configWarnings ?? []),
  ...driftWarningsFor(input.driftFindings),
  'partial-run'
]

export const createProviderTimeoutFailure = (
  input: ProviderFailureBaseInput & {
    readonly tasks: readonly WorkflowReviewTask[]
    readonly timeoutMs: number
  }
): ReviewRunFailedError =>
  createPartialReviewRunFailedError({
    structuredError: createReviewRunTimeoutError(input.timeoutMs),
    artifactDir: input.config.paths.artifactDir,
    repositoryRoot: input.repositoryRoot,
    config: input.config,
    baseRef: input.baseRef,
    headRef: input.headRef,
    runId: input.runId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    configHash: input.configHash,
    warnings: partialWarningsFor(input),
    contextLedger: input.contextLedger,
    sharedContext: createSharedContextSnapshot({
      analysis: input.analysis,
      taskEvents: timedOutTaskEventsFor(input.tasks),
      contextLedger: input.contextLedger,
      evidence: input.evidence,
      candidates: input.supportSignalCandidates,
      admissionDecisions: [],
      admittedFindings: [],
      rejectedFindings: []
    }),
    observability: input.observability
  })

export const createProviderTaskExecutionFailure = (
  input: ProviderFailureBaseInput & {
    readonly executionError: ReviewTaskExecutionError
    readonly timedOut: boolean
    readonly timeoutMs?: number | undefined
  }
): ReviewRunFailedError => {
  const structuredError =
    input.timedOut && input.timeoutMs !== undefined
      ? createReviewRunTimeoutError(input.timeoutMs)
      : normalizeError(input.executionError.originalError, {
          source: 'provider',
          operation: 'run_review_task'
        })
  const candidates = [
    ...input.supportSignalCandidates,
    ...candidateFindingsFromTaskResults(input.executionError.partialResults)
  ]

  return createPartialReviewRunFailedError({
    structuredError,
    artifactDir: input.config.paths.artifactDir,
    repositoryRoot: input.repositoryRoot,
    config: input.config,
    baseRef: input.baseRef,
    headRef: input.headRef,
    runId: input.runId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    configHash: input.configHash,
    warnings: partialWarningsFor(input),
    contextLedger: input.contextLedger,
    sharedContext: createSharedContextSnapshot({
      analysis: input.analysis,
      taskEvents: input.executionError.taskEvents.map(sharedTaskEventFromWorkflow),
      contextLedger: input.contextLedger,
      evidence: input.evidence,
      candidates,
      admissionDecisions: [],
      admittedFindings: [],
      rejectedFindings: []
    }),
    observability: input.observability
  })
}

export const createProviderWorkflowFailure = (
  input: ProviderFailureBaseInput & {
    readonly error: unknown
    readonly runTimedOut: boolean
    readonly tasks: readonly WorkflowReviewTask[]
    readonly timeoutMs?: number | undefined
  }
): ReviewRunFailedError | undefined => {
  if (!isReviewTaskExecutionError(input.error)) {
    if (
      (input.runTimedOut || isHarnessRunTimeoutError(input.error)) &&
      input.timeoutMs !== undefined
    ) {
      return createProviderTimeoutFailure({
        ...input,
        timeoutMs: input.timeoutMs
      })
    }

    return undefined
  }

  return createProviderTaskExecutionFailure({
    ...input,
    executionError: input.error,
    timedOut:
      input.runTimedOut || isHarnessRunTimeoutError(input.error.originalError)
  })
}
