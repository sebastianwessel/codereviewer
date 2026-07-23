import { appendFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  resolveExistingPathInsideRoot,
  resolvePathInsideRoot,
  resolveWritePathInsideRoot
} from '../platform/path-service.js'
import {
  EVAL_RECALL_REPORT_ARTIFACT_NAME,
  EVAL_SUMMARY_ARTIFACT_NAME,
  EvalReportSchema,
  assertBenchmarkSlicesHydrated,
  calculateEvalDiffStats,
  createModelSemanticJudge,
  createEvalSliceManifest,
  type EvalCaseOutput,
  loadEvalCasesFromFixtures,
  renderEvalComparison,
  renderEvalRecallReport,
  renderEvalSummary,
  runEvaluation,
  runEvaluationWithSemanticJudge,
} from '../domains/evaluation/index.js'
import { runDriftCheck } from '../domains/drift/index.js'
import {
  isReviewRunFailedError,
  runReview as runReviewPipeline,
  type PartialReviewRunState
} from '../domains/review-workflow/index.js'
import { parseGitDiffMaps } from '../domains/repository-intake/index.js'
import {
  resolveProviderModelAlias,
  type ProviderImport
} from '../domains/provider-resolution/index.js'
import {
  createReviewLogger,
  type Logger,
  ReviewLogLevelSchema,
  type ReviewLogSink
} from '../domains/observability/index.js'
import {
  latestRunWithReport,
  parseRunIndex,
  renderRunIndexJson,
  renderRunSummaryJson,
  runIndexFileName,
  upsertRunIndexEntry,
  writeReportingArtifacts,
  type RunIndexEntry
} from '../domains/reporting/index.js'
import {
  buildBaselineEntries,
  renderBaselineJson
} from '../domains/admission/index.js'
import {
  runVerificationRun,
  runWarningsForVerificationReport,
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
import type { CodeReviewerConfig } from '../shared/contracts/index.js'

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

const jsonResult = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

const parseConfigPath = (args: readonly string[]): string | undefined => {
  const configIndex = args.indexOf('--config')

  if (configIndex === -1) {
    return undefined
  }

  const configPath = args[configIndex + 1]
  if (
    configPath === undefined ||
    configPath.length === 0 ||
    configPath.startsWith('-')
  ) {
    throw new TypeError('--config requires a path')
  }

  return configPath
}

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

const ensureDirectory = async (directory: string): Promise<void> => {
  await mkdir(directory, { recursive: true })
}

const resolveArtifactWritePath = (
  repositoryRoot: string,
  artifactPath: string
): Promise<string> => resolveWritePathInsideRoot(repositoryRoot, artifactPath)

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

const parseOptionValue = (
  args: readonly string[],
  optionName: string
): string | undefined => {
  const optionIndex = args.indexOf(optionName)

  if (optionIndex === -1) {
    return undefined
  }

  const value = args[optionIndex + 1]
  if (value === undefined || value.length === 0) {
    throw new TypeError(`${optionName} requires a value`)
  }

  return value
}

const parseOptionValues = (
  args: readonly string[],
  optionName: string
): readonly string[] => {
  const values: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== optionName) {
      continue
    }

    const value = args[index + 1]
    if (
      value === undefined ||
      value.length === 0 ||
      value.startsWith('-')
    ) {
      throw new TypeError(`${optionName} requires a value`)
    }

    values.push(value)
    index += 1
  }

  return values
}

const parseIntegerOption = (
  args: readonly string[],
  optionName: string,
  input: {
    readonly min: number
    readonly max: number
  }
): number | undefined => {
  const value = parseOptionValue(args, optionName)

  if (value === undefined) {
    return undefined
  }

  if (value.startsWith('-')) {
    throw new TypeError(`${optionName} requires a value`)
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < input.min || parsed > input.max) {
    throw new TypeError(
      `${optionName} must be an integer from ${input.min} to ${input.max}`
    )
  }

  return parsed
}

const parseEnumOption = <T extends string>(
  args: readonly string[],
  optionName: string,
  allowedValues: readonly T[]
): T | undefined => {
  const value = parseOptionValue(args, optionName)

  if (value === undefined) {
    return undefined
  }

  if (value.startsWith('-') || !allowedValues.includes(value as T)) {
    throw new TypeError(
      `${optionName} must be one of ${allowedValues.join(', ')}`
    )
  }

  return value as T
}

const parseLogLevelOverride = (
  args: readonly string[]
): { readonly level?: string; readonly args: readonly string[] } => {
  if (args.includes('--debug')) {
    return {
      level: 'debug',
      args: args.filter((arg) => arg !== '--debug')
    }
  }

  const logLevelIndex = args.indexOf('--log-level')
  if (logLevelIndex === -1) {
    return {
      args
    }
  }

  const value = args[logLevelIndex + 1]
  if (value === undefined || value.length === 0 || value.startsWith('-')) {
    throw new TypeError('--log-level requires a value')
  }

  return {
    level: ReviewLogLevelSchema.parse(value),
    args: args.filter(
      (_arg, index) => index !== logLevelIndex && index !== logLevelIndex + 1
    )
  }
}

const parseLogFileOverride = (
  args: readonly string[]
): { readonly logFile?: string; readonly args: readonly string[] } => {
  const logFileIndex = args.indexOf('--log-file')
  if (logFileIndex === -1) {
    return {
      args
    }
  }

  const value = args[logFileIndex + 1]
  if (value === undefined || value.length === 0 || value.startsWith('-')) {
    throw new TypeError('--log-file requires a path')
  }

  return {
    logFile: value,
    args: args.filter(
      (_arg, index) => index !== logFileIndex && index !== logFileIndex + 1
    )
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

const parseExplicitFiles = (args: readonly string[]): readonly string[] | undefined => {
  const files: string[] = []

  for (const [index, value] of args.entries()) {
    if (value === '--file') {
      const file = args[index + 1]
      if (file === undefined || file.length === 0) {
        throw new TypeError('--file requires a path')
      }
      files.push(file)
    }
  }

  const filesValue = parseOptionValue(args, '--files')
  if (filesValue !== undefined) {
    files.push(
      ...filesValue
        .split(',')
        .map((file) => file.trim())
        .filter((file) => file.length > 0)
    )
  }

  return files.length === 0 ? undefined : files
}

const writeRunArtifact = async (
  repositoryRoot: string,
  artifactRoot: string,
  name: string,
  content: string
): Promise<void> => {
  await writeFile(
    await resolveArtifactWritePath(
      repositoryRoot,
      path.posix.join(artifactRoot, name)
    ),
    content
  )
}

const readRunIndex = async (
  repositoryRoot: string,
  artifactDir: string
): Promise<string | undefined> => {
  try {
    return await readFile(
      await resolveExistingPathInsideRoot(
        repositoryRoot,
        path.posix.join(artifactDir, runIndexFileName)
      ),
      'utf8'
    )
  } catch {
    return undefined
  }
}

// Run directories are otherwise opaque and unenumerated, so nothing downstream
// can find the newest report. The index is bookkeeping: a failure to record a
// run must never fail a review that already produced its artifacts.
const recordRunInIndex = async (
  input: {
    readonly repositoryRoot: string
    readonly artifactDir: string
    readonly entry: RunIndexEntry
  }
): Promise<void> => {
  try {
    const index = parseRunIndex(
      await readRunIndex(input.repositoryRoot, input.artifactDir)
    )
    const indexPath = await resolveArtifactWritePath(
      input.repositoryRoot,
      path.posix.join(input.artifactDir, runIndexFileName)
    )

    await ensureDirectory(path.dirname(indexPath))
    await writeFile(
      indexPath,
      renderRunIndexJson(upsertRunIndexEntry(index, input.entry))
    )
  } catch {
    // Bookkeeping only; the run's own artifacts are already durable.
  }
}

const writeReviewArtifacts = async (
  input: {
    readonly repositoryRoot: string
    readonly artifactRoot: string
    readonly report: Awaited<ReturnType<typeof runReviewPipeline>>['report']
    readonly contextLedger: Awaited<ReturnType<typeof runReviewPipeline>>['contextLedger']
    readonly sharedContext: Awaited<ReturnType<typeof runReviewPipeline>>['sharedContext']
    readonly observability: Awaited<ReturnType<typeof runReviewPipeline>>['observability']
    readonly config: CodeReviewerConfig
  }
): Promise<void> => {
  const runDirectory = await resolveArtifactWritePath(
    input.repositoryRoot,
    input.artifactRoot
  )
  await ensureDirectory(runDirectory)
  await writeReportingArtifacts({
    report: input.report,
    formats: input.config.reporting.formats,
    sarif: input.config.reporting.sarif,
    writer: (artifactPath, content) =>
      writeRunArtifact(
        input.repositoryRoot,
        input.artifactRoot,
        artifactPath,
        content
      )
  })
  await writeRunArtifact(
    input.repositoryRoot,
    input.artifactRoot,
    'run-summary.json',
    renderRunSummaryJson(input.report.run)
  )
  await writeRunArtifact(
    input.repositoryRoot,
    input.artifactRoot,
    'context-ledger.json',
    jsonResult(input.contextLedger)
  )
  await writeRunArtifact(
    input.repositoryRoot,
    input.artifactRoot,
    'shared-context.json',
    jsonResult(input.sharedContext)
  )
  await writeRunArtifact(
    input.repositoryRoot,
    input.artifactRoot,
    'observability.json',
    jsonResult(input.observability)
  )
}

const writePartialReviewArtifacts = async (
  input: {
    readonly repositoryRoot: string
    readonly artifactRoot: string
    readonly partialState: PartialReviewRunState
  }
): Promise<void> => {
  const runDirectory = await resolveArtifactWritePath(
    input.repositoryRoot,
    input.artifactRoot
  )
  await ensureDirectory(runDirectory)
  await writeRunArtifact(
    input.repositoryRoot,
    input.artifactRoot,
    'run-summary.json',
    renderRunSummaryJson(input.partialState.runSummary)
  )
  await writeRunArtifact(
    input.repositoryRoot,
    input.artifactRoot,
    'context-ledger.json',
    jsonResult(input.partialState.contextLedger)
  )
  await writeRunArtifact(
    input.repositoryRoot,
    input.artifactRoot,
    'shared-context.json',
    jsonResult(input.partialState.sharedContext)
  )
  await writeRunArtifact(
    input.repositoryRoot,
    input.artifactRoot,
    'observability.json',
    jsonResult(input.partialState.observability)
  )
  await writeRunArtifact(
    input.repositoryRoot,
    input.artifactRoot,
    'error.json',
    jsonResult({
      code: input.partialState.error.code,
      message: input.partialState.error.message,
      category: input.partialState.error.category,
      recoverable: input.partialState.error.recoverable
    })
  )
}

// Runs the agentic verification flow after the general review when it is enabled
// (spec 12). It is a separate lane: with verification disabled this returns
// `undefined` and the general review is byte-for-byte unchanged. The flow is
// non-fatal by construction — a missing provider or a failed claim provider
// yields a report (empty, or carrying warnings) rather than throwing.
const runVerificationForReview = async (
  input: {
    readonly options: CliRunOptions
    readonly config: CodeReviewerConfig
    readonly environment: Readonly<Record<string, string | undefined>>
    readonly logger: Logger
  }
): Promise<VerificationReport | undefined> => {
  if (!input.config.verification.enabled) {
    return undefined
  }

  const { report } = await runVerificationRun({
    config: input.config,
    repositoryRoot: input.options.cwd,
    environment: input.environment,
    logger: input.logger,
    ...(input.options.providerImport === undefined
      ? {}
      : { providerImport: input.options.providerImport })
  })

  return report
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
    // The verification flow (spec 12) runs after the general review, in its own
    // lane. Its non-fatal warnings (e.g. a skipped claim provider) are surfaced
    // as run warnings, mirroring the change-intent provider-failure warning.
    const verificationReport = await runVerificationForReview({
      options,
      config: loadedConfig.config,
      environment: loadedConfig.environment,
      logger
    })
    const verificationRunWarnings =
      verificationReport === undefined
        ? []
        : runWarningsForVerificationReport(verificationReport)
    const report =
      verificationRunWarnings.length === 0
        ? result.report
        : {
            ...result.report,
            run: {
              ...result.report.run,
              warnings: [
                ...result.report.run.warnings,
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

const countChangedLines = async (
  repositoryRoot: string,
  changedFiles: readonly string[]
): Promise<number> => {
  const counts = await Promise.all(
    changedFiles.map(async (changedFile) => {
      const content = await readFile(
        resolvePathInsideRoot(repositoryRoot, changedFile),
        'utf8'
      )

      return content.split(/\r?\n/u).filter((line) => line.length > 0).length
    })
  )

  return counts.reduce((total, count) => total + count, 0)
}

const calculateEvalCaseSize = async (
  input: {
    readonly fixtureRoot: string
    readonly evalCase: Awaited<ReturnType<typeof loadEvalCasesFromFixtures>>[number]
  }
): Promise<{ readonly changedLineCount: number; readonly diffHunkCount: number }> => {
  if (input.evalCase.diff !== undefined) {
    return calculateEvalDiffStats(input.evalCase.diff)
  }

  return {
    changedLineCount: await countChangedLines(
      input.fixtureRoot,
      input.evalCase.changedFiles
    ),
    diffHunkCount: input.evalCase.changedFiles.length
  }
}

// Carry the failing stage (normalized as `details.operation`) onto a hard
// provider-error output so it is not dropped before scoring.
const stageFromNormalizedError = (
  normalized: ReturnType<typeof normalizeError>
): string | undefined => {
  const operation = normalized.details.operation

  return typeof operation === 'string' && operation.length > 0
    ? operation
    : undefined
}

const runEvalCase = async (
  input: {
    readonly root: string
    readonly config: Awaited<ReturnType<typeof loadCodeReviewerConfig>>['config']
    readonly configWarnings: readonly string[]
    readonly baselineExplicitlyConfigured: boolean
    readonly environment: Readonly<Record<string, string | undefined>>
    readonly evalCase: Awaited<ReturnType<typeof loadEvalCasesFromFixtures>>[number]
    readonly logger?: Logger
    readonly providerImport?: ProviderImport
  }
): Promise<EvalCaseOutput> => {
  const fixtureRoot = await resolveExistingPathInsideRoot(
    input.root,
    input.evalCase.repositoryFixture
  )
  const evalCaseSize = await calculateEvalCaseSize({
    fixtureRoot,
    evalCase: input.evalCase
  })

  const runReviewForCase = async (
    config: CodeReviewerConfig
  ): Promise<Awaited<ReturnType<typeof runReviewPipeline>>> =>
    runReviewPipeline({
      repositoryRoot: fixtureRoot,
      config,
      configWarnings: input.configWarnings,
      baselineExplicitlyConfigured: input.baselineExplicitlyConfigured,
      explicitFiles: input.evalCase.changedFiles,
      ...(input.evalCase.diff === undefined
        ? {}
        : {
            reviewDiffMaps: parseGitDiffMaps(input.evalCase.diff),
            reviewRawDiff: input.evalCase.diff
          }),
      ...(input.evalCase.baseRef === undefined
        ? {}
        : { baseRef: input.evalCase.baseRef }),
      ...(input.evalCase.headRef === undefined
        ? {}
        : { headRef: input.evalCase.headRef }),
      environment: input.environment,
      ...(input.logger === undefined ? {} : { logger: input.logger }),
      ...(input.providerImport === undefined
        ? {}
        : { providerImport: input.providerImport })
    })

  const retryConfigForTransientProviderError = (): CodeReviewerConfig => ({
    ...input.config,
    review: {
      ...input.config.review,
      maxConcurrentTasks: 1
    }
  })

  const retryableEvalProviderCodes = new Set([
    'provider_error',
    'provider_timeout'
  ])

  const resultForReviewReport = (
    reviewResult: Awaited<ReturnType<typeof runReviewPipeline>>
  ): EvalCaseOutput => ({
    caseId: input.evalCase.id,
    changedLineCount: evalCaseSize.changedLineCount,
    diffHunkCount: evalCaseSize.diffHunkCount,
    contextLedger: reviewResult.contextLedger.map((entry) => ({
      kind: entry.kind,
      consideredForModelContext: entry.decision === 'included' || entry.decision === 'truncated',
      truncated: entry.decision === 'truncated'
    })),
    result: {
      status: 'ok',
      reviewReport: reviewResult.report
    }
  })

  try {
    return resultForReviewReport(await runReviewForCase(input.config))
  } catch (error) {
    const normalized = normalizeError(error, { source: 'provider' })

    if (normalized.category !== 'provider') {
      throw error
    }

    if (
      retryableEvalProviderCodes.has(normalized.code) &&
      input.config.review.maxConcurrentTasks > 1
    ) {
      input.logger?.info('Retrying eval case after transient provider error.', {
        eval_case_id: input.evalCase.id,
        code: normalized.code,
        retry_max_concurrent_tasks: 1
      })

      try {
        const retryResult = await runReviewForCase(
          retryConfigForTransientProviderError()
        )

        return resultForReviewReport({
          ...retryResult,
          report: {
            ...retryResult.report,
            run: {
              ...retryResult.report.run,
              warnings: [
                ...retryResult.report.run.warnings,
                `eval-provider-retry:${normalized.code}`
              ]
            }
          }
        })
      } catch (retryError) {
        const retryNormalized = normalizeError(retryError, {
          source: 'provider'
        })

        if (retryNormalized.category !== 'provider') {
          throw retryError
        }

        return {
          caseId: input.evalCase.id,
          changedLineCount: evalCaseSize.changedLineCount,
          diffHunkCount: evalCaseSize.diffHunkCount,
          contextLedger: [],
          result: {
            status: 'provider-error',
            code: retryNormalized.code,
            ...(stageFromNormalizedError(retryNormalized) === undefined
              ? {}
              : { stage: stageFromNormalizedError(retryNormalized)! }),
            message: retryNormalized.message
          }
        }
      }
    }

    return {
      caseId: input.evalCase.id,
      changedLineCount: evalCaseSize.changedLineCount,
      diffHunkCount: evalCaseSize.diffHunkCount,
      contextLedger: [],
      result: {
        status: 'provider-error',
        code: normalized.code,
        ...(stageFromNormalizedError(normalized) === undefined
          ? {}
          : { stage: stageFromNormalizedError(normalized)! }),
        message: normalized.message
      }
    }
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
    const semanticJudgeEnabled = evalArgs.includes('--semantic-judge')
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

    if (semanticJudgeEnabled && loadedConfig.config.provider === undefined) {
      return usageError('eval run --semantic-judge requires provider configuration')
    }

    logger.info('Eval run started.', {
      fixture_source: sliceRoot === undefined ? 'default' : 'slice-root',
      selected_case_count: evalCases.length,
      semantic_judge_enabled: semanticJudgeEnabled
    })
    const semanticJudge =
      semanticJudgeEnabled && loadedConfig.config.provider !== undefined
        ? createModelSemanticJudge({
            modelAlias: (
              await resolveProviderModelAlias({
                provider: loadedConfig.config.provider,
                environment: loadedConfig.environment,
                logger,
                ...(options.providerImport === undefined
                  ? {}
                  : { importProvider: options.providerImport })
              })
            ).modelAlias
          })
        : undefined

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
    const result =
      semanticJudge === undefined
        ? runEvaluation(evaluationInput)
        : await runEvaluationWithSemanticJudge({
            ...evaluationInput,
            judge: semanticJudge
          })

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
