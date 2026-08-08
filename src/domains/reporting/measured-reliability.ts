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
// TWO MEASUREMENTS LIVE HERE, and they answer different questions. `measuredReliability`
// is stage 1's review recall and precision; `measuredIntentReliability` further down
// is the intent-fulfilment stage's, measured on its own corpus against its own answer
// key. They share this module because they share one failure mode — a published rate
// going stale where prose cannot import it — and nothing else. Neither may be quoted
// for the other's stage.
//
// EVERY FIELD IN EITHER ENTRY IS A TRANSCRIPTION, never a calculation. Source for the
// entry immediately below: `reports/eval-results-ledger.md`, entry "2026-08-05 —
// stage 1 re-baselined after the instruction and disclosure changes", mirrored in
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

// The intent-fulfilment stage's own measured error rates.
//
// A SEPARATE ENTRY, AND IT MUST STAY SEPARATE. These bound a different question
// from the rates above: whether an obligation this stage calls evidenced is really
// done, and whether a genuinely outstanding one reaches its list at all. They were
// measured on a different corpus against a different answer key, so a review recall
// or precision figure is not an intent figure and neither set may be derived from
// the other.
//
// PROVENANCE IS WEAKER HERE THAN ABOVE, which is stated rather than smoothed over:
// this round has no entry in `reports/eval-results-ledger.md`. Its scored output is
// recorded in commit `d046f44` ("feat(intent): print the measured error rates where
// the reader is") — the pre-registered round over the realistic corpus, at pinned
// engine `d29aa99`, that cleared all six of the stage's criteria and made it
// shippable as advisory. Every field below is transcribed from that commit.
// Changing one means a new round was run, and where that round's output is
// recorded must be named in the same commit.
//
// COUNTS RATHER THAN PERCENTAGES, because the prose renders both figures as ratios:
// a count divides into a ratio exactly, where a rounded percentage would leave the
// fraction rounding a rounding.
export const measuredIntentReliability = {
  /** Real changes in the round's corpus. */
  corpusCaseCount: 28,
  /** Runs of each case. */
  runCount: 2,
  /**
   * `false-satisfied`: obligations reported as evidenced that the answer key says
   * are still outstanding at head, over every obligation where that error was
   * available to make.
   */
  falseSatisfiedClaims: 18,
  falseSatisfiedOpportunities: 520,
  /**
   * Outstanding detection: obligations the answer key calls outstanding that the
   * round put on its list, over every obligation it calls outstanding. The
   * complement is what never reaches a reader at all.
   */
  outstandingDetected: 161,
  outstandingTotal: 179
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

// The same rule for the intent rates, which prose states as "about 1 in N": N is
// computed from the transcribed counts, so editing the counts and leaving a
// superseded ratio in the sentence beside them is not a state this module can reach.
const oneIn = (part: number, whole: number): number => Math.round(whole / part)

/**
 * How often an obligation reported as evidenced is in fact still outstanding: one
 * in this many. The rate that says a row here is not a certificate.
 */
export const falseSatisfiedOneIn = oneIn(
  measuredIntentReliability.falseSatisfiedClaims,
  measuredIntentReliability.falseSatisfiedOpportunities
)

/**
 * How often a genuinely outstanding obligation never reaches the list at all: one
 * in this many. The rate that says the list's silence is not a clearance.
 */
export const missedOutstandingOneIn = oneIn(
  measuredIntentReliability.outstandingTotal -
    measuredIntentReliability.outstandingDetected,
  measuredIntentReliability.outstandingTotal
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

/**
 * What an empty findings list means, in one sentence, for EVERY surface that
 * renders one.
 *
 * The numbers in this module were made data because prose cannot import a number.
 * This sentence is here for the same reason one step further out: the number was
 * shared and the SENTENCE around it was not, so `markdown-reporter.ts` and
 * `scripts/github/summary-comment.ts` each carried their own copy. They had
 * already diverged — "not looked for at all" against "not searched for at all",
 * "Read it as" against "read this as" — while the reporter's own comment claimed
 * the text was reused so the two could not drift apart. It was not, and they had.
 *
 * A reader meeting an empty list is the one reader most likely to take it as a
 * clearance, so the wording that refuses that reading is the last thing that
 * should exist in two editable copies.
 */
export const NOTHING_PROVED = `This run proved no defect it could act on. That is a statement about this search and not about the change: roughly ${numberWord(inDiffMissesInTen)} in ten defects inside the diff are missed on the measured corpus, and defects outside the diff are not looked for at all. Read it as "this search found nothing", never as "there is nothing to find".`

