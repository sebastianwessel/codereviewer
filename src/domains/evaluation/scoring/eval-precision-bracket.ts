// PRECISION IS A BRACKET, NOT A POINT.
//
// Under an incomplete answer key precision is not identifiable. A reported
// finding that matches nothing is either a false positive or a real defect the
// fixture never listed, and no amount of scoring can tell those apart from the
// key alone. Raw `precision` charges every unmatched finding as wrong and is
// therefore the LOWER bound; `adjustedPrecision` credits the ones a second judge
// deemed genuine and is the UPPER bound.
//
// The two used to be separate metrics, which let whichever number suited a
// claim be quoted alone -- and the literature on incomplete judgments is clear
// that the upper end is the less trustworthy one, because condensed-list
// metrics overestimate a new system more than traditional metrics underestimate
// it. So the pair is the result. Nothing publishes one bound without the other.
//
// The upper bound is UNKNOWN, not equal to the lower bound, whenever no
// plausibility judge ran: the engine sets `adjustedPrecision = precision` in
// that case, and republishing that as an upper bound would claim every unmatched
// finding had been examined and rejected when none was examined at all.

export type PrecisionBracketInput = {
  readonly precision: number | undefined
  readonly adjustedPrecision: number | undefined
  // Whether a plausibility judge ran. `undefined` for a report saved before the
  // run recorded it, where the answer is genuinely unknown.
  readonly plausibilityJudged: boolean | undefined
  // `scoring.adjustedPrecisionTrustworthy`: the judge ran but scored below the
  // configured calibration minimum. The bound exists but must not be read as
  // reliable.
  readonly adjustedPrecisionTrustworthy: boolean | undefined
}

export type PrecisionBracketBound =
  | { readonly status: 'known'; readonly value: number }
  | { readonly status: 'not-measured' }
  | { readonly status: 'unknown' }

export type PrecisionBracket = {
  readonly lower: PrecisionBracketBound
  readonly upper: PrecisionBracketBound
  // True only when the upper bound is known AND its judge passed calibration.
  readonly upperTrustworthy: boolean
}

export const precisionBracket = (
  input: PrecisionBracketInput
): PrecisionBracket => {
  const lower: PrecisionBracketBound =
    input.precision === undefined
      ? { status: 'unknown' }
      : { status: 'known', value: input.precision }

  const upper: PrecisionBracketBound =
    input.plausibilityJudged === false
      ? { status: 'not-measured' }
      : input.plausibilityJudged === undefined || input.adjustedPrecision === undefined
        ? { status: 'unknown' }
        : { status: 'known', value: input.adjustedPrecision }

  return {
    lower,
    upper,
    upperTrustworthy:
      upper.status === 'known' && input.adjustedPrecisionTrustworthy === true
  }
}
