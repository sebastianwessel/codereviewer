import { describe, expect, test } from 'vitest'
import {
  CHANGE_IMPACT_METRICS_VERSION,
  CHANGE_IMPACT_METRICS_VERSION_HISTORY,
  changeImpactMetricComparability,
  changeImpactMetricsAffectedBetween
} from './change-impact-metrics-versions.js'
import {
  EVAL_METRICS_VERSION,
  EVAL_METRICS_VERSION_HISTORY
} from './eval-metrics-versions.js'

describe('change-impact metrics-version history', () => {
  test('the current version is the newest declared entry', () => {
    expect(CHANGE_IMPACT_METRICS_VERSION).toBe(
      CHANGE_IMPACT_METRICS_VERSION_HISTORY.at(-1)?.id
    )
  })

  test('declares every version id exactly once', () => {
    const ids = CHANGE_IMPACT_METRICS_VERSION_HISTORY.map((entry) => entry.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  test('every entry records what it changed, so a bump cannot land silently', () => {
    for (const entry of CHANGE_IMPACT_METRICS_VERSION_HISTORY) {
      expect(entry.note.length).toBeGreaterThan(20)
      expect(entry.affects === 'all' || Array.isArray(entry.affects)).toBe(true)
    }
  })

  // The two corpora answer different questions. Sharing one history would make
  // every bump on either side refuse comparisons on the other.
  test('shares no version id with the diff reviewer history', () => {
    const evalIds = new Set(EVAL_METRICS_VERSION_HISTORY.map((entry) => entry.id))

    for (const entry of CHANGE_IMPACT_METRICS_VERSION_HISTORY) {
      expect(evalIds.has(entry.id)).toBe(false)
    }

    expect(CHANGE_IMPACT_METRICS_VERSION).not.toBe(EVAL_METRICS_VERSION)
  })

  test('nothing is affected when both runs scored under the same rules', () => {
    expect(
      changeImpactMetricsAffectedBetween(
        CHANGE_IMPACT_METRICS_VERSION,
        CHANGE_IMPACT_METRICS_VERSION
      )
    ).toEqual({ kind: 'same' })
  })

  // Guessing narrow for an id nobody declared would publish a delta measured
  // across an unknown ruler change.
  test('refuses every key when a version is absent from the history', () => {
    const comparability = changeImpactMetricComparability(
      CHANGE_IMPACT_METRICS_VERSION,
      'some-unreleased-build'
    )

    expect(comparability.divergence.kind).toBe('all')
    expect(comparability.refusalReason('referenceRecall')).toBeDefined()
    expect(comparability.refusalReason('adjudicatedRecall')).toBeDefined()
    expect(comparability.refusalReason('precisionLowerBound')).toBeDefined()
  })

  // Refusing to compare across the diff reviewer's version ids is the point: a
  // change-impact report can never be read against an eval report's ruler.
  test('refuses a diff reviewer version id outright', () => {
    expect(
      changeImpactMetricsAffectedBetween(
        CHANGE_IMPACT_METRICS_VERSION,
        EVAL_METRICS_VERSION
      ).kind
    ).toBe('all')
  })
})
