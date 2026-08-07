import type {
  CoverageSummary,
  ReviewReport
} from '../../../../shared/contracts/index.js'
import {
  normalizeError,
  type StructuredError
} from '../../../../shared/errors/error-normalizer.js'
import type { ContextLedgerEntry } from '../../../review-planning/index.js'
import type { ReviewSharedContextSnapshot } from '../../../shared-context/index.js'
import type { NoContentObservabilitySnapshot } from '../../../observability/index.js'

export type PartialReviewRunState = {
  readonly artifactRoot: string
  readonly runSummary: ReviewReport['run']
  readonly contextLedger: readonly ContextLedgerEntry[]
  readonly sharedContext: ReviewSharedContextSnapshot
  readonly observability: NoContentObservabilitySnapshot
  readonly error: StructuredError
}

export class ReviewRunFailedError extends Error {
  readonly partialState: PartialReviewRunState
  readonly structuredError: StructuredError

  constructor(input: {
    readonly partialState: PartialReviewRunState
    readonly structuredError: StructuredError
  }) {
    super(input.structuredError.message)
    this.name = 'ReviewRunFailedError'
    this.partialState = input.partialState
    this.structuredError = input.structuredError
  }
}

export const isReviewRunFailedError = (
  error: unknown
): error is ReviewRunFailedError => error instanceof ReviewRunFailedError

export const createCostBudgetExceededError = (
  input: {
    readonly maxCostUsd: number
    readonly costUsd: number
  }
): StructuredError => ({
  code: 'cost_budget_exceeded',
  message: `Review cost ${input.costUsd} USD exceeds configured maxCostUsd ${input.maxCostUsd} USD.`,
  category: 'quality-gate',
  recoverable: true,
  exitCode: 1,
  details: {
    maxCostUsd: input.maxCostUsd,
    costUsd: input.costUsd
  }
})

type ReviewRunTerminalFailure = {
  readonly throwError: ReviewRunFailedError | StructuredError
  readonly structuredError: StructuredError
  readonly logMessage: string
  readonly logMetadata: Readonly<Record<string, unknown>>
}

export const createReviewRunTerminalFailure = (
  input: {
    readonly error: unknown
  }
): ReviewRunTerminalFailure => {
  if (isReviewRunFailedError(input.error)) {
    return {
      throwError: input.error,
      structuredError: input.error.structuredError,
      logMessage: 'Review run failed.',
      logMetadata: {
        code: input.error.structuredError.code,
        category: input.error.structuredError.category,
        recoverable: input.error.structuredError.recoverable
      }
    }
  }

  const normalized = normalizeError(input.error, {
    source: 'internal',
    operation: 'run_review'
  })

  return {
    throwError: normalized,
    structuredError: normalized,
    logMessage: 'Review run crashed.',
    logMetadata: {
      code: normalized.code,
      category: normalized.category,
      recoverable: normalized.recoverable
    }
  }
}

export const createCoverageIncompleteError = (
  coverage: CoverageSummary
): StructuredError => ({
  code: 'coverage_incomplete',
  message:
    'Review coverage is incomplete. The run did not claim review success because required source was not fully assigned to review tasks.',
  category: 'quality-gate',
  recoverable: true,
  exitCode: 1,
  details: {
    // Included for the same reason it is on the certificate: a coverage failure
    // that names only the files which reached review says nothing about the ones
    // that never did.
    excludedFileCount: coverage.excludedFileCount,
    reviewableFileCount: coverage.reviewableFileCount,
    coveredFileCount: coverage.coveredFileCount,
    reviewableBytes: coverage.reviewableBytes,
    coveredBytes: coverage.coveredBytes
  }
})

/**
 * Bridges a CALLER-supplied abort signal into the run.
 *
 * There is deliberately no run-level timeout to arm. A whole-run deadline is a
 * limit this project imposes on itself, and when it fires it destroys work that
 * was progressing perfectly well — the review simply takes as long as the change
 * needs. What genuinely must be bounded is a single network call that could hang
 * forever, and that is `provider.timeoutMs`; a call that fails transiently is
 * retried under `provider.maxRetries`, and anything that cannot be recovered fails
 * loudly with a classified error.
 *
 * An external abort is a different thing entirely and is still honoured: a CI job
 * being cancelled is the operator deciding, not the engine restricting itself.
 */
export const createReviewRunSignal = (
  parentSignal: AbortSignal | undefined
): {
  readonly signal?: AbortSignal
  readonly cleanup: () => void
} => {
  if (parentSignal === undefined) {
    return {
      cleanup: () => {}
    }
  }

  const controller = new AbortController()
  const abortFromParent = (): void => {
    controller.abort(parentSignal?.reason)
  }

  if (parentSignal?.aborted) {
    abortFromParent()
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true })
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      parentSignal?.removeEventListener('abort', abortFromParent)
    }
  }
}
