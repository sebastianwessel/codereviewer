import type { Logger } from '@purista/harness'
import {
  type CodeReviewerConfig,
  type ReviewReport
} from '../../../shared/contracts/index.js'
import type { ContextLedgerEntry } from '../../review-planning/index.js'
import {
  type NoContentEventRecorder,
  type NoContentObservabilitySnapshot
} from '../../observability/index.js'
import {
  type ProviderImport
} from '../../provider-resolution/index.js'
import {
  type DiffMap,
  type GitCommandRunner
} from '../../repository-intake/index.js'
import type { ReviewSharedContextSnapshot } from '../../shared-context/index.js'
import { aiReviewBudgetFor } from './support/budgets.js'
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
import { prepareReviewRunnerChangeIntentContext } from './context/change-intent-context.js'
import { prepareReviewRunnerAnalyzerSignalContext } from './context/analyzer-signal-context.js'
import { prepareReviewRunnerCompletionState } from './results/completion-state.js'

export {
  isReviewRunFailedError,
  ReviewRunFailedError,
  type PartialReviewRunState
} from './support/errors.js'

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
  // The run's shared git runner and changed-file reader, when the review is one
  // stage of a run that already has them. Absent for a review on its own.
  readonly runGit?: GitCommandRunner
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
  const runSignal = createReviewRunSignal(options.signal)
  const { observability, logger } = prepareReviewRunnerRunObservability({
    runId,
    configHash,
    config: options.config,
    ...(options.observability === undefined
      ? {}
      : { observability: options.observability }),
    ...(options.logger === undefined ? {} : { logger: options.logger })
  })

  // Started here and awaited where its result is first needed, below. It reads one
  // JSON file and depends on nothing any later stage produces, so there is no
  // reason for repository intake, planning and context assembly to wait behind it.
  const baselinePending = prepareReviewRunnerBaseline({
    repositoryRoot: options.repositoryRoot,
    config: options.config,
    baselineExplicitlyConfigured: options.baselineExplicitlyConfigured,
    observability,
    logger
  })
  // A stage before the await point can throw, and this promise would then be
  // rejected with nobody listening. The failure is not swallowed: the await below
  // is what reports it, and this only keeps an unrelated failure from being
  // reported as an unhandled rejection instead.
  baselinePending.catch(() => undefined)

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
      ...(options.runGit === undefined ? {} : { runGit: options.runGit }),
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
    const { analysis, evidence, reviewTasks, deterministicSignals } =
      planningState
    const contextState = await prepareReviewRunnerContextAssemblyState({
      repositoryRoot: options.repositoryRoot,
      config: options.config,
      sourceFiles,
      analysis,
      tasks: reviewTasks,
      reviewedDiffText: effectiveRawDiff,
      observability,
      logger
    })
    const { instructionHashes, skillHashes } = contextState
    // Ingest external change-intent context and inject the summarized brief into
    // the tasks before the workflow input is assembled. Disabled or empty
    // ingestion returns the assembled context unchanged.
    const changeIntent = await prepareReviewRunnerChangeIntentContext({
      repositoryRoot: options.repositoryRoot,
      config: options.config,
      assembledContext: contextState.assembledContext,
      sourceFiles,
      environment: options.environment ?? {},
      observability,
      logger,
      ...(options.providerImport === undefined
        ? {}
        : { providerImport: options.providerImport }),
      ...(runSignal.signal === undefined ? {} : { signal: runSignal.signal })
    })
    // Spec 15, Mechanism 2: ingest already-produced analyzer artifacts and attach
    // each task's changed-side-attributed results to it as untrusted evidence.
    // Disabled (the default) this returns the assembled context unchanged. The
    // changed diff ranges are the attribution authority: an alert with no changed
    // line on its location or its traced path is pre-existing repository debt and
    // is not reported.
    const analyzerSignals = await prepareReviewRunnerAnalyzerSignalContext({
      repositoryRoot: options.repositoryRoot,
      config: options.config,
      assembledContext: changeIntent.assembledContext,
      changedRanges: effectiveDiffRanges,
      observability,
      logger
    })
    const assembledContext = analyzerSignals.assembledContext
    // Analyzer evidence joins the run's evidence set so the report records what the
    // review was shown. It seeds no candidate: nothing reaches a finding except
    // through discovery, refutation, and the admission gate.
    const reviewEvidence = [...evidence, ...analyzerSignals.evidence]
    const { baselineFingerprints, baselineConfigured } = await baselinePending
    // Both derivations are consumed twice — once by the workflow input and once by
    // the completion state — and `reviewedLineRangesForSourceFiles` walks the
    // content of every source file to produce them.
    const reviewedPaths = intake.changedFiles.map((file) => file.path)
    const reviewedLineRanges = reviewedLineRangesForSourceFiles(sourceFiles)
    const workflowInput = createWorkflowInput({
      runId,
      repositoryRoot: options.repositoryRoot,
      reviewedPaths,
      reviewedLineRanges,
      reviewedDiffRanges: effectiveDiffRanges,
      reviewedDiffText: effectiveRawDiff,
      evidence: reviewEvidence,
      candidates: [],
      config: options.config,
      configHash,
      providerId: options.config.provider?.id ?? '',
      modelName: options.config.provider?.model ?? '',
      admittedAt: startedAt.toISOString(),
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
        evidence: reviewEvidence,
        workflowInput,
        environment: options.environment ?? {},
        ...(options.providerImport === undefined
          ? {}
          : { providerImport: options.providerImport }),
        skillDefinitions: assembledContext.skillDefinitions,
        skillIds: assembledContext.skillIds,
        logger,
        observability,
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
      testMappings: deterministicSignals.testMappings,
      contextLedger: assembledContext.contextLedger,
      evidence: reviewEvidence,
      ...(changeIntent.usage === undefined
        ? {}
        : { contextIngestionUsage: changeIntent.usage }),
      contextIngestionWarnings: [
        ...changeIntent.warnings,
        ...analyzerSignals.warnings
      ],
      providerWorkflow,
      providerTaskEventsObservedLive,
      reviewedPaths,
      reviewedLineRanges,
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
    })
    recordObservedError(observability, failure.structuredError)
    logger.error(failure.logMessage, failure.logMetadata)
    throw failure.throwError
  } finally {
    runSignal.cleanup()
    await observability.shutdown()
  }
}
