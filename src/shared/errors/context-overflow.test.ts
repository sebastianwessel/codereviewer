import { describe, expect, test } from 'vitest'
import { isContextLengthExceeded } from './context-overflow.js'

const overflow = (): Error =>
  Object.assign(new Error('provider rejected the request'), {
    reason: 'context_length_exceeded'
  })

describe('context overflow detection', () => {
  test('recognises the harness’s normalised overflow reason', () => {
    expect(isContextLengthExceeded(overflow())).toBe(true)
  })

  test('finds the overflow through a wrapping error’s cause chain', () => {
    // A discovery call runs inside an agent loop that may rewrap what it catches,
    // so reading only the top-level error would miss a genuine overflow.
    const wrapped = new Error('agent step failed', {
      cause: new Error('model call failed', { cause: overflow() })
    })

    expect(isContextLengthExceeded(wrapped)).toBe(true)
  })

  test('does NOT match provider message text — the ban is the point', () => {
    // Spec 26 forbids matching message text: it differs per vendor and changes
    // without notice, so matching it would reintroduce a guess in the one place the
    // design exists to remove one, AND would hide that a provider adapter is failing
    // to classify its own overflow. Such an error stays an ordinary classified
    // failure: loud, specific, attributable to the adapter that owes the fix.
    expect(
      isContextLengthExceeded(
        new Error("This model's maximum context length is 8192 tokens")
      )
    ).toBe(false)
    expect(
      isContextLengthExceeded(new Error('request too large: too many tokens'))
    ).toBe(false)
  })

  test('does not confuse a different normalised reason for an overflow', () => {
    expect(
      isContextLengthExceeded(
        Object.assign(new Error('slow down'), { reason: 'rate_limited' })
      )
    ).toBe(false)
  })

  test('survives a cyclic cause chain instead of hanging the run', () => {
    const cyclic = new Error('outer') as Error & { cause?: unknown }
    cyclic.cause = cyclic

    expect(isContextLengthExceeded(cyclic)).toBe(false)
  })

  test('tolerates non-error values', () => {
    expect(isContextLengthExceeded(undefined)).toBe(false)
    expect(isContextLengthExceeded(null)).toBe(false)
    expect(isContextLengthExceeded('context_length_exceeded')).toBe(false)
  })
})
