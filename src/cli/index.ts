import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  createProviderUsageRecorder,
  summarizeRunCost
} from '../domains/costs/index.js'
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
  stableJsonDigest,
  type EvalCaseFileReader,
  type EvalRegressionThresholds,
  type EvalReport,
} from '../domains/evaluation/index.js'
import {
  renderChangeImpactMarkdown,
  runChangeImpact
} from '../domains/change-impact/index.js'
import {
  createIntentFulfilmentLane,
  runIntentFulfilment
} from '../domains/intent-fulfilment/index.js'
import {
  createConformanceAdjudicationLane,
  runInvariantConformance
} from '../domains/invariant-conformance/index.js'
import { createContextRetriever } from '../domains/context-retrieval/index.js'
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
import {
  EvalRegressionGateProfileSchema,
  ReviewDepthSchema,
  ReviewModeSchema,
  maxConcurrentTasksBounds,
  type AdmittedFinding,
  type CodeReviewerConfig
} from '../shared/contracts/index.js'
import {
  parseConfigPath,
  unknownCliOption,
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
  IMPACT_MARKDOWN_ARTIFACT_NAME,
  jsonResult,
  readRunIndex,
  recordRunInIndex,
  resolveArtifactWritePath,
  writeChangeImpactArtifacts,
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
  // Wall clock used to stamp `generatedAt` on eval reports. Defaults to the
  // real clock in production; tests inject a fixed function so a saved report
  // stays byte-for-byte reproducible without reaching into `Date` deep inside
  // the eval pipeline (the eval runner itself falls back to `new Date()` when
  // no `generatedAt` is supplied at all, so this stays a thin seam rather than
  // a second source of truth for the clock).
  readonly now?: () => Date
  // Monotonic clock used to measure `metrics.elapsedMs` on eval reports: the
  // WHOLE run's wall-clock time (per-case review execution plus judge/
  // plausibility scoring), as opposed to `metrics.durationMs`, which only sums
  // each case's own review time. Deliberately a separate seam from `now`
  // above: `now` stamps a point in time (`generatedAt`), this measures a
  // monotonic duration, and `Date.now()` is not monotonic (it can jump on a
  // clock adjustment), so the two must never share one clock. Defaults to
  // `performance.now` in production; tests inject a deterministic function so
  // a saved report stays byte-for-byte reproducible.
  readonly monotonicNow?: () => number
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
  const unrecognized = unknownCliOption(args, [])

  if (unrecognized !== undefined) {
    return usageError(`Unknown option ${unrecognized}`)
  }

  try {
    const config = await loadConfigForCommand(args, options)

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

// `eval run`'s regression-gate thresholds, resolved from the `stable`/`strict`
// profile plus config overrides plus one CLI override (spec 06, "Eval
// Regression Gate"). `stable` deliberately gates on only two signals:
//
// - `minParseValidity: 1` — every eval output either validates against the
//   review-report schema or it does not. There is no sampling distribution
//   here to be flaky about.
// - `failOnProviderError: true` — a provider call either errored or it did
//   not. Same reasoning: mechanical, not statistical.
//
// It deliberately does NOT default-gate on `minRecall`, `minProductRecall`, or
// `maxFalsePositiveCount`. Recall is a MEAN over a model-backed, non-
// deterministic run: this project's own measurement found a run-to-run
// standard deviation of several percentage points on the primary corpus
// (repeated runs of one identical configuration; see "Metrics" in
// specs/06-evaluation-and-quality-gates.md). A default gate that thresholds on
// mean recall would fail unpredictably depending on which side of that band a
// given run landed on — which is a WORSE default than the gate this replaces,
// because at least the old gate failed every time for the same reason instead
// of flaking. `maxFalsePositiveCount` has the same problem from a different
// angle: it counts every unmatched admitted finding RAW, including real
// defects a fixture's expected-findings list simply never enumerated (this
// project measured raw precision as low as 44% on a corpus later shown to be
// ~83% precise once judged against actual code rather than the fixture's
// possibly-incomplete list). Gating on the raw count by default would recreate
// exactly the "exits non-zero on essentially every run" failure mode this
// change exists to fix. Both remain available to opt into explicitly, via
// `evaluation.regressionGate.overrides` or the `strict` profile, for a
// maintainer who has verified they hold for their own fixture set.
const STABLE_EVAL_REGRESSION_GATE_THRESHOLDS: EvalRegressionThresholds = {
  minParseValidity: 1,
  failOnProviderError: true
}

// `strict` is the gate this change replaces as the default: perfect recall and
// zero tolerated false positives. Kept as an explicit, named opt-in rather than
// deleted, since a maintainer preparing an actual release cut may want exactly
// this all-or-nothing bar rather than the CI-smoke-test-shaped `stable` gate.
const STRICT_EVAL_REGRESSION_GATE_THRESHOLDS: EvalRegressionThresholds = {
  minParseValidity: 1,
  minRecall: 1,
  maxFalsePositiveCount: 0,
  failOnProviderError: true
}

// The CLI `--gate-profile` flag is folded into `cliConfig.evaluation` before
// `loadCodeReviewerConfig` runs (same seam `--review-mode`/`--review-depth`
// use), so by the time this reads `config.evaluation.regressionGate` it
// already reflects config file, environment, and CLI precedence in the
// project's usual order — there is no separate override parameter to track
// here.
const resolveEvalRegressionGateThresholds = (
  config: CodeReviewerConfig
): EvalRegressionThresholds => {
  const profileThresholds =
    config.evaluation.regressionGate.profile === 'strict'
      ? STRICT_EVAL_REGRESSION_GATE_THRESHOLDS
      : STABLE_EVAL_REGRESSION_GATE_THRESHOLDS

  return {
    ...profileThresholds,
    ...config.evaluation.regressionGate.overrides,
    // Restated explicitly: both profiles always set `failOnProviderError`, but
    // the config-schema override for it is optional (absent, not `undefined`,
    // when a project does not set it), and that optionality otherwise widens
    // the spread's inferred type to `boolean | undefined` even though the
    // fallback below makes the runtime value always defined.
    failOnProviderError:
      config.evaluation.regressionGate.overrides.failOnProviderError ??
      profileThresholds.failOnProviderError
  }
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

type LoadedCodeReviewerConfig = Awaited<ReturnType<typeof loadCodeReviewerConfig>>

// Every command resolves configuration identically: `--config` when given, the
// discovered file otherwise, always against the process environment. `overrides`
// carries the few command-specific inputs (`cliConfig`, `loadDotEnv`); it is
// spread BEFORE `configPath` so an override can never displace the explicit
// `--config` the user passed.
const loadConfigForCommand = async (
  args: readonly string[],
  options: CliRunOptions,
  overrides: Omit<
    Parameters<typeof loadCodeReviewerConfig>[0],
    'repositoryRoot' | 'environment' | 'configPath'
  > = {}
): Promise<LoadedCodeReviewerConfig> => {
  const configPath = parseConfigPath(args)

  return loadCodeReviewerConfig({
    repositoryRoot: options.cwd,
    environment: options.environment ?? {},
    ...overrides,
    ...(configPath === undefined ? {} : { configPath })
  })
}

const createCliLogger = (
  input: {
    readonly config: CodeReviewerConfig
    readonly command: string
    readonly sink: ReviewLogSink | undefined
  }
): Logger =>
  createReviewLogger({
    level: input.config.observability.logging.level,
    ...(input.sink === undefined ? {} : { out: input.sink }),
    bindings: {
      component: 'cli',
      command: input.command
    }
  })

// Reads one repository file through the mediated retriever, which is the only
// filesystem seam these commands get: path containment, symlink-realpath
// re-checking, the eligibility gate and redaction all apply. An ineligible,
// missing, or over-budget file is skipped and counted; one unreadable file must
// not fail the whole report.
const mediatedFileReader =
  (retriever: ReturnType<typeof createContextRetriever>) =>
  async (filePath: string): Promise<string | undefined> => {
    try {
      return (await retriever.readRepositoryFile({ path: filePath })).content
    } catch {
      return undefined
    }
  }

// What a check command may put in front of the reader on top of the default
// presentation, which is the report as pretty JSON on stdout and an empty stderr.
// An absent field keeps that default, so a stage that renders nothing extra needs
// to say nothing.
type CheckCommandPresentation = {
  readonly stdout?: string
  readonly stderr?: string
}

// Presentation runs AFTER the report exists and must never decide whether the
// command succeeded. Rendering a document or writing an artifact is a courtesy to
// the reader; failing an advisory stage because a file could not be written would
// turn "we could not show you this nicely" into "your pipeline is broken", and
// spec 22 makes exiting 0 a requirement rather than a default. So a presentation
// failure degrades to the default JSON output plus a line saying what was lost.
const presentCheckReport = async <TReport>(
  present: ((report: TReport) => Promise<CheckCommandPresentation>) | undefined,
  report: TReport
): Promise<CheckCommandPresentation> => {
  if (present === undefined) {
    return {}
  }

  try {
    return await present(report)
  } catch (error) {
    return {
      stderr: `Could not render or write the report artifacts: ${normalizeError(error, { source: 'report' }).message}\n`
    }
  }
}

// `impact check`, `intent check` and `conformance check` are three independently
// runnable ADVISORY stages that share one shape: they accept the two git refs,
// require the `check` subcommand, load configuration in a scope of its own so a
// malformed config file exits 2 as a config error rather than being swept into
// the repository fallback the rest of the command needs for git failures, and
// then print a report as JSON with exit code 0 WHATEVER the report says. Only the
// report body and its presentation differ, so the skeleton is written once here —
// a fourth advisory stage cannot accidentally acquire the ability to fail a
// pipeline.
const runCheckCommand = async <TReport>(
  input: {
    readonly name: string
    readonly args: readonly string[]
    readonly options: CliRunOptions
    // Options this stage accepts beyond the two git refs every check takes. The
    // sets stay per-command rather than pooled into one permissive union, so a
    // flag one stage implements is still unknown to the others.
    readonly commandOptions?: readonly string[]
    readonly report: (context: {
      readonly loadedConfig: LoadedCodeReviewerConfig
      readonly baseRef: string | undefined
      readonly headRef: string | undefined
    }) => Promise<TReport>
    readonly present?: (
      report: TReport,
      context: { readonly loadedConfig: LoadedCodeReviewerConfig }
    ) => Promise<CheckCommandPresentation>
  }
): Promise<CliResult> => {
  const unrecognized = unknownCliOption(input.args, [
    '--base-ref',
    '--head-ref',
    ...(input.commandOptions ?? [])
  ])

  if (unrecognized !== undefined) {
    return usageError(`Unknown option ${unrecognized}`)
  }

  if (input.args[0] !== 'check') {
    return usageError(`Expected command: ${input.name} check`)
  }

  const checkArgs = input.args.slice(1)
  let loadedConfig: LoadedCodeReviewerConfig

  try {
    loadedConfig = await loadConfigForCommand(checkArgs, input.options)
  } catch (error) {
    return mapErrorResult(error, 'config')
  }

  try {
    const report = await input.report({
      loadedConfig,
      baseRef: parseOptionValue(checkArgs, '--base-ref'),
      headRef: parseOptionValue(checkArgs, '--head-ref')
    })
    const present = input.present
    const presentation = await presentCheckReport(
      present === undefined
        ? undefined
        : (presented: TReport) => present(presented, { loadedConfig }),
      report
    )

    return {
      exitCode: 0,
      stdout: presentation.stdout ?? jsonResult(report),
      stderr: presentation.stderr ?? ''
    }
  } catch (error) {
    return mapErrorResult(error, 'repository')
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
  const unrecognized = unknownCliOption(args, ['--base-ref', '--head-ref', '--file', '--files'])

  if (unrecognized !== undefined) {
    return usageError(`Unknown option ${unrecognized}`)
  }

  try {
    const logLevelOverride = parseLogLevelOverride(args)
    const logFileOverride = parseLogFileOverride(logLevelOverride.args)
    const reviewArgs = logFileOverride.args
    const loadedConfig = await loadConfigForCommand(reviewArgs, options, {
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
    const logger = createCliLogger({
      config: loadedConfig.config,
      command: 'review',
      sink: await resolveLogSink(options, logFileOverride.logFile)
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
      logger,
      ...(options.providerImport === undefined
        ? {}
        : { providerImport: options.providerImport })
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
  const unrecognized = unknownCliOption(args, ['--report'])

  if (unrecognized !== undefined) {
    return usageError(`Unknown option ${unrecognized}`)
  }

  try {
    const loadedConfig = await loadConfigForCommand(args, options)
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
  const unrecognized = unknownCliOption(args, ['--case', '--gate-profile', '--max-concurrent-tasks', '--review-depth', '--review-mode', '--slice-root'])

  if (unrecognized !== undefined) {
    return usageError(`Unknown option ${unrecognized}`)
  }

  // Captured before ANYTHING else so `metrics.elapsedMs` reflects the whole
  // run: fixture loading, every case's review execution (which happens in the
  // `runEvalCase` calls below, entirely outside `runEvaluation`), and the
  // judge/plausibility scoring `runEvaluation` performs. `metrics.durationMs`
  // only sums each case's own review time and cannot be compared to how long
  // the run actually took, which is exactly the gap this timer closes.
  const monotonicNow = options.monotonicNow ?? ((): number => performance.now())
  const evaluationStartedAtMs = monotonicNow()
  try {
    const logLevelOverride = parseLogLevelOverride(args)
    const logFileOverride = parseLogFileOverride(logLevelOverride.args)
    const evalArgs = logFileOverride.args
    const sliceRoot = parseOptionValue(evalArgs, '--slice-root')
    const caseFilters = parseOptionValues(evalArgs, '--case')
    // Every accepted value below comes from the config schema that will validate
    // it moments later, so a flag can never accept a value the config rejects.
    const reviewMode = parseEnumOption(
      evalArgs,
      '--review-mode',
      ReviewModeSchema.options
    )
    const reviewDepth = parseEnumOption(
      evalArgs,
      '--review-depth',
      ReviewDepthSchema.options
    )
    const maxConcurrentTasks = parseIntegerOption(
      evalArgs,
      '--max-concurrent-tasks',
      maxConcurrentTasksBounds
    )
    // Overrides `evaluation.regressionGate.profile` for this run only, without
    // touching the committed config's default. See the `stable`/`strict`
    // rationale on `resolveEvalRegressionGateThresholds` below.
    const gateProfile = parseEnumOption(
      evalArgs,
      '--gate-profile',
      EvalRegressionGateProfileSchema.options
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
          }),
      ...(gateProfile === undefined
        ? {}
        : { evaluation: { regressionGate: { profile: gateProfile } } })
    }
    const loadedConfig = await loadConfigForCommand(evalArgs, options, {
      loadDotEnv: false,
      ...(Object.keys(cliConfig).length === 0 ? {} : { cliConfig })
    })
    const logger = createCliLogger({
      config: loadedConfig.config,
      command: 'eval',
      sink: await resolveLogSink(options, logFileOverride.logFile)
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
    // Same resolved provider config the judge model alias above came from;
    // kept alongside it (rather than re-reading `loadedConfig.config.provider`
    // later) so the cost reader below can price judge usage without a
    // redundant undefined check.
    const providerConfig = loadedConfig.config.provider
    // Wraps the judge model alias in the SAME usage-recorder mechanism the
    // review path uses (`createProviderUsageRecorder`; see
    // `run/provider/provider-workflow.ts`), so every provider call the
    // semantic-match judge and the plausibility judge make -- both matching
    // AND their calibration passes inside `runEvaluation` -- is captured. This
    // spend used to be counted nowhere: judge calls are real provider calls,
    // but neither judge factory reads `response.usage`. One recorder is shared
    // by both judges (they are the same model), so `scoringUsageRecorder`
    // below reports their COMBINED spend rather than inventing a second,
    // per-judge accounting path.
    const scoringUsageRecorder =
      modelAlias === undefined
        ? undefined
        : createProviderUsageRecorder(modelAlias)
    const semanticJudge =
      scoringUsageRecorder === undefined
        ? undefined
        : createModelSemanticJudge({ modelAlias: scoringUsageRecorder.modelAlias })
    const plausibilityJudge =
      scoringUsageRecorder === undefined
        ? undefined
        : createModelPlausibilityJudge({
            modelAlias: scoringUsageRecorder.modelAlias
          })
    // Reads the FINAL judge + plausibility-judge spend, priced with the SAME
    // `summarizeRunCost` helper that prices review cost. A thunk (not called
    // here) because the recorder keeps accumulating until `runEvaluation`
    // finishes matching and calibration; `runEvaluation` calls this only once,
    // at the very end.
    const evaluationScoringCost =
      scoringUsageRecorder === undefined || providerConfig === undefined
        ? undefined
        : () =>
            summarizeRunCost({
              providerConfigured: true,
              providerId: providerConfig.id,
              modelName: providerConfig.model,
              prices: loadedConfig.config.costs,
              usage: scoringUsageRecorder.usage()
            })
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
      thresholds: resolveEvalRegressionGateThresholds(loadedConfig.config),
      // Production runs stamp the real time; a test passes `options.now` to
      // keep a saved report byte-for-byte reproducible (fix for the eval
      // report's `generatedAt` being frozen to a literal committed timestamp).
      generatedAt: (options.now ?? ((): Date => new Date()))().toISOString(),
      ...(evaluationScoringCost === undefined
        ? {}
        : { evaluationScoringCost }),
      // A thunk closed over the monotonic start captured before this function
      // did anything, so `runEvaluation` measures the WHOLE run (case review
      // execution above, plus its own judge/plausibility scoring) instead of
      // only the time spent inside `runEvaluation` itself.
      evaluationElapsedMs: () => monotonicNow() - evaluationStartedAtMs,
      // Provenance the eval domain cannot derive on its own (it does not import
      // the configuration or provider-resolution domains): the effective,
      // fully-merged config this invocation resolved -- file + environment +
      // the CLI-only overrides (`--review-mode`, `--gate-profile`, etc.) folded
      // in above -- hashed with the SAME canonical digest the answer-key digest
      // uses, plus the provider/model identity the judge itself was built
      // from. `answerKeyDigest` is computed inside `runEvaluation` from the
      // selected cases, so it is not supplied here.
      provenance: {
        configHash: stableJsonDigest(loadedConfig.config),
        ...(providerConfig === undefined
          ? {}
          : { providerId: providerConfig.id, modelName: providerConfig.model }
        )
      }
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

// Reads a saved eval report and validates it against the contract. Both readers
// below go through this so a malformed or foreign JSON file is rejected by the
// schema rather than rendered as a report with missing metrics.
const readEvalReport = async (
  repositoryRoot: string,
  reportPath: string
): Promise<EvalReport> =>
  EvalReportSchema.parse(
    JSON.parse(
      await readFile(
        await resolveExistingPathInsideRoot(repositoryRoot, reportPath),
        'utf8'
      )
    )
  )

const runEvalRecallReport = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  const unrecognized = unknownCliOption(args, ['--report'])

  if (unrecognized !== undefined) {
    return usageError(`Unknown option ${unrecognized}`)
  }

  const reportPaths = parseOptionValues(args, '--report')
  const selectedReportPaths =
    reportPaths.length === 0
      ? [path.posix.join('.codereviewer', 'eval', 'eval-report.json')]
      : reportPaths

  try {
    const reports = await Promise.all(
      selectedReportPaths.map(async (reportPath) => ({
        label: reportPath,
        report: await readEvalReport(options.cwd, reportPath)
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
  const unrecognized = unknownCliOption(args, ['--base', '--head'])

  if (unrecognized !== undefined) {
    return usageError(`Unknown option ${unrecognized}`)
  }

  try {
    const basePath = parseOptionValue(args, '--base')
    const headPath = parseOptionValue(args, '--head')

    if (basePath === undefined || headPath === undefined) {
      return usageError('eval compare requires --base and --head report paths')
    }

    const baseReport = await readEvalReport(options.cwd, basePath)
    const headReport = await readEvalReport(options.cwd, headPath)

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
  const unrecognized = unknownCliOption(args, ['--slice-root'])

  if (unrecognized !== undefined) {
    return usageError(`Unknown option ${unrecognized}`)
  }

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
  const unrecognized = unknownCliOption(args, [])

  if (unrecognized !== undefined) {
    return usageError(`Unknown option ${unrecognized}`)
  }

  if (args[0] !== 'check') {
    return usageError('Expected command: drift check')
  }

  try {
    const loadedConfig = await loadConfigForCommand(args.slice(1), options)
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

// JSON is the default because it was the only output this command ever had, and a
// script reading stdout must keep working unchanged.
const impactOutputFormats = ['json', 'markdown'] as const

type ImpactOutputFormat = (typeof impactOutputFormats)[number]

// `impact check` (spec 22). It makes NO provider call: the whole command is
// deterministic, so it costs nothing to run and its output is reproducible.
//
// What it produces is a REFERENCE report, not findings. Spec 22 requires a
// change-impact finding to name the contract element a dependent relies upon and
// the consequence of the change; a deterministic reference list has neither, so
// nothing here is admitted, given a severity, or allowed to block. The exit code
// is therefore 0 whatever the report says, and only a configuration (2) or
// repository (3) failure changes that. This command is also spec 22's own
// falsifier: its removal criterion is that the capability must beat naming the
// changed symbols and letting a human grep, and this IS that baseline.
//
// Its output goes three places, for one reason each. The JSON stays on stdout so
// scripted use keeps working. The rendered Markdown lands in the run directory
// beside where `review` writes `report.md`, because a report a reviewer has to go
// looking for is not in the workflow they actually use — spec 22 records exactly
// that gap. `--format markdown` puts the same document on stdout for someone
// reading it in a terminal or piping it into a pull-request body.
const runImpact = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  let format: ImpactOutputFormat | undefined

  try {
    format = parseEnumOption(args, '--format', impactOutputFormats)
  } catch (error) {
    return mapErrorResult(error, 'config')
  }

  return runCheckCommand({
    name: 'impact',
    args,
    options,
    commandOptions: ['--format'],
    report: async ({ loadedConfig, baseRef, headRef }) => {
      // The read budget is sized to the review file cap, which is the same bound
      // intake applies to how many files can be changed in one run.
      const retriever = createContextRetriever({
        repositoryRoot: options.cwd,
        budget: {
          maxReads: loadedConfig.config.review.maxFiles,
          maxBytesPerRead: loadedConfig.config.review.maxFileBytes,
          maxSearches: 0
        },
        paths: {
          include: loadedConfig.config.paths.include,
          exclude: loadedConfig.config.paths.exclude
        }
      })

      return runChangeImpact({
        repositoryRoot: options.cwd,
        config: loadedConfig.config,
        ...(baseRef === undefined ? {} : { baseRef }),
        ...(headRef === undefined ? {} : { headRef }),
        ...(options.now === undefined ? {} : { generatedAt: options.now() }),
        readChangedFile: mediatedFileReader(retriever)
      })
    },
    present: async (report, { loadedConfig }) => {
      const markdown = renderChangeImpactMarkdown(report)

      // A disabled run analysed nothing, so it leaves nothing behind. Writing a
      // run directory per invocation for a capability that is off by default
      // would accumulate empty runs in a repository whose owner never asked for
      // the stage — and these directories are not in the run index, so nothing
      // would ever enumerate them again. The report still says `disabled` on
      // stdout, and `--format markdown` still renders it.
      if (report.status === 'disabled') {
        return format === 'markdown' ? { stdout: markdown } : {}
      }

      // A run of its own, in the same place `review` puts one. The id is prefixed
      // so a directory listing says which stage produced it; nothing reads the
      // prefix.
      const artifactRoot = path.posix.join(
        loadedConfig.config.paths.artifactDir,
        `impact-${randomUUID()}`
      )

      await writeChangeImpactArtifacts({
        repositoryRoot: options.cwd,
        artifactRoot,
        reportJson: jsonResult(report),
        reportMarkdown: markdown
      })

      return {
        ...(format === 'markdown' ? { stdout: markdown } : {}),
        // The path goes to stderr rather than into the report on stdout: the
        // report is a strict schema a consumer parses, and stdout has to stay
        // exactly one JSON document for the scripted use that already exists.
        stderr: `Change-impact report: ${path.posix.join(artifactRoot, IMPACT_MARKDOWN_ARTIFACT_NAME)}\n`
      }
    }
  })
}

// `intent check` (spec 23).
//
// What it produces is a MAPPING between the stated intent and the change: the
// obligations the intent states, each citing the line it was read from, and for
// each one either the changed lines that address it or nothing. It is not a
// verdict, nothing is admitted, nothing carries a severity, and spec 23 makes
// advisory-only a REQUIREMENT rather than a default — "The command MUST NOT be
// able to fail a pipeline on fulfilment grounds. This is not configurable" —
// because published measurement puts spurious rejection of model requirement-
// conformance judgement at 26-36%, rising to 73-88% when the same call also
// explains itself. The exit code is therefore 0 whatever the report says,
// INCLUDING when there is no intent to read, and only a configuration or usage
// failure (2) or a repository failure (3) changes it.
//
// It is one of three independently runnable stages and shares no context or output
// with the other two: `review` can block, `intent check` and `impact check` /
// `conformance check` cannot.
const runIntent = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> =>
  runCheckCommand({
    name: 'intent',
    args,
    options,
    report: async ({ loadedConfig, baseRef, headRef }) => {
      // Change-intent sources are read by spec 11's ingestion instead of through
      // this retriever, which owns its own bounds and its own redaction.
      const retriever = createContextRetriever({
        repositoryRoot: options.cwd,
        budget: {
          maxReads: loadedConfig.config.review.maxFiles,
          maxBytesPerRead: loadedConfig.config.review.maxFileBytes,
          maxSearches: 0
        },
        paths: {
          include: loadedConfig.config.paths.include,
          exclude: loadedConfig.config.paths.exclude
        }
      })
      const logger = createCliLogger({
        config: loadedConfig.config,
        command: 'intent',
        sink: options.logSink
      })
      // Absent unless the capability is enabled AND a provider resolves. Every other
      // outcome reports `provider-unavailable` with a warning and still exits 0.
      const lane = await createIntentFulfilmentLane({
        config: loadedConfig.config,
        environment: options.environment ?? {},
        ...(options.providerImport === undefined
          ? {}
          : { providerImport: options.providerImport }),
        logger
      })

      try {
        return await runIntentFulfilment({
          repositoryRoot: options.cwd,
          config: loadedConfig.config,
          ...(baseRef === undefined ? {} : { baseRef }),
          ...(headRef === undefined ? {} : { headRef }),
          ...(options.now === undefined ? {} : { generatedAt: options.now() }),
          ...(lane === undefined
            ? {}
            : {
                agents: {
                  extractObligations: lane.extractObligations,
                  judge: lane.judge,
                  explain: lane.explain
                },
                usage: lane.usage
              }),
          readChangedFile: mediatedFileReader(retriever)
        })
      } finally {
        await lane?.shutdown()
      }
    }
  })

// `conformance check` (spec 24).
//
// It makes no provider call unless `invariantConformance.adjudication.enabled` is
// set, which is off by default: out of the box this is spec 24's deterministic
// baseline arm, so it costs nothing to run and its output is reproducible. With
// adjudication on it issues one bounded model call per divergence and reports only
// the ones judged a convention.
//
// What it produces either way is a DIVERGENCE report, not findings. A divergence is
// "these N peers do X; this declaration does not" — a substantiated fact plus a
// question, with the peers listed so the reader judges. It carries no verdict, no
// severity and no claim about exploitability, nothing is admitted, and spec 24
// requires the capability to be advisory only: it MUST NOT be able to fail a
// pipeline. The exit code is therefore 0 whatever the report says, and only a
// configuration or usage failure (2) or a repository failure (3) changes it — an
// adjudication that could not run is a warning in the report, never an exit code.
const runConformance = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> =>
  runCheckCommand({
    name: 'conformance',
    args,
    options,
    report: async ({ loadedConfig, baseRef, headRef }) => {
      const { review, invariantConformance } = loadedConfig.config
      // The read budget is derived rather than guessed: at most one read per
      // changed file, at most one directory listing per changed file, and at most
      // `maxPeerFiles` sibling reads. `maxMatches` bounds how many entries one
      // listing returns, so it must not sit below the peer-file cap or peers would
      // be lost to a bound meant for model-facing search.
      const retriever = createContextRetriever({
        repositoryRoot: options.cwd,
        budget: {
          maxReads: review.maxFiles * 2 + invariantConformance.maxPeerFiles,
          maxBytesPerRead: review.maxFileBytes,
          maxMatches: invariantConformance.maxPeerFiles,
          maxSearches: 0
        },
        paths: {
          include: loadedConfig.config.paths.include,
          exclude: loadedConfig.config.paths.exclude
        }
      })
      const logger = createCliLogger({
        config: loadedConfig.config,
        command: 'conformance',
        sink: options.logSink
      })
      // Absent unless adjudication is enabled AND a provider resolves. Every other
      // outcome degrades to the deterministic arm, which reports the reason as a
      // warning rather than failing.
      const adjudicationLane = await createConformanceAdjudicationLane({
        config: loadedConfig.config,
        environment: options.environment ?? {},
        ...(options.providerImport === undefined
          ? {}
          : { providerImport: options.providerImport }),
        logger
      })

      try {
        return await runInvariantConformance({
          repositoryRoot: options.cwd,
          config: loadedConfig.config,
          ...(baseRef === undefined ? {} : { baseRef }),
          ...(headRef === undefined ? {} : { headRef }),
          ...(options.now === undefined ? {} : { generatedAt: options.now() }),
          ...(adjudicationLane === undefined
            ? {}
            : {
                adjudicate: adjudicationLane.adjudicate,
                adjudicationUsage: adjudicationLane.usage
              }),
          readRepositoryFile: mediatedFileReader(retriever),
          listDirectoryFiles: async (directoryPath) => {
            try {
              const listing = await retriever.listRepositoryDirectory({
                path: directoryPath
              })

              // The mediated listing renders one `"<file|dir> <path>"` line per
              // eligible entry. Peer derivation wants files only; a subdirectory is
              // not a sibling of a declaration.
              return listing.content
                .split('\n')
                .filter((line) => line.startsWith('file '))
                .map((line) => line.slice('file '.length))
            } catch {
              return []
            }
          }
        })
      } finally {
        await adjudicationLane?.shutdown()
      }
    }
  })

export const runCli = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  const [command, subcommand, ...rest] = args
  // Commands that own their own subcommand parsing (`review` takes none;
  // `drift`/`impact`/`intent`/`conformance` require `check`) receive everything
  // after the command name.
  const commandArgs = args.slice(1)

  if (command === 'config' && subcommand === 'validate') {
    return runConfigValidate(rest, options)
  }

  if (command === 'review') {
    return runReview(commandArgs, options)
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
    return runDrift(commandArgs, options)
  }

  if (command === 'impact') {
    return runImpact(commandArgs, options)
  }

  if (command === 'intent') {
    return runIntent(commandArgs, options)
  }

  if (command === 'conformance') {
    return runConformance(commandArgs, options)
  }

  return usageError(
    'Expected command: config validate, review, baseline write, eval run, eval compare, eval recall-report, eval slice-manifest, drift check, impact check, intent check, or conformance check'
  )
}
