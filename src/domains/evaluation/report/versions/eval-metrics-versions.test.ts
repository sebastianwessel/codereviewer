import { describe, expect, test } from 'vitest'
import {
  EVAL_METRICS_VERSION,
  EVAL_METRICS_VERSION_HISTORY,
  metricComparability,
  metricsAffectedBetween
} from './eval-metrics-versions.js'

describe('evaluation metrics-version history', () => {
  test('the current version is the newest declared history entry', () => {
    expect(EVAL_METRICS_VERSION).toBe(
      EVAL_METRICS_VERSION_HISTORY.at(-1)?.id
    )
  })

  test('declares every version id exactly once', () => {
    const ids = EVAL_METRICS_VERSION_HISTORY.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('nothing is affected when both reports scored under the same rules', () => {
    expect(metricsAffectedBetween(EVAL_METRICS_VERSION, EVAL_METRICS_VERSION))
      .toEqual({ kind: 'same' })
  })

  // The bump the instrument actually has to span today. Its own recorded
  // rationale is that it changes which unmatched findings are credited
  // unlisted-real for IDENTICAL review output -- which touches the precision
  // upper bound and the two counts behind it, and nothing else.
  test('the plausibility-source-window bump affects exactly three metrics', () => {
    const divergence = metricsAffectedBetween(
      '2026-08-01.discovery-telemetry',
      '2026-08-03.plausibility-source-window'
    )

    expect(divergence.kind).toBe('partial')
    expect(
      divergence.kind === 'partial' ? [...divergence.affected].sort() : []
    ).toEqual([
      'adjustedPrecision',
      'genuineFalsePositiveCount',
      'unlistedRealFindingCount'
    ])
  })

  test('recall and raw precision survive that bump', () => {
    const comparability = metricComparability(
      '2026-08-01.discovery-telemetry',
      '2026-08-03.plausibility-source-window'
    )

    expect(comparability.refusalReason('recall')).toBeUndefined()
    expect(comparability.refusalReason('precision')).toBeUndefined()
    expect(comparability.refusalReason('linePlacementRate')).toBeUndefined()
    expect(comparability.refusalReason('severityAccuracy')).toBeUndefined()
    expect(comparability.refusalReason('adjustedPrecision')).toBeDefined()
  })

  // The affected SET is order-insensitive; only the human-readable reason names
  // the two versions in the caller's own order.
  test('is order-insensitive: an older head crosses the same boundaries', () => {
    const forward = metricComparability(
      '2026-08-01.discovery-telemetry',
      '2026-08-03.plausibility-source-window'
    )
    const reversed = metricComparability(
      '2026-08-03.plausibility-source-window',
      '2026-08-01.discovery-telemetry'
    )

    for (const key of ['recall', 'precision', 'adjustedPrecision'] as const) {
      expect(reversed.refusalReason(key) === undefined).toBe(
        forward.refusalReason(key) === undefined
      )
    }
  })

  // Crossing several bumps accumulates their declared sets.
  test('accumulates the affected sets of every version crossed', () => {
    const divergence = metricsAffectedBetween(
      '2026-07-27.plausibility-restatement-collapse',
      '2026-08-03.plausibility-source-window'
    )

    expect(divergence.kind).toBe('partial')
    expect(
      divergence.kind === 'partial' ? [...divergence.affected].sort() : []
    ).toEqual([
      'adjustedPrecision',
      'diffScopeCounts',
      'discovery',
      'genuineFalsePositiveCount',
      'recallByDiffScope',
      'unlistedRealFindingCount'
    ])
  })

  // An unbounded change is unbounded: nothing survives it.
  test('refuses every metric across a version declared as changing everything', () => {
    const divergence = metricsAffectedBetween(
      'pre-2026-07-26',
      '2026-08-03.plausibility-source-window'
    )

    expect(divergence.kind).toBe('all')
    expect(
      metricComparability(
        'pre-2026-07-26',
        '2026-08-03.plausibility-source-window'
      ).refusalReason('recall')
    ).toBeDefined()
  })

  // Guessing narrow for an id nobody declared would publish a delta measured
  // across an unknown ruler change, which is the failure this exists to stop.
  test('refuses every metric when a version is absent from the history', () => {
    const divergence = metricsAffectedBetween(
      EVAL_METRICS_VERSION,
      'some-unreleased-build'
    )

    expect(divergence.kind).toBe('all')
    expect(divergence.kind === 'all' ? divergence.reason : '').toContain(
      'not in the declared scoring-rule history'
    )
  })
})
