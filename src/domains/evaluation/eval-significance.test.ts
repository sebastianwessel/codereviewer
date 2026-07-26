import { describe, expect, test } from 'vitest'
import {
  collectArmOutcomes,
  compareArms,
  expectationKey,
  type ArmOutcomes
} from './eval-significance.js'
import { type EvalReport } from './eval-report-contracts.js'

// A report carrying only the fields the paired comparison reads. The comparison
// deliberately depends on the per-expectation outcome and nothing else, so a
// fixture that fabricated whole reports would test the schema, not the statistic.
const reportWith = (
  cases: readonly {
    readonly caseId: string
    readonly expectedIndexes: readonly number[]
    readonly matchedIndexes: readonly number[]
  }[],
  metricsVersion = 'test-metrics-version'
): EvalReport =>
  ({
    metricsVersion,
    caseResults: cases.map((entry) => ({
      caseId: entry.caseId,
      expectedFindings: entry.expectedIndexes.map((expectedIndex) => ({
        expectedIndex
      })),
      matchedFindings: entry.matchedIndexes.map((expectedIndex) => ({
        expectedIndex
      }))
    }))
  }) as unknown as EvalReport

const arm = (
  reports: readonly {
    readonly caseId: string
    readonly expectedIndexes: readonly number[]
    readonly matchedIndexes: readonly number[]
  }[][]
  // Passing `reportWith` directly to `map` would hand it the array index as the
  // metrics version, giving every run a different one.
): ArmOutcomes => collectArmOutcomes(reports.map((report) => reportWith(report)))

describe('expectation outcome collection', () => {
  test('records a hit rate per expectation across an arm’s runs', () => {
    const outcomes = arm([
      [{ caseId: 'a', expectedIndexes: [0, 1], matchedIndexes: [0] }],
      [{ caseId: 'a', expectedIndexes: [0, 1], matchedIndexes: [0, 1] }]
    ])

    expect(outcomes.runCount).toBe(2)
    expect(outcomes.hitRateByExpectation.get(expectationKey('a', 0))).toBe(1)
    expect(outcomes.hitRateByExpectation.get(expectationKey('a', 1))).toBe(0.5)
  })
})

describe('scoring-rule compatibility', () => {
  // A metrics-version change alters what a metric reports for identical review
  // output, so pooling across one measures the scoring change rather than the
  // engine. This repository has already published a number that was scored
  // against a stale answer key with nothing in the artifact revealing it.
  test('refuses to pool runs scored by different rules', () => {
    expect(() =>
      collectArmOutcomes([
        reportWith([{ caseId: 'a', expectedIndexes: [0], matchedIndexes: [0] }], 'v1'),
        reportWith([{ caseId: 'a', expectedIndexes: [0], matchedIndexes: [0] }], 'v2')
      ])
    ).toThrow(/different rules/u)
  })

  test('pools runs that share a scoring version', () => {
    expect(() =>
      collectArmOutcomes([
        reportWith([{ caseId: 'a', expectedIndexes: [0], matchedIndexes: [0] }], 'v1'),
        reportWith([{ caseId: 'a', expectedIndexes: [0], matchedIndexes: [] }], 'v1')
      ])
    ).not.toThrow()
  })
})

describe('paired arm comparison', () => {
  test('reports the delta and which expectations moved', () => {
    const base = arm([
      [{ caseId: 'a', expectedIndexes: [0, 1, 2], matchedIndexes: [0] }]
    ])
    const head = arm([
      [{ caseId: 'a', expectedIndexes: [0, 1, 2], matchedIndexes: [0, 1] }]
    ])
    const result = compareArms(base, head)

    expect(result.expectationCount).toBe(3)
    expect(result.baseRecall).toBeCloseTo(1 / 3)
    expect(result.headRecall).toBeCloseTo(2 / 3)
    expect(result.delta).toBeCloseTo(1 / 3)
    expect(result.gained).toEqual([expectationKey('a', 1)])
    expect(result.lost).toEqual([])
    expect(result.alwaysFound).toBe(1)
    expect(result.neverFound).toBe(1)
  })

  // The point of pairing: expectations both arms agree on carry no information
  // about the change, and a test that ignores that is testing mostly noise.
  test('counts only discordant expectations toward the statistic', () => {
    const base = arm([
      [{ caseId: 'a', expectedIndexes: [0, 1, 2, 3], matchedIndexes: [0, 1] }]
    ])
    const head = arm([
      [{ caseId: 'a', expectedIndexes: [0, 1, 2, 3], matchedIndexes: [0, 2] }]
    ])
    const result = compareArms(base, head)

    // One gained, one lost: a wash, and the statistic must say so rather than
    // reporting a difference because the matched set changed identity.
    expect(result.discordantCount).toBe(2)
    expect(result.delta).toBe(0)
    expect(result.z).toBe(0)
    expect(result.pValue).toBeCloseTo(1)
  })

  test('leaves the statistic undefined when nothing moved', () => {
    const identical = [
      { caseId: 'a', expectedIndexes: [0, 1], matchedIndexes: [0] }
    ]
    const result = compareArms(arm([identical]), arm([identical]))

    // Zero discordant pairs makes McNemar undefined, not significant.
    expect(result.discordantCount).toBe(0)
    expect(result.z).toBeUndefined()
    expect(result.pValue).toBeUndefined()
  })

  test('detects a consistent one-sided improvement', () => {
    const expectedIndexes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    const base = arm([[{ caseId: 'a', expectedIndexes, matchedIndexes: [0] }]])
    const head = arm([
      [
        {
          caseId: 'a',
          expectedIndexes,
          matchedIndexes: [0, 1, 2, 3, 4, 5, 6, 7]
        }
      ]
    ])
    const result = compareArms(base, head)

    expect(result.gained).toHaveLength(7)
    expect(result.lost).toEqual([])
    expect(result.pValue).toBeLessThan(0.05)
    // The interval must exclude zero when every discordant expectation moved the
    // same way.
    expect(result.ci95[0]).toBeGreaterThan(0)
  })

  // Comparing arms scored against different answer keys is the failure this
  // repository already hit once, when a stale hydrated slice was scored against a
  // key that no longer matched the manifest.
  test('flags expectations only one arm scored instead of silently dropping them', () => {
    const base = arm([[{ caseId: 'a', expectedIndexes: [0], matchedIndexes: [0] }]])
    const head = arm([
      [{ caseId: 'a', expectedIndexes: [0, 1], matchedIndexes: [0] }]
    ])
    const result = compareArms(base, head)

    expect(result.unpairedExpectations).toEqual([expectationKey('a', 1)])
    expect(result.expectationCount).toBe(1)
  })

  test('produces a byte-identical interval on repeated invocations', () => {
    const base = arm([
      [{ caseId: 'a', expectedIndexes: [0, 1, 2, 3], matchedIndexes: [0] }]
    ])
    const head = arm([
      [{ caseId: 'a', expectedIndexes: [0, 1, 2, 3], matchedIndexes: [0, 1, 2] }]
    ])

    // The bootstrap is seeded: an interval that moved between runs on identical
    // input would make every comparison irreproducible.
    expect(compareArms(base, head).ci95).toEqual(compareArms(base, head).ci95)
  })
})
