import type { Logger } from '@purista/harness'
import type {
  CodeReviewerConfig,
  EvidenceRecord,
  ReviewReport
} from '../../shared/contracts/index.js'
import type {
  CandidateFinding,
  ReviewedDiffRange,
  ReviewedLineRange
} from '../admission/index.js'
import type {
  DeterministicSignalExtraction,
  SupportSignalSourceFile
} from '../deterministic-signals/index.js'
import type { DriftFinding } from '../drift/index.js'
import type { NoContentEventRecorder } from '../observability/index.js'
import type { ContextLedgerEntry } from '../review-planning/context-ledger.js'
import type { WorkflowReviewTask } from './model-agent-contracts.js'
import {
  prepareReviewRunnerAdmissionState
} from './review-runner-admission.js'
import { prepareReviewRunFinalization } from './review-runner-finalization.js'
import {
  createReviewRunnerCostBudgetFailure,
  createReviewRunnerCoverageFailure
} from './review-runner-quality-failures.js'
import {
  createCoverageSummary,
  prepareReviewRunnerSuccessResult,
  type ReviewRunnerSuccessResult
} from './review-runner-results.js'
import { recordObservedTaskEvents } from './review-runner-observability.js'
import type { ReviewRunnerProviderState } from './review-runner-provider-state.js'
import type { BaselineFingerprintRecord } from '../admission/index.js'

export const prepareReviewRunnerCompletionState = (
  input: {
    readonly repositoryRoot: string
    readonly config: CodeReviewerConfig
    readonly configWarnings?: readonly string[] | undefined
    readonly driftFindings: readonly DriftFinding[]
    readonly baseRef?: string | undefined
    readonly headRef?: string | undefined
    readonly runId: string
    readonly startedAt: Date
    readonly now: () => Date
    readonly configHash: string
    readonly sourceFiles: readonly SupportSignalSourceFile[]
    readonly skippedFiles: readonly ReviewReport['skippedFiles'][number][]
    readonly analysis: DeterministicSignalExtraction
    readonly contextLedger: readonly ContextLedgerEntry[]
    readonly evidence: readonly EvidenceRecord[]
    readonly supportSignalCandidates: readonly CandidateFinding[]
    readonly providerWorkflow: ReviewRunnerProviderState['providerWorkflow']
    readonly providerTaskEventsObservedLive: boolean
    readonly reviewedPaths: readonly string[]
    readonly reviewedLineRanges: readonly ReviewedLineRange[]
    readonly reviewedDiffRanges: readonly ReviewedDiffRange[]
    readonly admittedAt: string
    readonly instructionHashes: readonly string[]
    readonly skillHashes: readonly string[]
    readonly baselineConfigured: boolean
    readonly baselineFingerprints?: readonly BaselineFingerprintRecord[] | undefined
    readonly tasks: readonly WorkflowReviewTask[]
    readonly observability: NoContentEventRecorder
    readonly logger: Logger
  }
): ReviewRunnerSuccessResult => {
  const providerWorkflowOutput = input.providerWorkflow?.output
  const { admission } = prepareReviewRunnerAdmissionState({
    providerWorkflowOutput,
    reviewedPaths: input.reviewedPaths,
    reviewedLineRanges: input.reviewedLineRanges,
    reviewedDiffRanges: input.reviewedDiffRanges,
    candidates: input.supportSignalCandidates,
    evidence: input.evidence,
    config: input.config,
    admittedAt: input.admittedAt,
    configHash: input.configHash,
    instructionHashes: input.instructionHashes,
    skillHashes: input.skillHashes,
    baselineConfigured: input.baselineConfigured,
    tasks: input.tasks,
    observability: input.observability,
    logger: input.logger,
    ...(input.baselineFingerprints === undefined
      ? {}
      : { baselineFingerprints: input.baselineFingerprints })
  })
  if (!input.providerTaskEventsObservedLive) {
    recordObservedTaskEvents(input.observability, admission.taskEvents)
  }
  const effectiveContextLedger = [
    ...input.contextLedger,
    ...admission.contextLedgerEntries
  ]
  const completedAt = input.now()
  const coverage = createCoverageSummary({
    sourceFiles: input.sourceFiles,
    contextLedger: effectiveContextLedger
  })
  const { runCost, warnings, resolvedBaselineEntries } =
    prepareReviewRunFinalization({
      config: input.config,
      configWarnings: input.configWarnings,
      driftFindings: input.driftFindings,
      admissionWarnings: admission.warnings,
      admittedFindings: admission.admittedFindings,
      ...(input.baselineFingerprints === undefined
        ? {}
        : { baselineFingerprints: input.baselineFingerprints }),
      ...(input.providerWorkflow?.usage === undefined
        ? {}
        : { providerUsage: input.providerWorkflow.usage })
    })
  if (coverage.status !== 'complete') {
    throw createReviewRunnerCoverageFailure({
      repositoryRoot: input.repositoryRoot,
      config: input.config,
      baseRef: input.baseRef,
      headRef: input.headRef,
      runId: input.runId,
      startedAt: input.startedAt,
      completedAt,
      configHash: input.configHash,
      warnings,
      runCost,
      analysis: input.analysis,
      admission,
      coverage,
      contextLedger: effectiveContextLedger,
      observability: input.observability.snapshot()
    })
  }
  if (
    input.config.review.maxCostUsd !== undefined &&
    runCost.costUsd !== undefined &&
    runCost.costUsd > input.config.review.maxCostUsd
  ) {
    throw createReviewRunnerCostBudgetFailure({
      repositoryRoot: input.repositoryRoot,
      config: input.config,
      baseRef: input.baseRef,
      headRef: input.headRef,
      runId: input.runId,
      startedAt: input.startedAt,
      completedAt: input.now(),
      configHash: input.configHash,
      warnings,
      runCost,
      analysis: input.analysis,
      admission,
      maxCostUsd: input.config.review.maxCostUsd,
      costUsd: runCost.costUsd,
      contextLedger: effectiveContextLedger,
      observability: input.observability.snapshot()
    })
  }

  return prepareReviewRunnerSuccessResult({
    repositoryRoot: input.repositoryRoot,
    config: input.config,
    baseRef: input.baseRef,
    headRef: input.headRef,
    runId: input.runId,
    startedAt: input.startedAt,
    completedAt,
    configHash: input.configHash,
    warnings,
    runCost,
    analysis: input.analysis,
    coverage,
    contextLedger: effectiveContextLedger,
    skippedFiles: input.skippedFiles,
    admission,
    resolvedBaselineEntries,
    observability: input.observability,
    logger: input.logger
  })
}
