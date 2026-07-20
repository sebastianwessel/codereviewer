import type { Logger } from '@purista/harness'
import {
  type CodeReviewerConfig,
  type CoverageSummary,
  type ReviewReport
} from '../../../shared/contracts/index.js'
import type { ContextLedgerEntry } from '../../review-planning/context-ledger.js'
import {
  type NoContentEventRecorder,
  type NoContentObservabilitySnapshot
} from '../../observability/index.js'
import {
  type DeterministicSignalExtraction
} from '../../deterministic-signals/index.js'
import {
  type ProviderImport
} from '../../provider-resolution/index.js'
import { type DiffMap } from '../../repository-intake/index.js'
import type { ReviewSharedContextSnapshot } from '../../shared-context/index.js'
import {
  aiReviewBudgetFor,
  type AiReviewRuntimeBudget
} from './support/budgets.js'
import { reviewedLineRangesForSourceFiles } from './context/context.js'
import { createWorkflowInput } from './workflow-input.js'
import {
  createReviewRunSignal,
  createReviewRunTerminalFailure
} from './support/errors.js'
import { prepareReviewRunnerProviderState } from './provider/provider-state.js'
import { prepareReviewRunnerBaseline } from './baseline.js'
import { recordObservedError } from './support/observability.js'
import { createReviewRunStartState } from './support/run-state.js'
import { runReviewRunnerPreflight } from './preflight.js'
import { prepareReviewRunnerRunObservability } from './support/run-observability.js'
import { prepareReviewRunnerSourceState } from './intake/source-state.js'
import { prepareReviewRunnerPlanningState } from './planning/planning-state.js'
import { prepareReviewRunnerContextAssemblyState } from './context/assembly-state.js'
import { prepareReviewRunnerCompletionState } from './results/completion-state.js'

export {
  isReviewRunFailedError,
  ReviewRunFailedError,
  type PartialReviewRunState
} from './support/errors.js'

const emptySha256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

export type RunReviewOptions = {
  readonly repositoryRoot: string
  readonly config: CodeReviewerConfig
  readonly configWarnings?: readonly string[]
  readonly baselineExplicitlyConfigured?: boolean
  readonly explicitFiles?: readonly string[]
  readonly reviewDiffMaps?: readonly DiffMap[]
  readonly reviewRawDiff?: string
  readonly baseRef?: string
  readonly headRef?: string
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly providerImport?: ProviderImport
  readonly runId?: string
  readonly now?: () => Date
  readonly signal?: AbortSignal
  readonly observability?: NoContentEventRecorder
  readonly logger?: Logger
}

export type ReviewRunnerResult = {
  readonly report: ReviewReport
  readonly contextLedger: readonly ContextLedgerEntry[]
  readonly sharedContext: ReviewSharedContextSnapshot
  readonly observability: NoContentObservabilitySnapshot
}

export const runReview = async (
  options: RunReviewOptions
): Promise<ReviewRunnerResult> => {
  const { now, startedAt, runId, configHash } = createReviewRunStartState({
    config: options.config,
    ...(options.runId === undefined ? {} : { runId: options.runId }),
    ...(options.now === undefined ? {} : { now: options.now })
  })
  const runSignal = createReviewRunSignal(
    options.signal,
    options.config.review.runTimeoutMs
  )
  const { observability, logger } = prepareReviewRunnerRunObservability({
    runId,
    configHash,
    config: options.config,
    ...(options.observability === undefined
      ? {}
      : { observability: options.observability }),
    ...(options.logger === undefined ? {} : { logger: options.logger })
  })

  try {
    const { drift } = await runReviewRunnerPreflight({
      repositoryRoot: options.repositoryRoot,
      config: options.config,
      observability,
      logger
    })

    const sourceState = await prepareReviewRunnerSourceState({
      repositoryRoot: options.repositoryRoot,
      config: options.config,
      observability,
      logger,
      ...(options.baseRef === undefined ? {} : { baseRef: options.baseRef }),
      ...(options.headRef === undefined ? {} : { headRef: options.headRef }),
      ...(options.reviewDiffMaps === undefined
        ? {}
        : { reviewDiffMaps: options.reviewDiffMaps }),
      ...(options.reviewRawDiff === undefined
        ? {}
        : { reviewRawDiff: options.reviewRawDiff }),
      ...(options.explicitFiles === undefined
        ? {}
        : { explicitFiles: options.explicitFiles }),
      ...(runSignal.signal === undefined ? {} : { signal: runSignal.signal })
    })
    const { intake, effectiveDiffRanges, effectiveRawDiff, sourceFiles } =
      sourceState
    const planningState = prepareReviewRunnerPlanningState({
      config: options.config,
      files: intake.changedFiles,
      sourceFiles,
      observability,
      logger
    })
    const { analysis, evidence, reviewTasks, supportSignalCandidates } =
      planningState
    const contextState = await prepareReviewRunnerContextAssemblyState({
      repositoryRoot: options.repositoryRoot,
      config: options.config,
      sourceFiles,
      analysis,
      tasks: reviewTasks,
      observability,
      logger
    })
    const { assembledContext, instructionHashes, skillHashes } = contextState
    const baseline = await prepareReviewRunnerBaseline({
      repositoryRoot: options.repositoryRoot,
      config: options.config,
      baselineExplicitlyConfigured: options.baselineExplicitlyConfigured,
      observability,
      logger
    })
    const { baselineFingerprints, baselineConfigured } = baseline
    const workflowInput = createWorkflowInput({
      runId,
      repositoryRoot: options.repositoryRoot,
      reviewedPaths: intake.changedFiles.map((file) => file.path),
      reviewedLineRanges: reviewedLineRangesForSourceFiles(sourceFiles),
      reviewedDiffRanges: effectiveDiffRanges,
      reviewedDiffText: effectiveRawDiff,
      evidence,
      candidates: supportSignalCandidates,
      config: options.config,
      configHash,
      providerId: options.config.provider?.id ?? '',
      modelName: options.config.provider?.model ?? '',
      admittedAt: startedAt.toISOString(),
      instructions: assembledContext.instructions,
      skills: assembledContext.skills,
      tasks: assembledContext.tasks,
      aiReviewBudget: aiReviewBudgetFor(options.config),
      baselineConfigured,
      ...(baselineFingerprints === undefined ? {} : { baselineFingerprints })
    })
    const { providerWorkflow, providerTaskEventsObservedLive } =
      await prepareReviewRunnerProviderState({
        repositoryRoot: options.repositoryRoot,
        config: options.config,
        configWarnings: options.configWarnings,
        driftFindings: drift.findings,
        baseRef: options.baseRef,
        headRef: options.headRef,
        runId,
        startedAt,
        now,
        configHash,
        analysis,
        contextLedger: assembledContext.contextLedger,
        evidence,
        supportSignalCandidates,
        workflowInput,
        tasks: assembledContext.tasks,
        environment: options.environment ?? {},
        ...(options.providerImport === undefined
          ? {}
          : { providerImport: options.providerImport }),
        skillDefinitions: assembledContext.skillDefinitions,
        skillIds: assembledContext.skillIds,
        logger,
        observability,
        runTimedOut: runSignal.timedOut,
        ...(runSignal.signal === undefined ? {} : { signal: runSignal.signal })
      })
    const successResult = prepareReviewRunnerCompletionState({
      repositoryRoot: options.repositoryRoot,
      config: options.config,
      configWarnings: options.configWarnings,
      driftFindings: drift.findings,
      baseRef: options.baseRef,
      headRef: options.headRef,
      runId,
      startedAt,
      now,
      configHash,
      mergeBaseRef: intake.repositorySnapshot.mergeBaseRef,
      sourceFiles,
      skippedFiles: intake.skippedFiles,
      analysis,
      contextLedger: assembledContext.contextLedger,
      evidence,
      supportSignalCandidates,
      providerWorkflow,
      providerTaskEventsObservedLive,
      reviewedPaths: intake.changedFiles.map((file) => file.path),
      reviewedLineRanges: reviewedLineRangesForSourceFiles(sourceFiles),
      reviewedDiffRanges: effectiveDiffRanges,
      admittedAt: startedAt.toISOString(),
      instructionHashes,
      skillHashes,
      baselineConfigured,
      tasks: assembledContext.tasks,
      observability,
      logger,
      ...(baselineFingerprints === undefined ? {} : { baselineFingerprints })
    })

    return {
      report: successResult.report,
      contextLedger: successResult.contextLedger,
      sharedContext: successResult.sharedContext,
      observability: observability.snapshot()
    }
  } catch (error) {
    const failure = createReviewRunTerminalFailure({
      error,
      runTimedOut: runSignal.timedOut(),
      timeoutMs: options.config.review.runTimeoutMs
    })
    recordObservedError(observability, failure.structuredError)
    logger.error(failure.logMessage, failure.logMetadata)
    throw failure.throwError
  } finally {
    runSignal.cleanup()
    await observability.shutdown()
  }
}
