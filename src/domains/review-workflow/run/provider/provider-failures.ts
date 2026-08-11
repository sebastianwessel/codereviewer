import type {
  CodeReviewerConfig,
  EvidenceRecord
} from '../../../../shared/contracts/index.js'
import { normalizeError } from '../../../../shared/errors/error-normalizer.js'
import type { DeterministicSignalExtraction } from '../../../deterministic-signals/index.js'
import type { DriftFinding } from '../../../drift/index.js'
import type { NoContentObservabilitySnapshot } from '../../../observability/index.js'
import type { ContextLedgerEntry } from '../../../review-planning/index.js'
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
    // A model search WAS performed, and this is the only value that is true.
    //
    // The path is narrower than "the provider workflow threw": it is reached
    // only for a `ReviewTaskExecutionError`, which the task queue raises after
    // the provider was resolved, the harness was built and tasks were dispatched
    // to the model — a resolution failure never gets here, it rethrows and the
    // run ends with no summary at all. `partialResults` on this error can even
    // carry candidates a model produced.
    //
    // So `not-performed` would be false, and it is the one value with
    // consequences: it suppresses the model name and every measured rate, on the
    // grounds that nothing looked. Something did, and the model it used is
    // exactly what the reader of a failed run needs named.
    //
    // The vocabulary is not extended to a third `interrupted` value, though the
    // search was interrupted. That fact is already in this artifact twice — the
    // `partial-run` warning above and the `error.json` written beside the
    // summary — and this field answers a different question ("did a model search
    // this change") for surfaces that all key on an explicit `not-performed`. A
    // third value would encode incompleteness a second time, in the one field
    // that exists to keep an unsearched run from reading as a clean one.
    modelSearch: 'performed',
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
