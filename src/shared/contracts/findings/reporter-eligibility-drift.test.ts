// The coverage rule for the one predicate every surface asks about a finding:
// may a reader be handed this as a defect?
//
// `isActionableFinding` answers it as `!== 'artifact-only'`, which is a DEFAULT:
// a value added to `ReporterEligibilitySchema` becomes actionable by arriving,
// with nothing to say the question was ever put. That is not hypothetical
// bookkeeping — the quality gate, the SARIF and markdown reporters, the eval
// tallies and the pull-request comment all read that one predicate, so a new
// member would silently fail a build, land on somebody's pull request, and enter
// a measured precision figure, all without a line of code changing.
//
// So the vocabulary is enumerated here and each member is classified by hand. A
// member added to the enum and not to this table fails this test in the commit
// that adds it, which is the cheapest place the decision can be taken.

import { describe, expect, test } from 'vitest'
import {
  isActionableFinding,
  isArtifactOnlyFinding,
  ReporterEligibilitySchema,
  type ReporterEligibility
} from './finding.schema.js'

/**
 * How each eligibility a finding may carry is treated by every consumer of
 * `isActionableFinding`.
 *
 * `actionable`: a reader is expected to act on it — it counts toward the quality
 * gate, is rendered as a defect, and joins the eval precision denominator.
 *
 * `artifact-only`: refutation could neither prove nor disprove the finding, so it
 * is kept as a question for a human in the run artifacts and excluded from all of
 * the above.
 */
const ELIGIBILITY_TREATMENT: Readonly<
  Record<ReporterEligibility, 'actionable' | 'artifact-only'>
> = {
  // Posted beside the code it describes.
  inline: 'actionable',
  // Listed in the summary because it has no place to land inline (an unmatched
  // location, or a comment budget already spent) — still a defect a reader acts on.
  'summary-only': 'actionable',
  'artifact-only': 'artifact-only'
}

describe('the actionable-finding predicate covers its own vocabulary', () => {
  test('every eligibility the contract admits is classified by hand', () => {
    const classified = new Set(Object.keys(ELIGIBILITY_TREATMENT))
    const unclassified = ReporterEligibilitySchema.options.filter(
      (eligibility) => !classified.has(eligibility)
    )

    expect(unclassified).toEqual([])
    // The mirror failure: an entry left behind after the value it names was
    // renamed or removed, which would leave the table looking complete while the
    // new spelling went unclassified.
    const admitted = new Set<string>(ReporterEligibilitySchema.options)
    expect(
      Object.keys(ELIGIBILITY_TREATMENT).filter(
        (eligibility) => !admitted.has(eligibility)
      )
    ).toEqual([])
  })

  test('the predicates agree with the classification for every member', () => {
    for (const eligibility of ReporterEligibilitySchema.options) {
      const finding = { reporterEligibility: eligibility }
      const expected = ELIGIBILITY_TREATMENT[eligibility] === 'actionable'

      expect(isActionableFinding(finding)).toBe(expected)
      expect(isArtifactOnlyFinding(finding)).toBe(!expected)
    }
  })
})
