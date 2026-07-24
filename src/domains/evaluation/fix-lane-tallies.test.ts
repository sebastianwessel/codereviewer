import { describe, expect, test } from 'vitest'
import { fixLaneCaseTallies } from './eval-runner.js'
import type { EvalMatcherResult } from './eval-matcher.js'

// A matcher result carrying only the fields the fix-lane tally reads; the rest
// are empty. `matches` are true positives; `falsePositiveFindingIds` is the raw
// unmatched actionable set (before the plausibility judge splits it).
const matchResult = (input: {
  readonly matchedIds: readonly string[]
  readonly falsePositiveIds: readonly string[]
}): EvalMatcherResult => ({
  matches: input.matchedIds.map((findingId, index) => ({
    expectedIndex: index,
    findingId,
    semanticReason: 'matched',
    lineOverlaps: false,
    severityMatches: true
  })),
  unmatchedExpectedIndexes: [],
  inconclusiveExpectedIndexes: [],
  inconclusiveFindingIds: [],
  inconclusiveMatches: [],
  duplicateFindingIds: [],
  falsePositiveFindingIds: [...input.falsePositiveIds],
  noFindingZoneFalsePositiveIds: []
})

describe('fixLaneCaseTallies', () => {
  test('restricts every denominator to fix-lane-eligible findings (those with an outcome)', () => {
    // Two matched findings, but the fix lane only acted on one (the other is
    // below fix.minSeverity, so it has no outcome). The denominator must count
    // only the eligible one, not both.
    const tallies = fixLaneCaseTallies({
      matchResult: matchResult({
        matchedIds: ['find_eligible', 'find_below_floor'],
        falsePositiveIds: []
      }),
      unlistedRealFindingIds: [],
      fixOutcomes: [
        {
          findingId: 'find_eligible',
          findingJudgment: 'real',
          fixProduced: true,
          applyCheck: 'passed'
        }
      ]
    })

    expect(tallies.fixRealFindingCount).toBe(1)
    expect(tallies.fixProducedForRealCount).toBe(1)
  })

  test('an unlisted-real finding judged real is agreement, not a miss (plausibility-corrected truth)', () => {
    // The finding matched no expected finding but the plausibility judge deemed
    // it a real-but-unlisted defect. The fix lane judging it `real` must count as
    // correct — the raw matched/unmatched truth would have scored it wrong.
    const tallies = fixLaneCaseTallies({
      matchResult: matchResult({
        matchedIds: [],
        falsePositiveIds: ['find_unlisted_real', 'find_noise']
      }),
      unlistedRealFindingIds: ['find_unlisted_real'],
      fixOutcomes: [
        {
          findingId: 'find_unlisted_real',
          findingJudgment: 'real',
          fixProduced: true,
          applyCheck: 'passed'
        },
        {
          findingId: 'find_noise',
          findingJudgment: 'false-positive',
          fixProduced: false,
          applyCheck: 'not-attempted'
        }
      ]
    })

    // Both judged and labeled; both judgments agree with the corrected truth.
    expect(tallies.fixJudgedLabeledCount).toBe(2)
    expect(tallies.fixJudgmentAgreementCount).toBe(2)
    // The unlisted-real finding is a real finding (and got a fix), not an FP.
    expect(tallies.fixRealFindingCount).toBe(1)
    expect(tallies.fixProducedForRealCount).toBe(1)
    // Only the genuine-noise finding is a ground-truth false positive, correctly
    // detected.
    expect(tallies.fixGroundTruthFalsePositiveCount).toBe(1)
    expect(tallies.fixFalsePositiveDetectedCount).toBe(1)
  })

  test('a fail-closed (not unlisted-real) unmatched finding stays a genuine false positive', () => {
    const tallies = fixLaneCaseTallies({
      matchResult: matchResult({
        matchedIds: [],
        falsePositiveIds: ['find_unjudged']
      }),
      // Not credited by the plausibility judge (fail-closed / spurious).
      unlistedRealFindingIds: [],
      fixOutcomes: [
        {
          findingId: 'find_unjudged',
          findingJudgment: 'false-positive',
          fixProduced: false,
          applyCheck: 'not-attempted'
        }
      ]
    })

    expect(tallies.fixGroundTruthFalsePositiveCount).toBe(1)
    expect(tallies.fixRealFindingCount).toBe(0)
  })
})
