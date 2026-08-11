import {
  appendMarkdownTable,
  formatCostMetric,
  formatDurationMetric,
  formatNumberDelta,
  formatPercent,
  formatPercentagePointDelta,
  formatPrecisionBracket,
  formatRateOverCount,
  formatTokenMetric,
  UNKNOWN_VALUE
} from '../eval-report-markdown-formatting.js'
import {
  type EvalComparabilityKey,
  type MetricComparability
} from '../../report/versions/eval-metrics-versions.js'
import {
  precisionBracket,
  type PrecisionBracket
} from '../../scoring/eval-precision-bracket.js'
import {
  type EvalComparisonMetrics,
  type EvalComparisonReport
} from '../../report/eval-comparison-view.js'

// A value both reports recorded, whose difference means nothing because the
// scoring rules changed between them. The values still print -- they are facts
// about each run -- but the delta does not.
const NOT_COMPARABLE = 'not comparable'

export type EvalComparisonInput = {
  readonly base: EvalComparisonReport
  readonly head: EvalComparisonReport
  readonly comparability: MetricComparability
}

const formatRow = (
  input: {
    readonly metric: string
    readonly base: string
    readonly head: string
    readonly delta: string
  }
): string =>
  `| ${input.metric} | ${input.base} | ${input.head} | ${input.delta} |`

// Metrics of the view that are a plain number and never `null`, so one row
// renderer can serve them all. Derived from the view rather than listed, so a
// metric added there with the wrong shape cannot be routed through a numeric row
// by mistake.
//
// `Exclude<..., undefined>` rather than `NonNullable<...>`: a NULLABLE rate
// (`number | null | undefined`) must NOT land here, because these rows print a
// number for every recorded value and would render "not measured" as 0.0% --
// which is the exact defect the nullable rates exist to remove. `NonNullable`
// strips the `null` too and would have admitted them silently.
type ScalarMetricKey = {
  [Key in keyof EvalComparisonMetrics]-?: Exclude<
    EvalComparisonMetrics[Key],
    undefined
  > extends number
    ? Key
    : never
}[keyof EvalComparisonMetrics]

// The complement: metrics whose recorded value may be `null`. Kept as its own
// key set so a nullable rate can only be rendered by the row below, which
// distinguishes "measured nothing" from "never recorded" from a real rate.
type NullableRateMetricKey = {
  [Key in keyof EvalComparisonMetrics]-?: null extends EvalComparisonMetrics[Key]
    ? NonNullable<EvalComparisonMetrics[Key]> extends number
      ? Key
      : never
    : never
}[keyof EvalComparisonMetrics]

type ScalarMetricRowInput = {
  readonly metric: string
  readonly key: ScalarMetricKey
  readonly base: number | undefined
  readonly head: number | undefined
}

type ScalarMetricRowRenderer = (
  input: ScalarMetricRowInput,
  comparability: MetricComparability
) => string

type ScalarMetricRow = ScalarMetricRowInput & {
  readonly formatValue: (value: number) => string
  readonly formatDelta: (base: number, head: number) => string
}

// One rule for every scalar metric row, applied in one place so no metric can
// acquire a delta the data does not support: refused by the scoring-rule
// history, or missing on either side, and there is no number to print.
const formatScalarMetricRow = (
  row: ScalarMetricRow,
  comparability: MetricComparability
): string => {
  const refusal = comparability.refusalReason(row.key)

  return formatRow({
    metric: row.metric,
    base: row.base === undefined ? UNKNOWN_VALUE : row.formatValue(row.base),
    head: row.head === undefined ? UNKNOWN_VALUE : row.formatValue(row.head),
    delta:
      refusal !== undefined
        ? NOT_COMPARABLE
        : row.base === undefined || row.head === undefined
          ? UNKNOWN_VALUE
          : row.formatDelta(row.base, row.head)
  })
}

const percentRow: ScalarMetricRowRenderer = (input, comparability) =>
  formatScalarMetricRow(
    {
      ...input,
      formatValue: formatPercent,
      formatDelta: formatPercentagePointDelta
    },
    comparability
  )

const countRow: ScalarMetricRowRenderer = (input, comparability) =>
  formatScalarMetricRow(
    {
      ...input,
      formatValue: (value) => `${value}`,
      formatDelta: formatNumberDelta
    },
    comparability
  )

// A nullable rate, rendered on the same three-way terms `diffScopeRecallRow`
// below uses: `null` is "the run measured nothing here" (`n/a`), `undefined` is
// "the report never recorded it" (unknown), and only two real numbers produce a
// delta. Differencing against a null would publish movement between a
// measurement and its absence.
const nullableRateRow = (
  input: {
    readonly metric: string
    readonly key: NullableRateMetricKey
    readonly base: number | null | undefined
    readonly head: number | null | undefined
  },
  comparability: MetricComparability
): string => {
  const formatSide = (value: number | null | undefined): string =>
    value === undefined ? UNKNOWN_VALUE : value === null ? 'n/a' : formatPercent(value)

  return formatRow({
    metric: input.metric,
    base: formatSide(input.base),
    head: formatSide(input.head),
    delta:
      comparability.refusalReason(input.key) !== undefined
        ? NOT_COMPARABLE
        : input.base === undefined || input.head === undefined
          ? UNKNOWN_VALUE
          : input.base === null || input.head === null
            ? 'n/a'
            : formatPercentagePointDelta(input.base, input.head)
  })
}

// Diff-scope recall (spec 17) is nullable per side: a run whose fixture set
// carries no expectation in a population measured nothing there. `null` (nothing
// to measure) and `undefined` (never recorded) are different statements and are
// rendered differently, and neither produces a delta.
const diffScopeRecallRow = (
  input: {
    readonly metric: string
    readonly base: EvalComparisonMetrics | undefined
    readonly head: EvalComparisonMetrics | undefined
    readonly scope: string
  },
  comparability: MetricComparability
): string => {
  const readRate = (
    metrics: EvalComparisonMetrics | undefined
  ): number | null | undefined => metrics?.recallByDiffScope?.[input.scope]
  const readCount = (
    metrics: EvalComparisonMetrics | undefined
  ): number | undefined => metrics?.diffScopeCounts?.[input.scope]?.expected
  const baseRate = readRate(input.base)
  const headRate = readRate(input.head)
  const baseCount = readCount(input.base)
  const headCount = readCount(input.head)
  const refusal = comparability.refusalReason('recallByDiffScope')
  const formatSide = (
    rate: number | null | undefined,
    count: number | undefined
  ): string =>
    rate === undefined || count === undefined
      ? UNKNOWN_VALUE
      : formatRateOverCount(rate, count)

  return formatRow({
    metric: input.metric,
    base: formatSide(baseRate, baseCount),
    head: formatSide(headRate, headCount),
    delta:
      refusal !== undefined
        ? NOT_COMPARABLE
        : baseRate === undefined ||
            headRate === undefined ||
            baseCount === undefined ||
            headCount === undefined
          ? UNKNOWN_VALUE
          : baseRate === null ||
              headRate === null ||
              baseCount === 0 ||
              headCount === 0
            ? 'n/a'
            : formatPercentagePointDelta(baseRate, headRate)
  })
}

const costRow = (
  input: EvalComparisonInput
): string => {
  const format = (
    metrics: EvalComparisonMetrics | undefined
  ): string =>
    metrics?.costUsd === undefined || metrics.costUnavailableCount === undefined
      ? UNKNOWN_VALUE
      : formatCostMetric({
          costUsd: metrics.costUsd,
          costUnavailableCount: metrics.costUnavailableCount
        })
  const baseCost = input.base.metrics?.costUsd
  const headCost = input.head.metrics?.costUsd

  return formatRow({
    metric: 'Cost',
    base: format(input.base.metrics),
    head: format(input.head.metrics),
    delta:
      input.comparability.refusalReason('costUsd') !== undefined
        ? NOT_COMPARABLE
        : baseCost === undefined || headCost === undefined
          ? UNKNOWN_VALUE
          : formatNumberDelta(baseCost, headCost)
  })
}

// Summed review time, rendered on the same terms as cost: a run with an
// unmeasured case publishes a floor, not a total, and both sides must say so
// before their difference means anything.
const durationRow = (input: EvalComparisonInput): string => {
  const format = (
    metrics: EvalComparisonMetrics | undefined
  ): string =>
    metrics?.durationMs === undefined ||
    metrics.durationUnavailableCount === undefined
      ? UNKNOWN_VALUE
      : formatDurationMetric({
          durationMs: metrics.durationMs,
          durationUnavailableCount: metrics.durationUnavailableCount
        })
  const baseDuration = input.base.metrics?.durationMs
  const headDuration = input.head.metrics?.durationMs

  return formatRow({
    metric: 'Duration',
    base: format(input.base.metrics),
    head: format(input.head.metrics),
    delta:
      input.comparability.refusalReason('durationMs') !== undefined
        ? NOT_COMPARABLE
        : baseDuration === undefined || headDuration === undefined
          ? UNKNOWN_VALUE
          : `${formatNumberDelta(baseDuration, headDuration)}ms`
  })
}

// Token totals, rendered on the same terms as cost and duration: a run with a
// case that surfaced no usage record publishes a floor, and a token delta
// between two floors is not a token delta until both sides say so.
const tokenRow = (
  input: EvalComparisonInput,
  row: {
    readonly metric: string
    readonly key: 'inputTokens' | 'cachedInputTokens' | 'outputTokens'
  }
): string => {
  const format = (metrics: EvalComparisonMetrics | undefined): string => {
    const tokens = metrics?.[row.key]
    const unavailableCount = metrics?.usageUnavailableCount

    return tokens === undefined || unavailableCount === undefined
      ? UNKNOWN_VALUE
      : formatTokenMetric(tokens, { usageUnavailableCount: unavailableCount })
  }
  const baseTokens = input.base.metrics?.[row.key]
  const headTokens = input.head.metrics?.[row.key]

  return formatRow({
    metric: row.metric,
    base: format(input.base.metrics),
    head: format(input.head.metrics),
    delta:
      input.comparability.refusalReason(row.key) !== undefined
        ? NOT_COMPARABLE
        : baseTokens === undefined || headTokens === undefined
          ? UNKNOWN_VALUE
          : formatNumberDelta(baseTokens, headTokens)
  })
}

const comparisonPrecisionBracket = (
  report: EvalComparisonReport
): PrecisionBracket =>
  precisionBracket({
    precision: report.metrics?.precision,
    adjustedPrecision: report.metrics?.adjustedPrecision,
    plausibilityJudged: report.scoring?.plausibilityJudged,
    adjustedPrecisionTrustworthy: report.scoring?.adjustedPrecisionTrustworthy
  })

// Precision is published as its bracket and never as a point (see
// `eval-precision-bracket.ts`). The two bounds move for different reasons, so
// the delta cell reports them separately -- and the upper bound is exactly the
// quantity a plausibility-scoring change makes incomparable, which is why it can
// read `not comparable` while the lower bound still reports a delta.
const precisionBracketRow = (input: EvalComparisonInput): string => {
  const base = comparisonPrecisionBracket(input.base)
  const head = comparisonPrecisionBracket(input.head)
  const boundDelta = (
    key: EvalComparabilityKey,
    baseBound: PrecisionBracket['lower'],
    headBound: PrecisionBracket['upper']
  ): string =>
    input.comparability.refusalReason(key) !== undefined
      ? NOT_COMPARABLE
      : baseBound.status === 'known' && headBound.status === 'known'
        ? formatPercentagePointDelta(baseBound.value, headBound.value)
        : UNKNOWN_VALUE

  return formatRow({
    metric: 'Precision (raw to adjusted bracket)',
    base: formatPrecisionBracket(base),
    head: formatPrecisionBracket(head),
    delta: `lower ${boundDelta('precision', base.lower, head.lower)}; upper ${boundDelta(
      'adjustedPrecision',
      base.upper,
      head.upper
    )}`
  })
}

export const appendEvalComparisonMetricDeltas = (
  lines: string[],
  input: EvalComparisonInput
): void => {
  const base = input.base.metrics
  const head = input.head.metrics
  const comparability = input.comparability
  const scalar = (
    metric: string,
    key: ScalarMetricKey,
    render: ScalarMetricRowRenderer
  ): string =>
    render({ metric, key, base: base?.[key], head: head?.[key] }, comparability)
  const nullableRate = (metric: string, key: NullableRateMetricKey): string =>
    nullableRateRow(
      { metric, key, base: base?.[key], head: head?.[key] },
      comparability
    )

  appendMarkdownTable(lines, {
    heading: '## Metric Deltas',
    header: '| Metric | Base | Head | Delta |',
    alignment: '| --- | ---: | ---: | ---: |',
    rows: [
      scalar('Recall', 'recall', percentRow),
      diffScopeRecallRow(
        {
          metric: 'Recall (in-diff)',
          base,
          head,
          scope: 'in-diff'
        },
        comparability
      ),
      diffScopeRecallRow(
        {
          metric: 'Recall (out-of-diff)',
          base,
          head,
          scope: 'out-of-diff'
        },
        comparability
      ),
      precisionBracketRow(input),
      scalar('F1', 'f1', percentRow),
      scalar('Severity weighted F1', 'severityWeightedF1', percentRow),
      scalar('False positives', 'falsePositiveCount', countRow),
      scalar(
        'Genuine false positives',
        'genuineFalsePositiveCount',
        countRow
      ),
      scalar(
        'Unmatched but plausible',
        'unlistedRealFindingCount',
        countRow
      ),
      scalar(
        'Plausibility judge agreement',
        'plausibilityJudgeAgreement',
        percentRow
      ),
      scalar('Security obvious recall', 'securityObviousRecall', percentRow),
      scalar('Security hard recall', 'securityHardRecall', percentRow),
      scalar('Provider error rate', 'providerErrorRate', percentRow),
      scalar('Provider issue rate', 'providerIssueRate', percentRow),
      scalar('Provider issue cases', 'providerIssueCount', countRow),
      scalar(
        'Refutation false negatives',
        'refutationFalseNegativeCount',
        countRow
      ),
      scalar(
        'Refutation false positives',
        'refutationFalsePositiveCount',
        countRow
      ),
      nullableRate('Fix judgment accuracy', 'fixJudgmentAccuracy'),
      nullableRate(
        'Fix false-positive detection rate',
        'fixFalsePositiveDetectionRate'
      ),
      nullableRate('Fix produce rate', 'fixProduceRate'),
      nullableRate('Fix apply failure rate', 'fixApplyFailureRate'),
      durationRow(input),
      scalar(
        'Duration unavailable cases',
        'durationUnavailableCount',
        countRow
      ),
      tokenRow(input, { metric: 'Input tokens', key: 'inputTokens' }),
      tokenRow(input, {
        metric: 'Input tokens (cached)',
        key: 'cachedInputTokens'
      }),
      tokenRow(input, { metric: 'Output tokens', key: 'outputTokens' }),
      scalar('Usage unavailable cases', 'usageUnavailableCount', countRow),
      costRow(input),
      scalar('Cost unavailable cases', 'costUnavailableCount', countRow)
    ]
  })
}
