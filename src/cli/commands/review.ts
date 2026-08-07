// `review` — the general review run: pipeline execution, the two post-review
// investigation lanes, artifact writing, and the quality gate that decides the
// exit code. It is the only command that can fail a pipeline on findings.
import path from 'node:path'
import {
  isReviewRunFailedError,
  runReview as runReviewPipeline
} from '../../domains/review-workflow/index.js'
import { runWarningsForVerificationReport } from '../../domains/verification/index.js'
import {
  loggingCliOptions,
  parseExplicitFiles,
  parseLogFileOverride,
  parseLogLevelOverride,
  parseOptionValue,
  unknownCliOption
} from '../args.js'
import type { CliResult, CliRunOptions } from '../cli-contract.js'
import { mapErrorResult, usageError } from '../cli-error-results.js'
import { loadConfigForCommand } from '../command-config.js'
import { createCliLogger, resolveLogSink } from '../command-logging.js'
import {
  runFixForReview,
  runVerificationForReview
} from '../investigation-lanes.js'
import { qualityGateOfCompletedRun } from '../review-completion.js'
import {
  jsonResult,
  recordRunInIndex,
  writePartialReviewArtifacts,
  writeReviewArtifacts,
  writeRunArtifact
} from '../run-artifacts.js'

export const runReview = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> => {
  const unrecognized = unknownCliOption(args, [
    ...loggingCliOptions,
    '--base-ref',
    '--head-ref',
    '--file',
    '--files'
  ])

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

    // Throws `quality_gate_missing` (exit 5) rather than defaulting when a
    // completed report carries no gate. See `review-completion.ts`.
    const qualityGate = qualityGateOfCompletedRun(report)

    return {
      exitCode: qualityGate.passed ? 0 : 1,
      stdout: jsonResult({
        runId: report.run.runId,
        qualityGatePassed: qualityGate.passed,
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
