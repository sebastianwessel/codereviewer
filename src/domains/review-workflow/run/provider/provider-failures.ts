import type {
  CodeReviewerConfig,
  EvidenceRecord
} from '../../../../shared/contracts/index.js'
import { normalizeError } from '../../../../shared/errors/error-normalizer.js'
import type { DeterministicSignalExtraction } from '../../../deterministic-signals/index.js'
import type { DriftFinding } from '../../../drift/index.js'
import type { NoContentObservabilitySnapshot } from '../../../observability/index.js'
import type { ContextLedgerEntry } from '../../../review-planning/context-ledger.js'
import {
  candidateFindingsFromTaskResults,
  sharedTaskEventFromWorkflow
} from '../admission.js'
import {
  type ReviewRunFailedError
} from '../support/errors.js'
import { driftWarningsFor } from '../drift.js'
import { createPartialReviewRunFailedError } from '../results/partial-state.js'
import { createSharedContextSnapshot } from '../results/results.js'
import {
  isReviewTaskExecutionError,
  type ReviewTaskExecutionError
} from '../../pipeline/task-queue.js'

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

export const createProviderTaskExecutionFailure = (
  input: ProviderFailureBaseInput & {
    readonly executionError: ReviewTaskExecutionError
  }
): ReviewRunFailedError => {
  const structuredError = normalizeError(
    input.executionError.originalError,
    {
      source: 'provider',
      operation: 'run_review_task'
    }
  )
  const candidates = [
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
  }
): ReviewRunFailedError | undefined => {
  if (!isReviewTaskExecutionError(input.error)) {
    return undefined
  }

  return createProviderTaskExecutionFailure({
    ...input,
    executionError: input.error
  })
}
