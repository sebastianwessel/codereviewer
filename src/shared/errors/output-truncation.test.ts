import { describe, expect, test } from 'vitest'
import {
  PROVIDER_OUTPUT_TRUNCATED_CODE,
  isProviderOutputTruncated,
  providerOutputTruncationOrSelf
} from './output-truncation.js'

// The shape `guardTruncatedProviderOutput` throws: a plain structured error object,
// deliberately not an `Error`, because the harness classifies retries off error
// TYPES and retrying an identical request against an identical ceiling truncates
// identically.
const truncated = (): unknown => ({
  code: PROVIDER_OUTPUT_TRUNCATED_CODE,
  message: 'Model stopped at the output-token limit.',
  category: 'provider'
})

describe('provider output truncation detection', () => {
  test('recognises the structured code the guard raises', () => {
    expect(isProviderOutputTruncated(truncated())).toBe(true)
  })

  test('finds it through a wrapping error’s cause chain', () => {
    // A discovery call runs inside an agent loop that may rewrap what it catches.
    // Reading only the top-level error would let a wrapped truncation propagate and
    // fail a run that has every other task's findings in hand.
    const wrapped = new Error('agent step failed', {
      cause: new Error('model call failed', { cause: truncated() })
    })

    expect(isProviderOutputTruncated(wrapped)).toBe(true)
  })

  test('does NOT match provider message text', () => {
    // The condition is a structured code this engine raises itself, so there is
    // nothing to infer from prose. Matching text would succeed just often enough to
    // hide an adapter that reports truncation some other way.
    expect(
      isProviderOutputTruncated(
        new Error('the response was truncated at the output token limit')
      )
    ).toBe(false)
  })

  test('does not confuse a different structured code for a truncation', () => {
    expect(
      isProviderOutputTruncated({ code: 'provider_rate_limited' })
    ).toBe(false)
  })

  test('survives a cyclic cause chain instead of hanging the run', () => {
    const cyclic = new Error('outer') as Error & { cause?: unknown }
    cyclic.cause = cyclic

    expect(isProviderOutputTruncated(cyclic)).toBe(false)
  })

  test('tolerates non-error values', () => {
    expect(isProviderOutputTruncated(undefined)).toBe(false)
    expect(isProviderOutputTruncated(null)).toBe(false)
    expect(isProviderOutputTruncated(PROVIDER_OUTPUT_TRUNCATED_CODE)).toBe(false)
  })
})

describe('unwrapping a truncation for reporting', () => {
  test('returns the truncation itself from inside a wrapper', () => {
    // The reported CODE is the actionable part — it is what tells an operator to
    // raise or unset the output-token ceiling. The normalizer reads only the
    // outermost error, so a wrapped truncation would be filed as a generic
    // `provider_error` and the remedy would be lost.
    const inner = truncated()

    expect(
      providerOutputTruncationOrSelf(
        new Error('agent step failed', { cause: inner })
      )
    ).toBe(inner)
  })

  test('leaves every other error exactly as it was', () => {
    const other = new Error('401 invalid api key')

    expect(providerOutputTruncationOrSelf(other)).toBe(other)
  })
})
