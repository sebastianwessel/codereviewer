import type {
  CodeReviewerConfig,
  CoverageSummary
} from '../../../../shared/contracts/index.js'
import type { RunCostSummary } from '../../../costs/index.js'
import type { DeterministicSignalExtraction } from '../../../deterministic-signals/index.js'
import type { NoContentObservabilitySnapshot } from '../../../observability/index.js'
import type { ContextLedgerEntry } from '../../../review-planning/context-ledger.js'
import {
  createCostBudgetExceededError,
  createCoverageIncompleteError,
  type ReviewRunFailedError
} from '../support/errors.js'
import type { ReviewRunnerAdmissionState } from '../admission.js'
import { createPartialReviewRunFailedError } from './partial-state.js'
import { createSharedContextSnapshot } from './results.js'

type ReviewRunnerQualityFailureInput = {
  readonly repositoryRoot: string
  readonly config: CodeReviewerConfig
  readonly baseRef?: string | undefined
  readonly headRef?: string | undefined
  readonly runId: string
  readonly startedAt: Date
  readonly completedAt: Date
  readonly configHash: string
  readonly warnings: readonly string[]
  readonly runCost: RunCostSummary
  readonly analysis: DeterministicSignalExtraction
  readonly admission: ReviewRunnerAdmissionState
  readonly contextLedger: readonly ContextLedgerEntry[]
  readonly observability: NoContentObservabilitySnapshot
}

const createAdmissionSharedContext = (
  input: Pick<
    ReviewRunnerQualityFailureInput,
    'analysis' | 'admission' | 'contextLedger'
  >
) =>
  createSharedContextSnapshot({
    analysis: input.analysis,
    taskEvents: input.admission.taskEvents,
    contextLedger: input.contextLedger,
    evidence: input.admission.evidence,
    candidates: input.admission.candidateFindings,
    admissionDecisions: input.admission.admissionDecisions,
    admittedFindings: input.admission.admittedFindings,
    rejectedFindings: input.admission.rejectedFindings
  })

const createQualityFailure = (
  input: ReviewRunnerQualityFailureInput & {
    readonly structuredError: Parameters<
      typeof createPartialReviewRunFailedError
    >[0]['structuredError']
  }
): ReviewRunFailedError =>
  createPartialReviewRunFailedError({
    structuredError: input.structuredError,
    artifactDir: input.config.paths.artifactDir,
    repositoryRoot: input.repositoryRoot,
    config: input.config,
    baseRef: input.baseRef,
    headRef: input.headRef,
    runId: input.runId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    configHash: input.configHash,
    warnings: input.warnings,
    runCost: input.runCost,
    contextLedger: input.contextLedger,
    sharedContext: createAdmissionSharedContext(input),
    observability: input.observability
  })

export const createReviewRunnerCoverageFailure = (
  input: ReviewRunnerQualityFailureInput & {
    readonly coverage: CoverageSummary
  }
): ReviewRunFailedError =>
  createQualityFailure({
    ...input,
    structuredError: createCoverageIncompleteError(input.coverage)
  })

export const createReviewRunnerCostBudgetFailure = (
  input: ReviewRunnerQualityFailureInput & {
    readonly maxCostUsd: number
    readonly costUsd: number
  }
): ReviewRunFailedError =>
  createQualityFailure({
    ...input,
    structuredError: createCostBudgetExceededError({
      maxCostUsd: input.maxCostUsd,
      costUsd: input.costUsd
    })
  })
