// Runs a single evaluation case through the review pipeline and shapes the
// result into an EvalCaseOutput, including the transient-provider-error retry
// (one retry at reduced concurrency) and provider-error shaping. This is eval
// orchestration extracted from the CLI so the command handler stays thin.
import { readFile } from 'node:fs/promises'
import {
  resolveExistingPathInsideRoot,
  resolvePathInsideRoot
} from '../platform/path-service.js'
import {
  EVAL_PROVIDER_RETRY_WARNING_PREFIX,
  calculateEvalDiffStats,
  loadEvalCasesFromFixtures,
  type EvalCaseOutput
} from '../domains/evaluation/index.js'
import { runReview as runReviewPipeline } from '../domains/review-workflow/index.js'
import { parseGitDiffMaps } from '../domains/repository-intake/index.js'
import { type ProviderImport } from '../domains/provider-resolution/index.js'
import { type Logger } from '../domains/observability/index.js'
import { loadCodeReviewerConfig } from '../domains/configuration/config-loader.js'
import { normalizeError } from '../shared/errors/error-normalizer.js'
import type { CodeReviewerConfig } from '../shared/contracts/index.js'

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

export const runEvalCase = async (
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
                `${EVAL_PROVIDER_RETRY_WARNING_PREFIX}${normalized.code}`
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
