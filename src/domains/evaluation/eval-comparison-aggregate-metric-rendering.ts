import {
  appendMarkdownTable,
  formatCostMetric,
  formatDuration,
  formatInteger,
  formatPercent
} from './eval-report-markdown-formatting.js'
import { type EvalReport } from './eval-report-contracts.js'

type EvalMetrics = EvalReport['metrics']

type EvalReportPair = {
  readonly base: EvalReport
  readonly head: EvalReport
}

const formatPercentagePointDelta = (base: number, head: number): string => {
  const delta = (head - base) * 100
  const sign = delta > 0 ? '+' : ''

  return `${sign}${delta.toFixed(1)}pp`
}

const formatNumberDelta = (base: number, head: number): string => {
  const delta = head - base
  const sign = delta > 0 ? '+' : ''

  return `${sign}${delta}`
}

const formatEvalComparisonMetricDeltaRow = (
  input: {
    readonly metric: string
    readonly base: string | number
    readonly head: string | number
    readonly delta: string | number
  }
): string =>
  `| ${input.metric} | ${input.base} | ${input.head} | ${input.delta} |`

const formatEvalComparisonPercentMetricDeltaRow = (
  input: {
    readonly metric: string
    readonly base: number
    readonly head: number
  }
): string =>
  formatEvalComparisonMetricDeltaRow({
    metric: input.metric,
    base: formatPercent(input.base),
    head: formatPercent(input.head),
    delta: formatPercentagePointDelta(input.base, input.head)
  })

const formatEvalComparisonCountMetricDeltaRow = (
  input: {
    readonly metric: string
    readonly base: number
    readonly head: number
  }
): string =>
  formatEvalComparisonMetricDeltaRow({
    metric: input.metric,
    base: input.base,
    head: input.head,
    delta: formatNumberDelta(input.base, input.head)
  })

const formatEvalComparisonIntegerMetricDeltaRow = (
  input: {
    readonly metric: string
    readonly base: number
    readonly head: number
  }
): string =>
  formatEvalComparisonMetricDeltaRow({
    metric: input.metric,
    base: formatInteger(input.base),
    head: formatInteger(input.head),
    delta: formatNumberDelta(input.base, input.head)
  })

const formatEvalComparisonDurationMetricDeltaRow = (
  input: {
    readonly metric: string
    readonly baseMs: number
    readonly headMs: number
  }
): string =>
  formatEvalComparisonMetricDeltaRow({
    metric: input.metric,
    base: formatDuration(input.baseMs),
    head: formatDuration(input.headMs),
    delta: `${formatNumberDelta(input.baseMs, input.headMs)}ms`
  })

const formatCostMetricDeltaCells = (
  base: EvalMetrics,
  head: EvalMetrics
): {
  readonly base: string
  readonly head: string
  readonly delta: string
} => ({
  base: formatCostMetric(base),
  head: formatCostMetric(head),
  delta: formatNumberDelta(base.costUsd, head.costUsd)
})

const formatEvalComparisonCostMetricDeltaRow = (
  input: {
    readonly metric: string
    readonly base: EvalMetrics
    readonly head: EvalMetrics
  }
): string => {
  const cells = formatCostMetricDeltaCells(input.base, input.head)
  return formatEvalComparisonMetricDeltaRow({
    metric: input.metric,
    base: cells.base,
    head: cells.head,
    delta: cells.delta
  })
}

export const appendEvalComparisonMetricDeltas = (
  lines: string[],
  input: EvalReportPair
): void => {
  appendMarkdownTable(lines, {
    heading: '## Metric Deltas',
    header: '| Metric | Base | Head | Delta |',
    alignment: '| --- | ---: | ---: | ---: |',
    rows: [
      formatEvalComparisonPercentMetricDeltaRow({
        metric: 'Recall',
        base: input.base.metrics.recall,
        head: input.head.metrics.recall
      }),
      formatEvalComparisonPercentMetricDeltaRow({
        metric: 'Precision',
        base: input.base.metrics.precision,
        head: input.head.metrics.precision
      }),
      formatEvalComparisonPercentMetricDeltaRow({
        metric: 'F1',
        base: input.base.metrics.f1,
        head: input.head.metrics.f1
      }),
      formatEvalComparisonPercentMetricDeltaRow({
        metric: 'Severity weighted F1',
        base: input.base.metrics.severityWeightedF1,
        head: input.head.metrics.severityWeightedF1
      }),
      formatEvalComparisonCountMetricDeltaRow({
        metric: 'False positives',
        base: input.base.metrics.falsePositiveCount,
        head: input.head.metrics.falsePositiveCount
      }),
      formatEvalComparisonPercentMetricDeltaRow({
        metric: 'Provider error rate',
        base: input.base.metrics.providerErrorRate,
        head: input.head.metrics.providerErrorRate
      }),
      formatEvalComparisonPercentMetricDeltaRow({
        metric: 'Provider issue rate',
        base: input.base.metrics.providerIssueRate,
        head: input.head.metrics.providerIssueRate
      }),
      formatEvalComparisonCountMetricDeltaRow({
        metric: 'Provider issue cases',
        base: input.base.metrics.providerIssueCount,
        head: input.head.metrics.providerIssueCount
      }),
      formatEvalComparisonCountMetricDeltaRow({
        metric: 'Refutation false negatives',
        base: input.base.metrics.refutationFalseNegativeCount,
        head: input.head.metrics.refutationFalseNegativeCount
      }),
      formatEvalComparisonCountMetricDeltaRow({
        metric: 'Refutation false positives',
        base: input.base.metrics.refutationFalsePositiveCount,
        head: input.head.metrics.refutationFalsePositiveCount
      }),
      formatEvalComparisonDurationMetricDeltaRow({
        metric: 'Duration',
        baseMs: input.base.metrics.durationMs,
        headMs: input.head.metrics.durationMs
      }),
      formatEvalComparisonIntegerMetricDeltaRow({
        metric: 'Input tokens',
        base: input.base.metrics.inputTokens,
        head: input.head.metrics.inputTokens
      }),
      formatEvalComparisonIntegerMetricDeltaRow({
        metric: 'Output tokens',
        base: input.base.metrics.outputTokens,
        head: input.head.metrics.outputTokens
      }),
      formatEvalComparisonCostMetricDeltaRow({
        metric: 'Cost',
        base: input.base.metrics,
        head: input.head.metrics
      }),
      formatEvalComparisonCountMetricDeltaRow({
        metric: 'Cost unavailable cases',
        base: input.base.metrics.costUnavailableCount,
        head: input.head.metrics.costUnavailableCount
      })
    ]
  })
}
