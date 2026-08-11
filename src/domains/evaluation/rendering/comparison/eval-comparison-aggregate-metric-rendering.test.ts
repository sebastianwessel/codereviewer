import { describe, expect, test } from 'vitest'
import { appendEvalComparisonMetricDeltas } from './eval-comparison-aggregate-metric-rendering.js'
import { metricComparability } from '../../report/versions/eval-metrics-versions.js'
import { EVAL_METRICS_VERSION } from '../../report/eval-report-contracts.js'
import { type EvalComparisonMetrics } from '../../report/eval-comparison-view.js'

const comparability = metricComparability(
  EVAL_METRICS_VERSION,
  EVAL_METRICS_VERSION
)

const rowsFor = (
  base: EvalComparisonMetrics | undefined,
  head: EvalComparisonMetrics | undefined
): readonly string[] => {
  const lines: string[] = []
  appendEvalComparisonMetricDeltas(lines, {
    base: { metricsVersion: EVAL_METRICS_VERSION, ...(base && { metrics: base }) },
    head: { metricsVersion: EVAL_METRICS_VERSION, ...(head && { metrics: head }) },
    comparability
  })

  return lines
}

const rowStartingWith = (
  lines: readonly string[],
  metric: string
): string | undefined => lines.find((line) => line.startsWith(`| ${metric} |`))

describe('eval comparison aggregate metric rendering', () => {
  test('exports the aggregate metric-delta renderer', () => {
    expect(typeof appendEvalComparisonMetricDeltas).toBe('function')
  })

  // A fix-lane rate has three distinguishable states in a comparison, and
  // collapsing any two of them republishes an absent measurement as a number.
  describe('fix-lane rates', () => {
    test('renders a rate the run measured on both sides, with its delta', () => {
      expect(
        rowStartingWith(
          rowsFor({ fixProduceRate: 0.5 }, { fixProduceRate: 0.75 }),
          'Fix produce rate'
        )
      ).toBe('| Fix produce rate | 50.0% | 75.0% | +25.0pp |')
    })

    // `null` is "the lane produced nothing to measure", which is every run with
    // `fix.enabled` off. It must not render as 0.0%, and differencing it against
    // a real rate would publish movement between a measurement and its absence.
    test('renders an unmeasured side as n/a and refuses its delta', () => {
      expect(
        rowStartingWith(
          rowsFor({ fixProduceRate: null }, { fixProduceRate: 0.75 }),
          'Fix produce rate'
        )
      ).toBe('| Fix produce rate | n/a | 75.0% | n/a |')
    })

    // `undefined` is a third statement again: the report never recorded the
    // rate. It reads as unknown rather than as n/a, because "nobody wrote it
    // down" is not "the lane measured nothing".
    test('renders a rate the report never recorded as unknown', () => {
      const row = rowStartingWith(rowsFor({}, {}), 'Fix judgment accuracy')

      expect(row).toContain('unknown (not recorded)')
      expect(row).not.toContain('0.0%')
      expect(row).not.toContain('n/a')
    })
  })
})
