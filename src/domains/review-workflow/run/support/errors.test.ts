import { describe, expect, test } from 'vitest'
import {
  createCostBudgetExceededError,
  createCoverageIncompleteError,
  createReviewRunTerminalFailure,
  createReviewRunSignal,
  createReviewRunTimeoutError,
  ReviewRunFailedError
} from './errors.js'

describe('review runner errors', () => {
  test('creates report-safe structured run errors', () => {
    expect(createReviewRunTimeoutError(250)).toEqual({
      code: 'review_run_timeout',
      message: 'Review run timed out after 250ms.',
      category: 'provider',
      recoverable: true,
      exitCode: 4,
      details: {
        timeoutMs: 250
      }
    })

    expect(
      createCostBudgetExceededError({ maxCostUsd: 1.5, costUsd: 2 })
    ).toEqual({
      code: 'cost_budget_exceeded',
      message: 'Review cost 2 USD exceeds configured maxCostUsd 1.5 USD.',
      category: 'quality-gate',
      recoverable: true,
      exitCode: 1,
      details: {
        maxCostUsd: 1.5,
        costUsd: 2
      }
    })

    expect(
      createCoverageIncompleteError({
        status: 'incomplete',
        reviewableFileCount: 2,
        coveredFileCount: 1,
        reviewableBytes: 20,
        coveredBytes: 10,
        incompleteReasons: ['src/a.ts: partial'],
        files: []
      })
    ).toEqual({
      code: 'coverage_incomplete',
      message:
        'Review coverage is incomplete. The run did not claim review success because required source was not fully assigned to review tasks.',
      category: 'quality-gate',
      recoverable: true,
      exitCode: 1,
      details: {
        reviewableFileCount: 2,
        coveredFileCount: 1,
        reviewableBytes: 20,
        coveredBytes: 10
      }
    })
  })

  test('forwards parent aborts through the review run signal', () => {
    const parent = new AbortController()
    const runSignal = createReviewRunSignal(parent.signal, undefined)

    parent.abort('stop')

    expect(runSignal.signal?.aborted).toBe(true)
    expect(runSignal.signal?.reason).toBe('stop')
    expect(runSignal.timedOut()).toBe(false)

    runSignal.cleanup()
  })

  test('classifies terminal review run errors for logging and throwing', () => {
    const partialStructuredError = createReviewRunTimeoutError(500)
    const partialFailure = new ReviewRunFailedError({
      structuredError: partialStructuredError,
      partialState: {} as ConstructorParameters<
        typeof ReviewRunFailedError
      >[0]['partialState']
    })

    const failed = createReviewRunTerminalFailure({
      error: partialFailure,
      runTimedOut: false
    })
    expect(failed.throwError).toBe(partialFailure)
    expect(failed.structuredError).toBe(partialStructuredError)
    expect(failed.logMessage).toBe('Review run failed.')
    expect(failed.logMetadata).toEqual({
      code: 'review_run_timeout',
      category: 'provider',
      recoverable: true
    })

    const timeout = createReviewRunTerminalFailure({
      error: new Error('aborted'),
      runTimedOut: true,
      timeoutMs: 1000
    })
    expect(timeout.throwError).toEqual(createReviewRunTimeoutError(1000))
    expect(timeout.logMessage).toBe('Review run timed out.')
    expect(timeout.logMetadata).toEqual({
      code: 'review_run_timeout',
      timeout_ms: 1000
    })

    const crashed = createReviewRunTerminalFailure({
      error: new Error('boom'),
      runTimedOut: false,
      timeoutMs: 1000
    })
    expect(crashed.structuredError.code).toBe('unknown_error')
    expect(crashed.logMessage).toBe('Review run crashed.')
    expect(crashed.logMetadata).toEqual({
      code: 'unknown_error',
      category: 'internal',
      recoverable: false
    })
  })
})
