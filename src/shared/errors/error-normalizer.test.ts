import { describe, expect, test } from 'vitest'
import { normalizeError } from './error-normalizer.js'

describe('error normalizer', () => {
  test('normalizes provider errors and redacts raw secret text', () => {
    const normalized = normalizeError(
      new Error('Provider failed with sk-proj-abcdefghijklmnopqrstuvwxyz123456'),
      {
        source: 'provider',
        operation: 'model.codereviewer'
      }
    )

    expect(normalized.category).toBe('provider')
    expect(normalized.code).toBe('provider_error')
    expect(normalized.exitCode).toBe(4)
    expect(normalized.recoverable).toBe(true)
    expect(normalized.message).not.toContain(
      'sk-proj-abcdefghijklmnopqrstuvwxyz123456'
    )
    expect(normalized.details.operation).toBe('model.codereviewer')
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

  test('sub-classifies rate-limited provider errors from status and message', () => {
    expect(
      normalizeError(Object.assign(new Error('slow down'), { status: 429 }), {
        source: 'provider'
      }).code
    ).toBe('provider_rate_limited')
    expect(
      normalizeError(new Error('The engine is overloaded, please retry'), {
        source: 'provider'
      }).code
    ).toBe('provider_rate_limited')
    expect(
      normalizeError(new Error('Rate limit exceeded for this key'), {
        source: 'provider'
      }).code
    ).toBe('provider_rate_limited')
  })

  test('sub-classifies authentication provider errors', () => {
    expect(
      normalizeError(Object.assign(new Error('nope'), { statusCode: 401 }), {
        source: 'provider'
      }).code
    ).toBe('provider_auth')
    expect(
      normalizeError(
        Object.assign(new Error('denied'), { response: { status: 403 } }),
        { source: 'provider' }
      ).code
    ).toBe('provider_auth')
    expect(
      normalizeError(new Error('Invalid API key provided'), {
        source: 'provider'
      }).code
    ).toBe('provider_auth')
  })

  test('sub-classifies context-length provider errors', () => {
    expect(
      normalizeError(
        new Error("This model's maximum context length is 8192 tokens"),
        { source: 'provider' }
      ).code
    ).toBe('provider_context_length')
    expect(
      normalizeError(new Error('Request had too many tokens'), {
        source: 'provider'
      }).code
    ).toBe('provider_context_length')
  })

  test('sub-classifies 5xx provider server errors', () => {
    expect(
      normalizeError(Object.assign(new Error('boom'), { status: 503 }), {
        source: 'provider'
      }).code
    ).toBe('provider_server_error')
  })

  test('falls back to provider_error when nothing specific matches', () => {
    expect(
      normalizeError(new Error('Provider failed unexpectedly'), {
        source: 'provider'
      }).code
    ).toBe('provider_error')
  })

  test('does not leak secrets into the sub-classified message', () => {
    const normalized = normalizeError(
      Object.assign(
        new Error('Rate limit hit for sk-proj-abcdefghijklmnopqrstuvwxyz123456'),
        { status: 429 }
      ),
      { source: 'provider' }
    )

    expect(normalized.code).toBe('provider_rate_limited')
    expect(normalized.message).not.toContain(
      'sk-proj-abcdefghijklmnopqrstuvwxyz123456'
    )
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
