import { describe, expect, test } from 'vitest'
import {
  createCostBudgetExceededError,
  createCoverageIncompleteError,
  createReviewRunTerminalFailure,
  createReviewRunSignal,
  ReviewRunFailedError
} from './errors.js'

describe('review runner errors', () => {
  test('creates report-safe structured run errors', () => {

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
        excludedFileCount: 0,
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
        excludedFileCount: 0,
        reviewableFileCount: 2,
        coveredFileCount: 1,
        reviewableBytes: 20,
        coveredBytes: 10
      }
    })
  })

  test('forwards parent aborts through the review run signal', () => {
    const parent = new AbortController()
    const runSignal = createReviewRunSignal(parent.signal)

    parent.abort('stop')

    expect(runSignal.signal?.aborted).toBe(true)
    expect(runSignal.signal?.reason).toBe('stop')

    runSignal.cleanup()
  })

  test('arms no deadline of its own when no caller signal is given', () => {
    // There is deliberately no run-level timeout to arm: it is a self-imposed limit
    // that destroys progressing work. A hanging network call is bounded by
    // `provider.timeoutMs`, a transient failure is retried, and an unrecoverable one
    // fails loudly.
    const runSignal = createReviewRunSignal(undefined)

    expect(runSignal.signal).toBeUndefined()
    runSignal.cleanup()
  })

  test('classifies terminal review run errors for logging and throwing', () => {
    const partialStructuredError = createCostBudgetExceededError({
      maxCostUsd: 1,
      costUsd: 2
    })
    const partialFailure = new ReviewRunFailedError({
      structuredError: partialStructuredError,
      partialState: {} as ConstructorParameters<
        typeof ReviewRunFailedError
      >[0]['partialState']
    })

    const failed = createReviewRunTerminalFailure({ error: partialFailure })
    expect(failed.throwError).toBe(partialFailure)
    expect(failed.structuredError).toBe(partialStructuredError)
    expect(failed.logMessage).toBe('Review run failed.')
    expect(failed.logMetadata).toEqual({
      code: 'cost_budget_exceeded',
      category: 'quality-gate',
      recoverable: true
    })


    const crashed = createReviewRunTerminalFailure({ error: new Error('boom') })
    expect(crashed.structuredError.code).toBe('unknown_error')
    expect(crashed.logMessage).toBe('Review run crashed.')
    expect(crashed.logMetadata).toEqual({
      code: 'unknown_error',
      category: 'internal',
      recoverable: false
    })
  })
})
