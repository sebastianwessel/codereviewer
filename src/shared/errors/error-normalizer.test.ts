import { describe, expect, test } from 'vitest'
import { normalizeError } from './error-normalizer.js'

describe('error normalizer', () => {
  test('normalizes provider errors and redacts raw secret text', () => {
    const normalized = normalizeError(
      new Error('Provider failed with sk-proj-abcdefghijklmnopqrstuvwxyz123456'),
      {
        source: 'provider',
        operation: 'model.review'
      }
    )

    expect(normalized.category).toBe('provider')
    expect(normalized.code).toBe('provider_error')
    expect(normalized.exitCode).toBe(4)
    expect(normalized.recoverable).toBe(true)
    expect(normalized.message).not.toContain(
      'sk-proj-abcdefghijklmnopqrstuvwxyz123456'
    )
    expect(normalized.details.operation).toBe('model.review')
  })

  test('normalizes git timeout-shaped errors as recoverable', () => {
    const normalized = normalizeError(new Error('git timed out'), {
      source: 'repository'
    })

    expect(normalized.category).toBe('repository')
    expect(normalized.code).toBe('repository_timeout')
    expect(normalized.exitCode).toBe(3)
    expect(normalized.recoverable).toBe(true)
  })

  test('normalizes cancellation-shaped errors', () => {
    const normalized = normalizeError(new Error('operation aborted'), {
      source: 'provider'
    })

    expect(normalized.category).toBe('provider')
    expect(normalized.code).toBe('provider_cancelled')
    expect(normalized.exitCode).toBe(4)
    expect(normalized.recoverable).toBe(true)
  })

  test('normalizes unknown thrown values without leaking token text', () => {
    const normalized = normalizeError('raw ghp_abcdefghijklmnopqrstuvwxyz1234567890')

    expect(normalized.category).toBe('internal')
    expect(normalized.code).toBe('unknown_error')
    expect(normalized.exitCode).toBe(5)
    expect(normalized.recoverable).toBe(false)
    expect(normalized.message).not.toContain(
      'ghp_abcdefghijklmnopqrstuvwxyz1234567890'
    )
  })
})
