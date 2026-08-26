// The three refusals carry RECOVERY ADVICE THAT CAN ACTUALLY BE FOLLOWED.
//
// All three used to end with "Raise the limit in intentFulfilment", and for two of
// them that is impossible: `maxObligations` and `maxChangeLines` default to their
// schema ceiling, so an operator who hits one on a default configuration has no
// higher value to set. The advice sent them editing a setting that could not help
// while the run stayed refused — worse than saying nothing, because it looks like a
// fix.
//
// The first block pins the ceilings against the schema itself, so this file's own
// premise cannot rot: if a ceiling moves, the pin fails here rather than the advice
// going quietly wrong again somewhere a user reads it.

import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../../shared/contracts/index.js'
import {
  intentChangeTooLargeError,
  intentTooLargeError,
  tooManyObligationsError
} from './intent-limits.js'

const intentFulfilmentAccepts = (
  overrides: Readonly<Record<string, number>>
): boolean =>
  CodeReviewerConfigSchema.safeParse({
    intentFulfilment: { enabled: true, ...overrides }
  }).success

const defaults = CodeReviewerConfigSchema.parse({}).intentFulfilment

describe('the limits the refusals advise on', () => {
  test('maxObligations and maxChangeLines default to a value that cannot be raised', () => {
    // The premise of this whole file. Both defaults sit ON the schema ceiling, so
    // "raise the limit" is not an available remedy for either.
    expect(defaults.maxObligations).toBe(100)
    expect(intentFulfilmentAccepts({ maxObligations: 100 })).toBe(true)
    expect(intentFulfilmentAccepts({ maxObligations: 101 })).toBe(false)

    expect(defaults.maxChangeLines).toBe(5_000)
    expect(intentFulfilmentAccepts({ maxChangeLines: 5_000 })).toBe(true)
    expect(intentFulfilmentAccepts({ maxChangeLines: 5_001 })).toBe(false)
  })

  test('maxIntentBytes is the one limit with headroom above its default', () => {
    expect(defaults.maxIntentBytes).toBe(100_000)
    expect(intentFulfilmentAccepts({ maxIntentBytes: 200_000 })).toBe(true)
    expect(intentFulfilmentAccepts({ maxIntentBytes: 200_001 })).toBe(false)
  })
})

describe('recovery advice is possible to follow', () => {
  test('no refusal recommends raising a limit that is already at its ceiling', () => {
    const messages = [
      intentChangeTooLargeError({
        changedLineCount: 9_000,
        maxChangeLines: defaults.maxChangeLines
      }).message,
      tooManyObligationsError({
        obligationCount: 100,
        maxObligations: defaults.maxObligations
      }).message,
      intentTooLargeError({
        intentBytes: 250_000,
        maxIntentBytes: 200_000
      }).message
    ]

    for (const message of messages) {
      expect(message).not.toMatch(/Raise intentFulfilment/u)
      expect(message).toMatch(/cannot be raised/u)
    }
  })

  test('the changed-line refusal at the ceiling points at the change, not the config', () => {
    const error = intentChangeTooLargeError({
      changedLineCount: 9_000,
      maxChangeLines: defaults.maxChangeLines
    })

    expect(error.code).toBe('intent_change_too_large')
    expect(error.exitCode).toBe(4)
    expect(error.message).toContain('Nothing was truncated.')
    expect(error.message).toContain(
      'intentFulfilment.maxChangeLines is already at its maximum (5000) and cannot be raised'
    )
    expect(error.message).toContain('narrow the base/head range')
  })

  test('the obligation refusal at the ceiling points at the stated intent', () => {
    const error = tooManyObligationsError({
      obligationCount: 100,
      maxObligations: defaults.maxObligations
    })

    expect(error.code).toBe('intent_too_many_obligations')
    expect(error.message).toContain(
      'intentFulfilment.maxObligations is already at its maximum (100) and cannot be raised'
    )
    expect(error.message).toContain('smaller slice of the stated intent')
  })

  test('a limit below its ceiling is told it can be raised, and how far', () => {
    // The advice is not blanket-suppressed: a limit the operator lowered still has
    // headroom, and raising it back is the cheapest remedy there is.
    expect(
      tooManyObligationsError({ obligationCount: 20, maxObligations: 20 }).message
    ).toContain('Raise intentFulfilment.maxObligations (up to 100)')
    expect(
      intentChangeTooLargeError({
        changedLineCount: 900,
        maxChangeLines: 400
      }).message
    ).toContain('Raise intentFulfilment.maxChangeLines (up to 5000)')
    expect(
      intentTooLargeError({
        intentBytes: 150_000,
        maxIntentBytes: defaults.maxIntentBytes
      }).message
    ).toContain('Raise intentFulfilment.maxIntentBytes (up to 200000)')
  })

  test('every refusal still names its code, its bound, and the input that exceeded it', () => {
    // Spec 23: "Each refusal MUST name its own error code, the value that bound,
    // and the input that exceeded it." Rewriting the recovery text must not cost
    // any of the three.
    const change = intentChangeTooLargeError({
      changedLineCount: 9_000,
      maxChangeLines: 5_000
    })
    const intent = intentTooLargeError({
      intentBytes: 250_000,
      maxIntentBytes: 200_000
    })
    const obligations = tooManyObligationsError({
      obligationCount: 100,
      maxObligations: 100
    })

    expect(change.message).toContain('9000')
    expect(change.details).toMatchObject({
      changedLineCount: 9_000,
      maxChangeLines: 5_000
    })
    expect(intent.code).toBe('intent_text_too_large')
    expect(intent.message).toContain('250000')
    expect(intent.details).toMatchObject({
      intentBytes: 250_000,
      maxIntentBytes: 200_000
    })
    expect(obligations.message).toContain('100')
    expect(obligations.details).toMatchObject({
      obligationCount: 100,
      maxObligations: 100
    })
    for (const error of [change, intent, obligations]) {
      expect(error.exitCode).toBe(4)
      // Its own category, not 'config': spec 23 requires these refusals to exit 4,
      // and the exit code is derived from the category rather than hand-typed
      // beside it.
      expect(error.category).toBe('input-limit')
    }
  })
})
