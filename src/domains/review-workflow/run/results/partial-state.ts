import path from 'node:path'
import type {
  CodeReviewerConfig,
  ReviewReport
} from '../../../../shared/contracts/index.js'
import type { StructuredError } from '../../../../shared/errors/error-normalizer.js'
import type { RunCostSummary } from '../../../costs/index.js'
import type { NoContentObservabilitySnapshot } from '../../../observability/index.js'
import type { ContextLedgerEntry } from '../../../review-planning/index.js'
import type { ReviewSharedContextSnapshot } from '../../../shared-context/index.js'
import { ReviewRunFailedError } from '../support/errors.js'
import { createReviewRunSummary } from './results.js'

export const createPartialReviewRunFailedError = (
  input: {
    readonly structuredError: StructuredError
    readonly artifactDir: string
    readonly repositoryRoot: string
    readonly config: CodeReviewerConfig
    readonly baseRef?: string | undefined
    readonly headRef?: string | undefined
    readonly runId: string
    readonly startedAt: Date
    readonly completedAt: Date
    readonly configHash: string
    readonly warnings: readonly string[]
    // Required, like everywhere else this summary is built. It was optional here
    // alone, on the reading that a run dying inside the provider workflow could
    // not know whether a model had searched — and the consequence of saying
    // nothing was that `createReviewRunSummary` stamped the configured provider
    // and model by default, which is the claim the field exists to stop. Both
    // callers do know: the coverage and cost gates carry the run's own value, and
    // a provider-workflow failure is only ever raised after tasks reached the
    // model (see `provider-failures.ts`).
    readonly modelSearch: NonNullable<ReviewReport['run']['modelSearch']>
    readonly runCost?: RunCostSummary | undefined
    readonly contextLedger: readonly ContextLedgerEntry[]
    readonly sharedContext: ReviewSharedContextSnapshot
    readonly observability: NoContentObservabilitySnapshot
  }
): ReviewRunFailedError =>
  new ReviewRunFailedError({
    structuredError: input.structuredError,
    partialState: {
      artifactRoot: path.posix.join(input.artifactDir, input.runId),
      runSummary: createReviewRunSummary({
        repositoryRoot: input.repositoryRoot,
        config: input.config,
        baseRef: input.baseRef,
        headRef: input.headRef,
        runId: input.runId,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        configHash: input.configHash,
        warnings: input.warnings,
        modelSearch: input.modelSearch,
        ...(input.runCost === undefined ? {} : { runCost: input.runCost })
      }),
      contextLedger: input.contextLedger,
      sharedContext: input.sharedContext,
      observability: input.observability,
      error: input.structuredError
    }
  })
