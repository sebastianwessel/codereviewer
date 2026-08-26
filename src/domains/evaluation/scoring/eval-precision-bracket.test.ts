import { describe, expect, test } from 'vitest'
import { precisionBracket } from './eval-precision-bracket.js'

describe('precision bracket', () => {
  test('reports raw precision as the lower bound and adjusted as the upper', () => {
    expect(
      precisionBracket({
        precision: 0.44,
        adjustedPrecision: 0.83,
        plausibilityJudged: true,
        adjustedPrecisionTrustworthy: true
      })
    ).toEqual({
      lower: { status: 'known', value: 0.44 },
      upper: { status: 'known', value: 0.83 },
      upperTrustworthy: true
    })
  })

  // The engine sets `adjustedPrecision = precision` when no plausibility judge
  // ran. Publishing that as an upper bound would claim every unmatched finding
  // had been examined and rejected, when none was examined at all.
  test('the upper bound is not measured when no plausibility judge ran', () => {
    const bracket = precisionBracket({
      precision: 0.5,
      adjustedPrecision: 0.5,
      plausibilityJudged: false,
      adjustedPrecisionTrustworthy: true
    })

    expect(bracket.upper).toEqual({ status: 'not-measured' })
    expect(bracket.upperTrustworthy).toBe(false)
  })

  // A report saved before the run recorded whether a judge ran cannot answer
  // the question, and absence is not an answer.
  test('the upper bound is unknown when the report did not record whether a judge ran', () => {
    expect(
      precisionBracket({
        precision: 0.5,
        adjustedPrecision: 0.9,
        plausibilityJudged: undefined,
        adjustedPrecisionTrustworthy: true
      }).upper
    ).toEqual({ status: 'unknown' })
  })

  test('a judge below its calibration minimum leaves the upper bound untrusted', () => {
    expect(
      precisionBracket({
        precision: 0.5,
        adjustedPrecision: 0.9,
        plausibilityJudged: true,
        adjustedPrecisionTrustworthy: false
      }).upperTrustworthy
    ).toBe(false)
  })

  test('an unrecorded raw precision leaves the lower bound unknown', () => {
    expect(
      precisionBracket({
        precision: undefined,
        adjustedPrecision: 0.9,
        plausibilityJudged: true,
        adjustedPrecisionTrustworthy: true
      }).lower
    ).toEqual({ status: 'unknown' })
  })
})
