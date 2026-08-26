import { describe, expect, test } from 'vitest'
import { falsePositiveJudgementWarnings } from './investigation-lanes.js'

// The fix lane forms a per-finding judgement and declines to write a fix when it
// is `false-positive`. That judgement reached `fix-report.json` and nothing a
// human reads, so a reviewer saw a finding presented as real while a second stage
// of this engine had disagreed with it in writing.
describe('a fix-lane false-positive judgement reaches the reader', () => {
  test('names every disputed finding', () => {
    const warnings = falsePositiveJudgementWarnings({
      fixOutcomes: [
        { findingId: 'find_a', findingJudgment: 'false-positive' },
        { findingId: 'find_b', findingJudgment: 'real' },
        { findingId: 'find_c', findingJudgment: 'false-positive' }
      ]
    } as never)

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('find_a')
    expect(warnings[0]).toContain('find_c')
    expect(warnings[0]).not.toContain('find_b')
    // The reader has to be told the finding SURVIVES the disagreement, or the
    // warning reads as a retraction the engine did not make.
    expect(warnings[0]).toContain('advisory')
  })

  test('says nothing when every judgement agrees', () => {
    expect(
      falsePositiveJudgementWarnings({
        fixOutcomes: [{ findingId: 'find_a', findingJudgment: 'real' }]
      } as never)
    ).toEqual([])
  })

  // A judgement the lane never formed is not a disagreement. Absent must not be
  // read as `false-positive`, which is the silent-optimism inversion.
  test('an absent judgement is not treated as a dispute', () => {
    expect(
      falsePositiveJudgementWarnings({
        fixOutcomes: [{ findingId: 'find_a' }]
      } as never)
    ).toEqual([])
    expect(falsePositiveJudgementWarnings(undefined)).toEqual([])
  })
})
