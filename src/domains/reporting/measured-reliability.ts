// The measured accuracy figures every reader-facing surface quotes, in ONE place.
//
// WHY THIS MODULE EXISTS. Two surfaces print these rates — the review report
// (`markdown-reporter.ts`) and the pull-request comment
// (`scripts/github/summary-comment.ts`) — and they drifted apart exactly as a
// duplicated number always does: a re-baseline moved in-diff recall from 61.1% to
// 68.3%, the report was updated, the pull-request comment was not, and its own
// test pinned the superseded "3 in 5" in place so CI defended the drift. The
// report file had even carried a written warning about one file quoting two
// recall rates; the warning was not enough, because prose cannot be imported.
//
// So the numbers are data now. Both renderers derive their prose from the fields
// below, and `measured-reliability.test.ts` checks those fields against the ledger
// entry they cite AND renders both surfaces to prove the values reach each one. A
// re-baseline that updates one renderer and misses the other cannot happen: there
// is only one renderer-visible copy to update.
//
// EVERY FIELD BELOW IS A TRANSCRIPTION, never a calculation. Source:
// `reports/eval-results-ledger.md`, entry "2026-08-05 — stage 1 re-baselined after
// the instruction and disclosure changes", mirrored in
// `docs/05-quality/current-results.md`. Changing a field means new measurements
// were taken, and the ledger entry they came from must be recorded in the same
// commit.

export const measuredReliability = {
  /** The ledger entry every figure below is transcribed from. */
  ledgerEntryDate: '2026-08-05',
  /** The pinned engine SHA those runs were measured on. */
  engine: 'db78900',
  /** Cases in the real-repository corpus at the time of the runs. */
  corpusCaseCount: 37,
  /** Runs pooled into the means below. */
  runCount: 3,
  /** Mean in-diff recall, 66.7 / 66.7 / 71.7. */
  inDiffRecallPercent: 68.3,
  inDiffRecallStandardDeviationPp: 2.89,
  /**
   * Out-of-diff recall, a hard zero over a full denominator in all three runs —
   * measured, not missing. Kept as a pair rather than a percentage so it can only
   * ever be rendered with its denominator beside it.
   */
  outOfDiffRecallFound: 0,
  outOfDiffRecallTotal: 27,
  /** Mean adjusted precision, 95.2 / 100 / 93.5. */
  adjustedPrecisionPercent: 96.2
} as const

// The provider and model every published accuracy rate in this repository was
// measured on. Recorded from the eval artifacts themselves (`provenance.
// providerId` / `provenance.modelName` on the saved eval report), not from an
// environment file, so it is a property of the measurement rather than of
// whatever happens to be configured now.
//
// It sits beside the rates because it is part of the same claim: a rate quoted
// without the model invites the reader to assume it holds for theirs, and it does
// not. Changing it means new measurements were taken, and every rate above must be
// re-derived from those runs in the same commit.
export const MEASURED_ON_PROVIDER = 'openai'
export const MEASURED_ON_MODEL = 'gpt-5.3-codex'

// Prose renders a rounded fraction ("about 7 in 10") because a reader weighing a
// findings list does not carry a decimal. The fraction is DERIVED from the
// measured percentage rather than written down beside it, so a re-baseline moves
// both or neither — a stale "3 in 5" sitting under a fresh 68.3% is precisely the
// defect this module was cut out to end.
const roundedFraction = (percent: number, denominator: number): number =>
  Math.round((percent / 100) * denominator)

/** In-diff recall as a fraction of ten, for prose. */
export const inDiffRecallInTen = roundedFraction(
  measuredReliability.inDiffRecallPercent,
  10
)

/** The complement: what the same corpus says is MISSED inside the diff. */
export const inDiffMissesInTen = 10 - inDiffRecallInTen

/** Adjusted precision as a fraction of twenty, for prose. */
export const adjustedPrecisionInTwenty = roundedFraction(
  measuredReliability.adjustedPrecisionPercent,
  20
)

const numberWords = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten'
] as const

/**
 * The English word for a small count, so a derived figure can be written into a
 * sentence ("roughly three in ten are missed") without a second literal copy of it.
 */
export const numberWord = (value: number): string =>
  numberWords[value] ?? String(value)
