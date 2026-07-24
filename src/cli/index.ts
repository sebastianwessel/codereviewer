import { appendFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  resolveExistingPathInsideRoot,
  resolvePathInsideRoot
} from '../platform/path-service.js'
import {
  EVAL_RECALL_REPORT_ARTIFACT_NAME,
  EVAL_SUMMARY_ARTIFACT_NAME,
  EvalReportSchema,
  assertBenchmarkSlicesHydrated,
  createModelPlausibilityJudge,
  createModelSemanticJudge,
  createEvalSliceManifest,
  loadEvalCasesFromFixtures,
  renderEvalComparison,
  renderEvalRecallReport,
  renderEvalSummary,
  runEvaluation,
  type EvalCaseFileReader,
} from '../domains/evaluation/index.js'
import { runDriftCheck } from '../domains/drift/index.js'
import {
  isReviewRunFailedError,
  runReview as runReviewPipeline
} from '../domains/review-workflow/index.js'
import {
  resolveProviderModelAlias,
  type ProviderImport
} from '../domains/provider-resolution/index.js'
import {
  createReviewLogger,
  type Logger,
  type ReviewLogSink
} from '../domains/observability/index.js'
import {
  latestRunWithReport,
  parseRunIndex
} from '../domains/reporting/index.js'
import {
  buildBaselineEntries,
  renderBaselineJson
} from '../domains/admission/index.js'
import {
  corroborateFindings,
  runFixRun,
  runVerificationRun,
  runWarningsForVerificationReport,
  type InvestigationRunContext,
  type VerificationReport
} from '../domains/verification/index.js'
import { loadCodeReviewerConfig } from '../domains/configuration/config-loader.js'
import { createRedactedConfigSummary } from '../domains/configuration/config-summary.js'
import {
  createStructuredError,
  isFileSystemError,
  isZodError,
  normalizeError,
  type ErrorSource
} from '../shared/errors/error-normalizer.js'
import type {
  AdmittedFinding,
  CodeReviewerConfig
} from '../shared/contracts/index.js'
import {
  parseConfigPath,
  parseEnumOption,
  parseExplicitFiles,
  parseIntegerOption,
  parseLogFileOverride,
  parseLogLevelOverride,
  parseOptionValue,
  parseOptionValues
} from './args.js'
import {
  ensureDirectory,
  jsonResult,
  readRunIndex,
  recordRunInIndex,
  resolveArtifactWritePath,
  writePartialReviewArtifacts,
  writeReviewArtifacts,
  writeRunArtifact
} from './run-artifacts.js'
import { runEvalCase } from './eval-case-runner.js'

export type CliResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export type CliRunOptions = {
  readonly cwd: string
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly logSink?: ReviewLogSink
  readonly providerImport?: ProviderImport
}

const usageError = (message: string): CliResult => ({
  exitCode: 2,
  stdout: '',
  stderr: JSON.stringify({ code: 'usage_error', message })
})

const runConfigValidate = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  try {
    const configPath = parseConfigPath(args)
    const config = await loadCodeReviewerConfig({
      repositoryRoot: options.cwd,
      environment: options.environment ?? {},
      ...(configPath === undefined ? {} : { configPath })
    })

    return {
      exitCode: 0,
      stdout: createRedactedConfigSummary(config.config),
      stderr: ''
    }
  } catch (error) {
    const normalized = normalizeError(error, { source: 'config' })
    return {
      exitCode: normalized.exitCode,
      stdout: '',
      stderr: JSON.stringify({
        code: 'config_error',
        message: normalized.message
      })
    }
  }
}

const createEvalRunArchiveId = (): string => {
  const now = new Date()
  const padded = (value: number): string => String(value).padStart(2, '0')
  const timestamp = [
    now.getUTCFullYear(),
    padded(now.getUTCMonth() + 1),
    padded(now.getUTCDate()),
    'T',
    padded(now.getUTCHours()),
    padded(now.getUTCMinutes()),
    padded(now.getUTCSeconds())
  ].join('')

  return `${timestamp}-${crypto.randomUUID()}`
}

// Classify errors that reach a command boundary so they map to the documented
// exit codes: configuration/usage/path errors exit 2, filesystem/repository
// errors exit 3. Already-structured errors keep their own category regardless of
// the fallback. Raw `TypeError`s only originate from CLI argument parsing and
// config/path validation, all of which are configuration/usage errors.
const classifyCliErrorSource = (
  error: unknown,
  fallback: ErrorSource
): ErrorSource => {
  if (isZodError(error) || error instanceof TypeError) {
    return 'config'
  }

  if (isFileSystemError(error)) {
    return 'repository'
  }

  return fallback
}

const mapErrorResult = (
  error: unknown,
  fallback: ErrorSource
): CliResult => {
  const normalized = normalizeError(error, {
    source: classifyCliErrorSource(error, fallback)
  })

  return {
    exitCode: normalized.exitCode,
    stdout: '',
    stderr: jsonResult({
      code: normalized.code,
      message: normalized.message
    })
  }
}

const resolveLogSink = async (
  options: CliRunOptions,
  logFile: string | undefined
): Promise<ReviewLogSink | undefined> => {
  if (logFile === undefined) {
    return options.logSink
  }

  const logPath = await resolveArtifactWritePath(options.cwd, logFile)
  await ensureDirectory(path.dirname(logPath))
  // Append a per-run header instead of truncating so earlier runs survive and a
  // failed run's log is not destroyed by the next invocation. The header is a
  // JSON line so the file stays valid JSONL.
  appendFileSync(
    logPath,
    `${JSON.stringify({ event: 'log-run-start', at: new Date().toISOString() })}\n`,
    'utf8'
  )

  return {
    write: (chunk) => {
      appendFileSync(logPath, chunk, 'utf8')
    }
  }
}

// Everything both post-review investigation lanes (spec 12) take from the CLI
// run.
type InvestigationLaneInput = {
  readonly options: CliRunOptions
  readonly config: CodeReviewerConfig
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly admittedFindings: readonly AdmittedFinding[]
  readonly logger: Logger
}

// Both lanes run through the same agent with the same wiring, so the context is
// built once here rather than assembled per lane.
const investigationContextFor = (
  input: InvestigationLaneInput
): InvestigationRunContext => ({
  config: input.config,
  repositoryRoot: input.options.cwd,
  environment: input.environment,
  logger: input.logger,
  ...(input.options.providerImport === undefined
    ? {}
    : { providerImport: input.options.providerImport })
})

// Runs the agentic verification flow after the general review when it is enabled
// (spec 12). It is a separate lane: with verification disabled this returns
// `undefined` and the general review is byte-for-byte unchanged. The flow is
// non-fatal by construction — a missing provider or a failed claim provider
// yields a report (empty, or carrying warnings) rather than throwing.
const runVerificationForReview = async (
  input: InvestigationLaneInput
): Promise<VerificationReport | undefined> => {
  if (!input.config.verification.enabled) {
    return undefined
  }

  const { report, claims } = await runVerificationRun(
    investigationContextFor(input)
  )

  // Cross-witness: a confirmed verdict that lands on a general-review finding
  // raises that finding's confidence (never its severity). Surfaced in the
  // verification report so the "strong finding" signal is visible in output.
  const corroborations = corroborateFindings({
    findings: input.admittedFindings,
    verdicts: report.verdicts,
    claims
  })

  return { ...report, corroborations: [...corroborations] }
}

// Runs the agentic finding investigation-and-fix lane after the general review
// when it is enabled (spec 12). It reuses the same investigation agent as
// verification. With the lane disabled (or no eligible finding / unresolved
// provider) it returns the findings unchanged and no report. It is advisory: it
// only enriches advisory `fixProposal` metadata on `real` findings whose
// apply-check passes, and never changes category, severity, admission, or the gate.
const runFixForReview = async (
  input: InvestigationLaneInput
): Promise<{
  readonly report: VerificationReport | undefined
  readonly findings: readonly AdmittedFinding[]
}> => {
  if (!input.config.fix.enabled) {
    return { report: undefined, findings: input.admittedFindings }
  }

  const { report, findings } = await runFixRun({
    ...investigationContextFor(input),
    admittedFindings: input.admittedFindings
  })

  return { report, findings }
}

const runReview = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  try {
    const logLevelOverride = parseLogLevelOverride(args)
    const logFileOverride = parseLogFileOverride(logLevelOverride.args)
    const reviewArgs = logFileOverride.args
    const configPath = parseConfigPath(reviewArgs)
    const loadedConfig = await loadCodeReviewerConfig({
      repositoryRoot: options.cwd,
      environment: options.environment ?? {},
      ...(configPath === undefined ? {} : { configPath }),
      ...(logLevelOverride.level === undefined
        ? {}
        : {
            cliConfig: {
              observability: {
                logging: {
                  level: logLevelOverride.level
                }
              }
            }
          })
    })
    const explicitFiles = parseExplicitFiles(reviewArgs)
    const baseRef = parseOptionValue(reviewArgs, '--base-ref')
    const headRef = parseOptionValue(reviewArgs, '--head-ref')
    const logSink = await resolveLogSink(options, logFileOverride.logFile)
    const logger = createReviewLogger({
      level: loadedConfig.config.observability.logging.level,
      ...(logSink === undefined ? {} : { out: logSink }),
      bindings: {
        component: 'cli',
        command: 'review'
      }
    })
    const result = await runReviewPipeline({
      repositoryRoot: options.cwd,
      config: loadedConfig.config,
      configWarnings: loadedConfig.warnings,
      baselineExplicitlyConfigured: loadedConfig.baselineExplicitlyConfigured,
      ...(explicitFiles === undefined ? {} : { explicitFiles }),
      ...(baseRef === undefined ? {} : { baseRef }),
      ...(headRef === undefined ? {} : { headRef }),
      environment: loadedConfig.environment,
      logger
    })
    const runArtifactRoot = path.posix.join(
      loadedConfig.config.paths.artifactDir,
      result.report.run.runId
    )
    // The fix lane (spec 12) runs after admission and BEFORE the reporters render,
    // so its apply-checked fixes enrich the admitted findings' `fixProposal` in the
    // report object that every reporter renders. It is advisory: it never changes
    // category, severity, admission, or the quality gate.
    const fixLane = await runFixForReview({
      options,
      config: loadedConfig.config,
      environment: loadedConfig.environment,
      admittedFindings: result.report.admittedFindings,
      logger
    })
    const reportAfterFix =
      fixLane.report === undefined
        ? result.report
        : {
            ...result.report,
            admittedFindings: [...fixLane.findings]
          }
    // The verification flow (spec 12) runs after the general review, in its own
    // lane. Its non-fatal warnings (e.g. a skipped claim provider) are surfaced
    // as run warnings, mirroring the change-intent provider-failure warning.
    const verificationReport = await runVerificationForReview({
      options,
      config: loadedConfig.config,
      environment: loadedConfig.environment,
      admittedFindings: reportAfterFix.admittedFindings,
      logger
    })
    const verificationRunWarnings =
      verificationReport === undefined
        ? []
        : runWarningsForVerificationReport(verificationReport)
    const report =
      verificationRunWarnings.length === 0
        ? reportAfterFix
        : {
            ...reportAfterFix,
            run: {
              ...reportAfterFix.run,
              warnings: [
                ...reportAfterFix.run.warnings,
                ...verificationRunWarnings
              ]
            }
          }

    await writeReviewArtifacts({
      repositoryRoot: options.cwd,
      artifactRoot: runArtifactRoot,
      report,
      contextLedger: result.contextLedger,
      sharedContext: result.sharedContext,
      observability: result.observability,
      config: loadedConfig.config
    })
    if (fixLane.report !== undefined) {
      await writeRunArtifact(
        options.cwd,
        runArtifactRoot,
        'fix-report.json',
        jsonResult(fixLane.report)
      )
    }
    if (verificationReport !== undefined) {
      await writeRunArtifact(
        options.cwd,
        runArtifactRoot,
        'verification-report.json',
        jsonResult(verificationReport)
      )
    }
    await recordRunInIndex({
      repositoryRoot: options.cwd,
      artifactDir: loadedConfig.config.paths.artifactDir,
      entry: {
        runId: report.run.runId,
        startedAt: report.run.startedAt,
        completedAt: report.run.completedAt,
        status: 'completed',
        reportPath: path.posix.join(runArtifactRoot, 'report.json')
      }
    })

    return {
      exitCode:
        report.qualityGate?.passed === false
          ? 1
          : 0,
      stdout: jsonResult({
        runId: report.run.runId,
        qualityGatePassed: report.qualityGate?.passed ?? true,
        artifactDir: runArtifactRoot
      }),
      stderr: ''
    }
  } catch (error) {
    if (isReviewRunFailedError(error)) {
      await writePartialReviewArtifacts({
        repositoryRoot: options.cwd,
        artifactRoot: error.partialState.artifactRoot,
        partialState: error.partialState
      })
      await recordRunInIndex({
        repositoryRoot: options.cwd,
        artifactDir: path.posix.dirname(error.partialState.artifactRoot),
        entry: {
          runId: error.partialState.runSummary.runId,
          startedAt: error.partialState.runSummary.startedAt,
          status: 'failed'
        }
      })

      return {
        exitCode: error.structuredError.exitCode,
        stdout: '',
        stderr: jsonResult({
          code: error.structuredError.code,
          message: error.structuredError.message,
          artifactDir: error.partialState.artifactRoot
        })
      }
    }

    return mapErrorResult(error, 'repository')
  }
}

const resolveBaselineSourceReport = async (
  input: {
    readonly repositoryRoot: string
    readonly artifactDir: string
    readonly explicitReportPath: string | undefined
  }
): Promise<{ readonly reportPath: string; readonly content: string }> => {
  const reportPath =
    input.explicitReportPath ??
    latestRunWithReport(
      parseRunIndex(await readRunIndex(input.repositoryRoot, input.artifactDir))
    )?.reportPath

  if (reportPath === undefined) {
    throw createStructuredError({
      code: 'baseline_source_unavailable',
      message:
        'No completed review report was found to build a baseline from. Run a review first, or pass --report <path>.',
      category: 'repository',
      recoverable: true,
      exitCode: 3,
      details: { artifactDir: input.artifactDir }
    })
  }

  try {
    return {
      reportPath,
      content: await readFile(
        await resolveExistingPathInsideRoot(input.repositoryRoot, reportPath),
        'utf8'
      )
    }
  } catch {
    throw createStructuredError({
      code: 'baseline_source_unavailable',
      message: 'The review report to build a baseline from could not be read.',
      category: 'repository',
      recoverable: true,
      exitCode: 3,
      details: { reportPath }
    })
  }
}

const runBaselineWrite = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  try {
    const configPath = parseConfigPath(args)
    const loadedConfig = await loadCodeReviewerConfig({
      repositoryRoot: options.cwd,
      environment: options.environment ?? {},
      ...(configPath === undefined ? {} : { configPath })
    })
    const source = await resolveBaselineSourceReport({
      repositoryRoot: options.cwd,
      artifactDir: loadedConfig.config.paths.artifactDir,
      explicitReportPath: parseOptionValue(args, '--report')
    })
    const report = JSON.parse(source.content) as {
      readonly admittedFindings?: readonly {
        readonly fingerprints: readonly unknown[]
      }[]
    }
    const entries = buildBaselineEntries(report.admittedFindings ?? [])
    const baselinePath = await resolveArtifactWritePath(
      options.cwd,
      loadedConfig.config.baseline.path
    )

    await ensureDirectory(path.dirname(baselinePath))
    await writeFile(baselinePath, renderBaselineJson(entries))

    return {
      exitCode: 0,
      stdout: jsonResult({
        baselinePath: loadedConfig.config.baseline.path,
        sourceReportPath: source.reportPath,
        entryCount: entries.length
      }),
      stderr: ''
    }
  } catch (error) {
    return mapErrorResult(error, 'repository')
  }
}

const runEval = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  try {
    const logLevelOverride = parseLogLevelOverride(args)
    const logFileOverride = parseLogFileOverride(logLevelOverride.args)
    const evalArgs = logFileOverride.args
    const configPath = parseConfigPath(evalArgs)
    const sliceRoot = parseOptionValue(evalArgs, '--slice-root')
    const caseFilters = parseOptionValues(evalArgs, '--case')
    const reviewMode = parseEnumOption(evalArgs, '--review-mode', [
      'local',
      'ci',
      'pr',
      'full'
    ] as const)
    const reviewDepth = parseEnumOption(evalArgs, '--review-depth', [
      'fast',
      'balanced',
      'thorough'
    ] as const)
    const maxConcurrentTasks = parseIntegerOption(
      evalArgs,
      '--max-concurrent-tasks',
      {
        min: 1,
        max: 32
      }
    )
    const cliConfig = {
      ...(logLevelOverride.level === undefined
        ? {}
        : {
            observability: {
              logging: {
                level: logLevelOverride.level
              }
            }
          }),
      ...(reviewMode === undefined &&
      reviewDepth === undefined &&
      maxConcurrentTasks === undefined
        ? {}
        : {
            review: {
              ...(reviewMode === undefined ? {} : { mode: reviewMode }),
              ...(reviewDepth === undefined ? {} : { depth: reviewDepth }),
              ...(maxConcurrentTasks === undefined
                ? {}
                : { maxConcurrentTasks })
            }
          })
    }
    const loadedConfig = await loadCodeReviewerConfig({
      repositoryRoot: options.cwd,
      environment: options.environment ?? {},
      loadDotEnv: false,
      ...(configPath === undefined ? {} : { configPath }),
      ...(Object.keys(cliConfig).length === 0 ? {} : { cliConfig })
    })
    const logSink = await resolveLogSink(options, logFileOverride.logFile)
    const logger = createReviewLogger({
      level: loadedConfig.config.observability.logging.level,
      ...(logSink === undefined ? {} : { out: logSink }),
      bindings: {
        component: 'cli',
        command: 'eval'
      }
    })
    const loadedEvalCases = await loadEvalCasesFromFixtures(options.cwd, {
      ...(sliceRoot === undefined ? {} : { sliceRoot })
    })
    const evalCases =
      caseFilters.length === 0
        ? loadedEvalCases
        : loadedEvalCases.filter((evalCase) => caseFilters.includes(evalCase.id))

    if (evalCases.length === 0) {
      return usageError('eval run selected no cases')
    }

    // Fail before scoring if any positive slice is still an un-hydrated
    // placeholder; otherwise it would be silently scored as 0 recall.
    assertBenchmarkSlicesHydrated(
      evalCases.map((evalCase) => ({
        id: evalCase.id,
        expectedFindings: evalCase.expectedFindings,
        ...(evalCase.diff === undefined ? {} : { diff: evalCase.diff })
      }))
    )

    // The semantic judge is the only matcher, and the plausibility judge is the
    // independent second opinion on unmatched findings. Both are constructed
    // whenever a provider is available, from the same resolved model alias;
    // scoring a case with expected findings without the match judge fails loudly
    // inside the eval runner instead of falling back to a heuristic.
    const modelAlias =
      loadedConfig.config.provider === undefined
        ? undefined
        : (
            await resolveProviderModelAlias({
              provider: loadedConfig.config.provider,
              environment: loadedConfig.environment,
              logger,
              ...(options.providerImport === undefined
                ? {}
                : { importProvider: options.providerImport })
            })
          ).modelAlias
    const semanticJudge =
      modelAlias === undefined
        ? undefined
        : createModelSemanticJudge({ modelAlias })
    const plausibilityJudge =
      modelAlias === undefined
        ? undefined
        : createModelPlausibilityJudge({ modelAlias })
    // Reads the new-side content of a finding's file from the case's fixture
    // repo, so the plausibility judge sees the same file the reviewer saw.
    // Returns undefined on any read failure; the judge then fails closed.
    const readFindingSource: EvalCaseFileReader = async ({
      evalCase,
      path: findingPath
    }) => {
      try {
        const fixtureRoot = await resolveExistingPathInsideRoot(
          options.cwd,
          evalCase.repositoryFixture
        )

        return await readFile(
          resolvePathInsideRoot(fixtureRoot, findingPath),
          'utf8'
        )
      } catch {
        return undefined
      }
    }

    logger.info('Eval run started.', {
      fixture_source: sliceRoot === undefined ? 'default' : 'slice-root',
      selected_case_count: evalCases.length,
      semantic_judge_available: semanticJudge !== undefined,
      plausibility_judge_available: plausibilityJudge !== undefined
    })

    const evalArtifactRoot = path.posix.join('.codereviewer', 'eval')
    const evalDirectory = await resolveArtifactWritePath(options.cwd, evalArtifactRoot)
    const outputs = await Promise.all(
      evalCases.map((evalCase) =>
        runEvalCase({
          root: options.cwd,
          config: loadedConfig.config,
          configWarnings: loadedConfig.warnings,
          baselineExplicitlyConfigured: loadedConfig.baselineExplicitlyConfigured,
          environment: loadedConfig.environment,
          evalCase,
          logger: logger.child({
            eval_case_id: evalCase.id
          }),
          ...(options.providerImport === undefined
            ? {}
            : { providerImport: options.providerImport })
        })
      )
    )
    const evaluationInput = {
      cases: evalCases,
      outputs,
      ...(semanticJudge === undefined ? {} : { judge: semanticJudge }),
      ...(plausibilityJudge === undefined
        ? {}
        : { plausibilityJudge, readFindingSource }),
      judgeAgreementMinimum: loadedConfig.config.evaluation.minJudgeAgreement,
      logger,
      selection: {
        fixtureSource:
          sliceRoot === undefined
            ? 'default' as const
            : 'slice-root' as const,
        ...(sliceRoot === undefined ? {} : { sliceRoot }),
        caseFilters,
        selectedCaseIds: evalCases.map((evalCase) => evalCase.id)
      },
      thresholds: {
        minParseValidity: 1,
        minRecall: 1,
        maxFalsePositiveCount: 0,
        failOnProviderError: true
      },
      generatedAt: '2026-06-20T00:00:02.000Z'
    }
    const result = await runEvaluation(evaluationInput)

    const evalRunArchiveRoot = path.posix.join(
      evalArtifactRoot,
      'runs',
      createEvalRunArchiveId()
    )
    await ensureDirectory(evalDirectory)
    await ensureDirectory(
      await resolveArtifactWritePath(options.cwd, evalRunArchiveRoot)
    )
    const reportJson = jsonResult(result.report)
    await writeFile(
      await resolveArtifactWritePath(
        options.cwd,
        path.posix.join(evalArtifactRoot, result.artifactName)
      ),
      reportJson
    )
    await writeFile(
      await resolveArtifactWritePath(
        options.cwd,
        path.posix.join(evalRunArchiveRoot, result.artifactName)
      ),
      reportJson
    )
    const summary = renderEvalSummary({
      cases: evalCases,
      report: result.report,
      artifactRoot: evalArtifactRoot
    })

    await writeFile(
      await resolveArtifactWritePath(
        options.cwd,
        path.posix.join(evalArtifactRoot, EVAL_SUMMARY_ARTIFACT_NAME)
      ),
      summary
    )
    await writeFile(
      await resolveArtifactWritePath(
        options.cwd,
        path.posix.join(evalRunArchiveRoot, EVAL_SUMMARY_ARTIFACT_NAME)
      ),
      renderEvalSummary({
        cases: evalCases,
        report: result.report,
        artifactRoot: evalRunArchiveRoot
      })
    )
    const recallReport = renderEvalRecallReport({
      reports: [
        {
          label: result.artifactName,
          report: result.report
        }
      ]
    })

    await writeFile(
      await resolveArtifactWritePath(
        options.cwd,
        path.posix.join(evalArtifactRoot, EVAL_RECALL_REPORT_ARTIFACT_NAME)
      ),
      recallReport
    )
    await writeFile(
      await resolveArtifactWritePath(
        options.cwd,
        path.posix.join(evalRunArchiveRoot, EVAL_RECALL_REPORT_ARTIFACT_NAME)
      ),
      recallReport
    )

    logger.info('Eval run completed.', {
      fixture_count: result.report.fixtureCount,
      recall: result.report.metrics.recall,
      precision: result.report.metrics.precision,
      provider_error_rate: result.report.metrics.providerErrorRate,
      eval_run_archive_root: evalRunArchiveRoot,
      gate_passed: result.report.regressionGate.passed
    })

    return {
      exitCode: result.report.regressionGate.passed ? 0 : 1,
      stdout: `${summary}\n`,
      stderr: ''
    }
  } catch (error) {
    return mapErrorResult(error, 'internal')
  }
}

const runEvalRecallReport = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  const reportPaths = parseOptionValues(args, '--report')
  const selectedReportPaths =
    reportPaths.length === 0
      ? [path.posix.join('.codereviewer', 'eval', 'eval-report.json')]
      : reportPaths

  try {
    const reports = await Promise.all(
      selectedReportPaths.map(async (reportPath) => ({
        label: reportPath,
        report: EvalReportSchema.parse(
          JSON.parse(
            await readFile(
              await resolveExistingPathInsideRoot(options.cwd, reportPath),
              'utf8'
            )
          )
        )
      }))
    )

    return {
      exitCode: 0,
      stdout: `${renderEvalRecallReport({ reports })}\n`,
      stderr: ''
    }
  } catch (error) {
    if (isFileSystemError(error)) {
      return usageError(
        `Eval report not found or unreadable: ${selectedReportPaths.join(', ')}`
      )
    }

    return mapErrorResult(error, 'config')
  }
}

const runEvalCompare = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  try {
    const basePath = parseOptionValue(args, '--base')
    const headPath = parseOptionValue(args, '--head')

    if (basePath === undefined || headPath === undefined) {
      return usageError('eval compare requires --base and --head report paths')
    }

    const baseReport = EvalReportSchema.parse(
      JSON.parse(
        await readFile(
          await resolveExistingPathInsideRoot(options.cwd, basePath),
          'utf8'
        )
      )
    )
    const headReport = EvalReportSchema.parse(
      JSON.parse(
        await readFile(
          await resolveExistingPathInsideRoot(options.cwd, headPath),
          'utf8'
        )
      )
    )

    return {
      exitCode: 0,
      stdout: `${renderEvalComparison({
        base: baseReport,
        head: headReport,
        baseLabel: basePath,
        headLabel: headPath
      })}\n`,
      stderr: ''
    }
  } catch (error) {
    return mapErrorResult(error, 'config')
  }
}

const runEvalSliceManifest = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  try {
    const sliceRoot = parseOptionValue(args, '--slice-root')

    if (sliceRoot === undefined) {
      return usageError('eval slice-manifest requires --slice-root')
    }

    const manifest = await createEvalSliceManifest({
      repositoryRoot: options.cwd,
      sliceRoot
    })

    return {
      exitCode: 0,
      stdout: jsonResult(manifest),
      stderr: ''
    }
  } catch (error) {
    return mapErrorResult(error, 'repository')
  }
}

const runDrift = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  if (args[0] !== 'check') {
    return usageError('Expected command: drift check')
  }

  try {
    const configPath = parseConfigPath(args.slice(1))
    const loadedConfig = await loadCodeReviewerConfig({
      repositoryRoot: options.cwd,
      environment: options.environment ?? {},
      ...(configPath === undefined ? {} : { configPath })
    })
    const result = await runDriftCheck({
      repositoryRoot: options.cwd,
      config: loadedConfig.config
    })

    return {
      exitCode: result.passed ? 0 : 1,
      stdout: jsonResult(result),
      stderr: ''
    }
  } catch (error) {
    return mapErrorResult(error, 'config')
  }
}

export const runCli = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  const [command, subcommand, ...rest] = args

  if (command === 'config' && subcommand === 'validate') {
    return runConfigValidate(rest, options)
  }

  if (command === 'review') {
    return runReview(
      [subcommand, ...rest].filter((value): value is string => value !== undefined),
      options
    )
  }

  if (command === 'eval') {
    if (subcommand === 'run') {
      return runEval(rest, options)
    }

    if (subcommand === 'compare') {
      return runEvalCompare(rest, options)
    }

    if (subcommand === 'recall-report') {
      return runEvalRecallReport(rest, options)
    }

    if (subcommand === 'slice-manifest') {
      return runEvalSliceManifest(rest, options)
    }
  }

  if (command === 'baseline' && subcommand === 'write') {
    return runBaselineWrite(rest, options)
  }

  if (command === 'drift') {
    return runDrift(
      [subcommand, ...rest].filter((value): value is string => value !== undefined),
      options
    )
  }

  return usageError(
    'Expected command: config validate, review, baseline write, eval run, eval compare, eval recall-report, eval slice-manifest, or drift check'
  )
}
