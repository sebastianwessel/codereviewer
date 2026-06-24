import { OperationTimeoutError } from '@purista/harness'
import type {
  CoverageSummary,
  ReviewReport
} from '../../../../shared/contracts/index.js'
import {
  normalizeError,
  type StructuredError
} from '../../../../shared/errors/error-normalizer.js'
import type { ContextLedgerEntry } from '../../../review-planning/context-ledger.js'
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

export const createReviewRunTimeoutError = (
  timeoutMs: number
): StructuredError => ({
  code: 'review_run_timeout',
  message: `Review run timed out after ${timeoutMs}ms.`,
  category: 'provider',
  recoverable: true,
  exitCode: 4,
  details: {
    timeoutMs
  }
})

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

export const isHarnessRunTimeoutError = (
  error: unknown
): error is OperationTimeoutError =>
  error instanceof OperationTimeoutError &&
  error.meta?.scope === 'run'

export type ReviewRunTerminalFailure = {
  readonly throwError: ReviewRunFailedError | StructuredError
  readonly structuredError: StructuredError
  readonly logMessage: string
  readonly logMetadata: Readonly<Record<string, unknown>>
}

export const createReviewRunTerminalFailure = (
  input: {
    readonly error: unknown
    readonly runTimedOut: boolean
    readonly timeoutMs?: number | undefined
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

  if (
    (input.runTimedOut || isHarnessRunTimeoutError(input.error)) &&
    input.timeoutMs !== undefined
  ) {
    const timeoutError = createReviewRunTimeoutError(input.timeoutMs)

    return {
      throwError: timeoutError,
      structuredError: timeoutError,
      logMessage: 'Review run timed out.',
      logMetadata: {
        code: timeoutError.code,
        timeout_ms: input.timeoutMs
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
    reviewableFileCount: coverage.reviewableFileCount,
    coveredFileCount: coverage.coveredFileCount,
    reviewableBytes: coverage.reviewableBytes,
    coveredBytes: coverage.coveredBytes
  }
})

export const createReviewRunSignal = (
  parentSignal: AbortSignal | undefined,
  timeoutMs: number | undefined
): {
  readonly signal?: AbortSignal
  readonly timedOut: () => boolean
  readonly cleanup: () => void
} => {
  if (parentSignal === undefined && timeoutMs === undefined) {
    return {
      timedOut: () => false,
      cleanup: () => {}
    }
  }

  const controller = new AbortController()
  let timedOut = false
  const abortFromParent = (): void => {
    controller.abort(parentSignal?.reason)
  }
  const timeout =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true
          controller.abort(createReviewRunTimeoutError(timeoutMs))
        }, timeoutMs)

  if (parentSignal?.aborted) {
    abortFromParent()
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true })
  }

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      if (timeout !== undefined) {
        clearTimeout(timeout)
      }
      parentSignal?.removeEventListener('abort', abortFromParent)
    }
  }
}
