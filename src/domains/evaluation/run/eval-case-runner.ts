// Runs a single evaluation case through the review pipeline and shapes the
// result into an EvalCaseOutput, including the transient-provider-error retry
// (one retry at reduced concurrency) and provider-error shaping.
//
// This is eval orchestration, and it lives in `evaluation/run/` beside
// `eval-runner.ts` for that reason. It was originally extracted out of the
// `eval run` command handler to keep the handler thin, but landed in `src/cli/`
// — which kept per-case measurement policy (which lane runs, what a transient
// provider error is worth retrying, how a crash is scored) in the layer whose
// only job is parsing a command line. `evaluation` is the cross-cutting
// measurement domain and already drives review-workflow's siblings, so the
// policy belongs here and the command handler is left with the argument
// parsing that is genuinely its own.
//
// NOT ON THE DOMAIN BARREL, and the sibling imports below are direct for the
// same reason. `review-workflow`'s preflight runs the drift gate, and drift's
// artifact-example checker validates the eval corpus contracts through
// `evaluation/index.ts`, so anything reachable from that barrel must not import
// `review-workflow`: `evaluation/index` → here → `review-workflow` → `drift` →
// `evaluation/index` is a cycle, and at runtime it leaves one side's zod
// schemas in the temporal dead zone. `src/cli/commands/eval-run.ts` therefore
// imports this module by path. That is not a domain reaching past a sibling's
// barrel — the CLI is the composition layer and already imports
// `drift/drift-checker.js` and `reporting/sarif-validation.js` the same way.
import { readFile } from 'node:fs/promises'
import {
  resolveExistingPathInsideRoot,
  resolvePathInsideRoot
} from '../../../platform/path-service.js'
import { EVAL_PROVIDER_RETRY_WARNING_PREFIX } from '../eval-warnings.js'
import { calculateEvalDiffStats } from '../scoring/eval-diff-stats.js'
import type { EvalCase } from '../corpus/eval-fixture.schema.js'
import type { EvalCaseOutput } from '../report/eval-report-contracts.js'
import { runReview as runReviewPipeline } from '../../review-workflow/index.js'
import { runFixRun } from '../../verification/index.js'
import type { AdmittedFinding } from '../../../shared/contracts/findings/finding.schema.js'
import { parseGitDiffMaps } from '../../repository-intake/index.js'
import { type ProviderImport } from '../../provider-resolution/index.js'
import { type Logger } from '../../observability/index.js'
import {
  normalizeError,
  type StructuredError
} from '../../../shared/errors/error-normalizer.js'
import type {
  CodeReviewerConfig,
  ReviewReport
} from '../../../shared/contracts/index.js'

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
    readonly evalCase: EvalCase
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
  normalized: StructuredError
): string | undefined => {
  const operation = normalized.details.operation

  return typeof operation === 'string' && operation.length > 0
    ? operation
    : undefined
}

export const runEvalCase = async (
  input: {
    readonly root: string
    readonly config: CodeReviewerConfig
    readonly configWarnings: readonly string[]
    readonly baselineExplicitlyConfigured: boolean
    readonly environment: Readonly<Record<string, string | undefined>>
    readonly evalCase: EvalCase
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

  // Result of attempting the fix lane for one case: the per-finding outcomes it
  // produced (empty when the lane never ran a finding through it), plus a
  // provider issue when the lane itself crashed. `providerIssue` is the only
  // signal that distinguishes a crash from the lane being disabled or having no
  // eligible finding -- both of which also yield an empty `fixOutcomes` array
  // but are not failures, so they carry no issue.
  type FixLaneAttempt = {
    readonly fixOutcomes: EvalCaseOutput['fixOutcomes']
    readonly providerIssue?: ReviewReport['providerIssues'][number]
  }

  // Run the finding investigation-and-fix lane (spec 12) in the eval path so its
  // real outcomes can be scored. It is gated internally on `config.fix.enabled`
  // (default off), and `runFixRun` itself returns cleanly with no outcomes when
  // there is no admitted finding at or above `fix.minSeverity` -- both cases are
  // genuinely benign and never reach the catch below. The lane is advisory: a
  // crash caught here must never fail the eval case, but scoring it as an empty
  // result would make it look exactly like those benign paths, so a caught
  // failure is instead carried out as a `stage: 'fix'` provider issue merged
  // into the review report, keeping "the lane broke" visible and distinct from
  // "the lane found nothing to do".
  const runFixOutcomesForCase = async (
    config: CodeReviewerConfig,
    admittedFindings: readonly AdmittedFinding[]
  ): Promise<FixLaneAttempt> => {
    if (!config.fix.enabled) {
      return { fixOutcomes: [] }
    }

    try {
      const { report } = await runFixRun({
        config,
        repositoryRoot: fixtureRoot,
        environment: input.environment,
        admittedFindings,
        ...(input.logger === undefined ? {} : { logger: input.logger }),
        ...(input.providerImport === undefined
          ? {}
          : { providerImport: input.providerImport })
      })

      return {
        fixOutcomes: report.fixOutcomes.map((outcome) => ({
          findingId: outcome.findingId,
          ...(outcome.findingJudgment === undefined
            ? {}
            : { findingJudgment: outcome.findingJudgment }),
          fixProduced: outcome.fixProduced,
          applyCheck: outcome.applyCheck
        }))
      }
    } catch (error) {
      const normalized = normalizeError(error, {
        source: 'provider',
        operation: 'fix'
      })

      input.logger?.warn(
        'Eval fix lane failed; scoring the case without fix outcomes.',
        {
          eval_case_id: input.evalCase.id,
          code: normalized.code
        }
      )

      return {
        fixOutcomes: [],
        providerIssue: {
          code: normalized.code,
          stage: 'fix',
          recovered: false,
          message: normalized.message.slice(0, 500)
        }
      }
    }
  }

  // Merges a fix-lane crash into the review report's own `providerIssues`, the
  // same field a hard provider recovery already uses, so the eval report's
  // existing provider-issue rendering and counts surface the failure without a
  // new field. Absent when the lane did not crash, so a benign empty
  // `fixOutcomes` array is left exactly as it was.
  const withFixLaneProviderIssue = (
    reviewResult: Awaited<ReturnType<typeof runReviewPipeline>>,
    providerIssue: ReviewReport['providerIssues'][number] | undefined
  ): Awaited<ReturnType<typeof runReviewPipeline>> =>
    providerIssue === undefined
      ? reviewResult
      : {
          ...reviewResult,
          report: {
            ...reviewResult.report,
            providerIssues: [...reviewResult.report.providerIssues, providerIssue]
          }
        }

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
    reviewResult: Awaited<ReturnType<typeof runReviewPipeline>>,
    fixOutcomes: EvalCaseOutput['fixOutcomes']
  ): EvalCaseOutput => ({
    caseId: input.evalCase.id,
    changedLineCount: evalCaseSize.changedLineCount,
    diffHunkCount: evalCaseSize.diffHunkCount,
    contextLedger: reviewResult.contextLedger.map((entry) => ({
      kind: entry.kind,
      consideredForModelContext: entry.decision === 'included' || entry.decision === 'truncated',
      truncated: entry.decision === 'truncated'
    })),
    fixOutcomes,
    result: {
      status: 'ok',
      reviewReport: reviewResult.report
    }
  })

  // A case that ends in a hard provider error carries no review report, so it is
  // scored as a provider error with no ledger and no fix outcomes.
  const providerErrorOutput = (normalized: StructuredError): EvalCaseOutput => {
    const stage = stageFromNormalizedError(normalized)

    return {
      caseId: input.evalCase.id,
      changedLineCount: evalCaseSize.changedLineCount,
      diffHunkCount: evalCaseSize.diffHunkCount,
      contextLedger: [],
      fixOutcomes: [],
      result: {
        status: 'provider-error',
        code: normalized.code,
        ...(stage === undefined ? {} : { stage }),
        message: normalized.message
      }
    }
  }

  const runReviewAndFixForCase = async (
    config: CodeReviewerConfig
  ): Promise<EvalCaseOutput> => {
    const reviewResult = await runReviewForCase(config)
    const fixLaneAttempt = await runFixOutcomesForCase(
      config,
      reviewResult.report.admittedFindings
    )

    return resultForReviewReport(
      withFixLaneProviderIssue(reviewResult, fixLaneAttempt.providerIssue),
      fixLaneAttempt.fixOutcomes
    )
  }

  try {
    return await runReviewAndFixForCase(input.config)
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
        const retryConfig = retryConfigForTransientProviderError()
        const retryResult = await runReviewForCase(retryConfig)
        const retryReviewResult = {
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
        }
        const retryFixLaneAttempt = await runFixOutcomesForCase(
          retryConfig,
          retryReviewResult.report.admittedFindings
        )

        return resultForReviewReport(
          withFixLaneProviderIssue(retryReviewResult, retryFixLaneAttempt.providerIssue),
          retryFixLaneAttempt.fixOutcomes
        )
      } catch (retryError) {
        const retryNormalized = normalizeError(retryError, {
          source: 'provider'
        })

        if (retryNormalized.category !== 'provider') {
          throw retryError
        }

        return providerErrorOutput(retryNormalized)
      }
    }

    return providerErrorOutput(normalized)
  }
}
