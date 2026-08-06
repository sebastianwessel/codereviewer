import {
  appendMarkdownTable,
  escapeMarkdownCell,
  formatCostMetric,
  formatInteger,
  formatPercent,
  formatPrecisionBracket
} from './eval-report-markdown-formatting.js'
import {
  type EvalComparabilityKey,
  type MetricComparability
} from './eval-metrics-versions.js'
import {
  precisionBracket,
  type PrecisionBracket
} from './eval-precision-bracket.js'
import {
  type EvalComparisonMetricGroup,
  type EvalComparisonMetrics,
  type EvalComparisonReport
} from './eval-comparison-view.js'

type EvalReportPair = {
  readonly base: EvalComparisonReport
  readonly head: EvalComparisonReport
}

const UNKNOWN_VALUE = 'unknown (not recorded)'
const NOT_COMPARABLE = 'not comparable'

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

const metricGroupKey = (group: EvalComparisonMetricGroup): string =>
  `${group.groupBy}\0${group.key}`

type ComparableMetricGroup = EvalComparisonMetricGroup & {
  readonly groupBy: 'sourceProfile' | 'language'
}

export type ComparableMetricGroupPair = {
  readonly base: ComparableMetricGroup
  readonly head: ComparableMetricGroup
}

const comparableMetricGroupDimensions = (
  group: EvalComparisonMetricGroup
): group is ComparableMetricGroup =>
  group.groupBy === 'sourceProfile' || group.groupBy === 'language'

export const comparableMetricGroups = (
  input: EvalReportPair
): ReadonlyArray<ComparableMetricGroupPair> => {
  const headGroups = new Map(
    (input.head.metricGroups ?? [])
      .filter(comparableMetricGroupDimensions)
      .map((group) => [metricGroupKey(group), group])
  )

  return (input.base.metricGroups ?? [])
    .filter(comparableMetricGroupDimensions)
    .flatMap((baseGroup) => {
      const headGroup = headGroups.get(metricGroupKey(baseGroup))
      return headGroup === undefined ? [] : [{ base: baseGroup, head: headGroup }]
    })
    .sort((left, right) => {
      const groupOrder = left.base.groupBy.localeCompare(right.base.groupBy)
      return groupOrder === 0
        ? left.base.key.localeCompare(right.base.key)
        : groupOrder
    })
}

export const metricGroupCoverageDeltas = (
  input: EvalReportPair
): ReadonlyArray<{
  readonly groupBy: 'sourceProfile' | 'language'
  readonly key: string
  readonly baseFixtureCount: number | undefined
  readonly headFixtureCount: number | undefined
  readonly status: 'new' | 'removed' | 'changed'
}> => {
  const baseGroups = new Map(
    (input.base.metricGroups ?? [])
      .filter(comparableMetricGroupDimensions)
      .map((group) => [metricGroupKey(group), group])
  )
  const headGroups = new Map(
    (input.head.metricGroups ?? [])
      .filter(comparableMetricGroupDimensions)
      .map((group) => [metricGroupKey(group), group])
  )

  return [...new Set([...baseGroups.keys(), ...headGroups.keys()])]
    .flatMap((key) => {
      const baseGroup = baseGroups.get(key)
      const headGroup = headGroups.get(key)
      const group = baseGroup ?? headGroup

      if (group === undefined) {
        return []
      }

      // A group absent from one side has no fixtures there, which is a fact
      // about the selection rather than an unrecorded value. A group PRESENT
      // whose count was never recorded stays `undefined`.
      const baseFixtureCount =
        baseGroup === undefined ? 0 : baseGroup.fixtureCount
      const headFixtureCount =
        headGroup === undefined ? 0 : headGroup.fixtureCount

      if (
        baseFixtureCount !== undefined &&
        headFixtureCount !== undefined &&
        baseFixtureCount === headFixtureCount
      ) {
        return []
      }

      const status: 'new' | 'removed' | 'changed' =
        baseGroup === undefined
          ? 'new'
          : headGroup === undefined
            ? 'removed'
            : 'changed'

      return [
        {
          groupBy: group.groupBy,
          key: group.key,
          baseFixtureCount,
          headFixtureCount,
          status
        }
      ]
    })
    .sort((left, right) => {
      const groupOrder = left.groupBy.localeCompare(right.groupBy)
      return groupOrder === 0 ? left.key.localeCompare(right.key) : groupOrder
    })
}

const formatCount = (value: number | undefined): string =>
  value === undefined ? UNKNOWN_VALUE : `${value}`

const formatMetricGroupIdentityCells = (
  input: {
    readonly groupBy: string
    readonly key: string
    readonly baseFixtureCount: number | undefined
    readonly headFixtureCount: number | undefined
  }
): string =>
  `| ${input.groupBy} | ${escapeMarkdownCell(input.key)} | ${formatCount(
    input.baseFixtureCount
  )} | ${formatCount(input.headFixtureCount)}`

const formatDelta = (
  key: EvalComparabilityKey,
  base: number | undefined,
  head: number | undefined,
  comparability: MetricComparability,
  format: (base: number, head: number) => string
): string =>
  comparability.refusalReason(key) !== undefined
    ? NOT_COMPARABLE
    : base === undefined || head === undefined
      ? UNKNOWN_VALUE
      : format(base, head)

const formatMetricGroupCoverageDeltaRow = (
  group: ReturnType<typeof metricGroupCoverageDeltas>[number]
): string =>
  `${formatMetricGroupIdentityCells({
    groupBy: group.groupBy,
    key: group.key,
    baseFixtureCount: group.baseFixtureCount,
    headFixtureCount: group.headFixtureCount
  })} | ${
    group.baseFixtureCount === undefined || group.headFixtureCount === undefined
      ? UNKNOWN_VALUE
      : formatNumberDelta(group.baseFixtureCount, group.headFixtureCount)
  } | ${group.status} |`

const formatMetricGroupComparisonPrefix = (
  pair: ComparableMetricGroupPair
): string =>
  formatMetricGroupIdentityCells({
    groupBy: pair.base.groupBy,
    key: pair.base.key,
    baseFixtureCount: pair.base.fixtureCount,
    headFixtureCount: pair.head.fixtureCount
  })

const formatPercentMetricDeltaCells = (
  key: EvalComparabilityKey,
  base: number | undefined,
  head: number | undefined,
  comparability: MetricComparability
): string =>
  `${base === undefined ? UNKNOWN_VALUE : formatPercent(base)} | ${
    head === undefined ? UNKNOWN_VALUE : formatPercent(head)
  } | ${formatDelta(key, base, head, comparability, formatPercentagePointDelta)}`

const formatCountMetricDeltaCells = (
  key: EvalComparabilityKey,
  base: number | undefined,
  head: number | undefined,
  comparability: MetricComparability
): string =>
  `${formatCount(base)} | ${formatCount(head)} | ${formatDelta(
    key,
    base,
    head,
    comparability,
    formatNumberDelta
  )}`

const formatIntegerMetricDeltaCells = (
  key: EvalComparabilityKey,
  base: number | undefined,
  head: number | undefined,
  comparability: MetricComparability
): string =>
  `${base === undefined ? UNKNOWN_VALUE : formatInteger(base)} | ${
    head === undefined ? UNKNOWN_VALUE : formatInteger(head)
  } | ${formatDelta(key, base, head, comparability, formatNumberDelta)}`

const formatGroupCost = (metrics: EvalComparisonMetrics): string =>
  metrics.costUsd === undefined || metrics.costUnavailableCount === undefined
    ? UNKNOWN_VALUE
    : formatCostMetric({
        costUsd: metrics.costUsd,
        costUnavailableCount: metrics.costUnavailableCount
      })

// A metric group publishes precision like any other surface, so it publishes
// the BRACKET. Group metrics carry no scoring block of their own -- one run
// produced every group -- so the run-level plausibility facts are supplied by
// the report the group came from.
const groupPrecisionBracket = (
  metrics: EvalComparisonMetrics,
  report: EvalComparisonReport
): PrecisionBracket =>
  precisionBracket({
    precision: metrics.precision,
    adjustedPrecision: metrics.adjustedPrecision,
    plausibilityJudged: report.scoring?.plausibilityJudged,
    adjustedPrecisionTrustworthy: report.scoring?.adjustedPrecisionTrustworthy
  })

// The upper-bound delta is read off the BRACKET, not off `adjustedPrecision`
// directly. A run with no plausibility judge sets `adjustedPrecision` equal to
// raw precision, so differencing the raw field would publish a movement in an
// upper bound neither run ever measured.
const boundValue = (bound: PrecisionBracket['upper']): number | undefined =>
  bound.status === 'known' ? bound.value : undefined

type MetricGroupRowInput = {
  readonly pair: ComparableMetricGroupPair
  readonly reports: EvalReportPair
  readonly comparability: MetricComparability
}

const formatMetricGroupQualityDeltaRow = (
  input: MetricGroupRowInput
): string =>
  `${formatMetricGroupComparisonPrefix(input.pair)} | ${formatPercentMetricDeltaCells(
    'recall',
    input.pair.base.metrics.recall,
    input.pair.head.metrics.recall,
    input.comparability
  )} | ${formatPrecisionBracket(
    groupPrecisionBracket(input.pair.base.metrics, input.reports.base)
  )} | ${formatPrecisionBracket(
    groupPrecisionBracket(input.pair.head.metrics, input.reports.head)
  )} | ${formatDelta(
    'precision',
    boundValue(
      groupPrecisionBracket(input.pair.base.metrics, input.reports.base).lower
    ),
    boundValue(
      groupPrecisionBracket(input.pair.head.metrics, input.reports.head).lower
    ),
    input.comparability,
    formatPercentagePointDelta
  )} | ${formatDelta(
    'adjustedPrecision',
    boundValue(
      groupPrecisionBracket(input.pair.base.metrics, input.reports.base).upper
    ),
    boundValue(
      groupPrecisionBracket(input.pair.head.metrics, input.reports.head).upper
    ),
    input.comparability,
    formatPercentagePointDelta
  )} | ${formatPercentMetricDeltaCells(
    'f1',
    input.pair.base.metrics.f1,
    input.pair.head.metrics.f1,
    input.comparability
  )} | ${formatCountMetricDeltaCells(
    'falsePositiveCount',
    input.pair.base.metrics.falsePositiveCount,
    input.pair.head.metrics.falsePositiveCount,
    input.comparability
  )} |`

const formatMetricGroupResourceDeltaRow = (
  input: MetricGroupRowInput
): string =>
  `${formatMetricGroupComparisonPrefix(input.pair)} | ${formatIntegerMetricDeltaCells(
    'inputTokens',
    input.pair.base.metrics.inputTokens,
    input.pair.head.metrics.inputTokens,
    input.comparability
  )} | ${formatIntegerMetricDeltaCells(
    'outputTokens',
    input.pair.base.metrics.outputTokens,
    input.pair.head.metrics.outputTokens,
    input.comparability
  )} | ${formatGroupCost(input.pair.base.metrics)} | ${formatGroupCost(
    input.pair.head.metrics
  )} | ${formatDelta(
    'costUsd',
    input.pair.base.metrics.costUsd,
    input.pair.head.metrics.costUsd,
    input.comparability,
    formatNumberDelta
  )} | ${formatCountMetricDeltaCells(
    'costUnavailableCount',
    input.pair.base.metrics.costUnavailableCount,
    input.pair.head.metrics.costUnavailableCount,
    input.comparability
  )} |`

const formatMetricGroupProofLoopDeltaRow = (
  input: MetricGroupRowInput
): string =>
  `${formatMetricGroupComparisonPrefix(input.pair)} | ${formatCountMetricDeltaCells(
    'refutationFalseNegativeCount',
    input.pair.base.metrics.refutationFalseNegativeCount,
    input.pair.head.metrics.refutationFalseNegativeCount,
    input.comparability
  )} | ${formatCountMetricDeltaCells(
    'refutationFalsePositiveCount',
    input.pair.base.metrics.refutationFalsePositiveCount,
    input.pair.head.metrics.refutationFalsePositiveCount,
    input.comparability
  )} |`

export const appendMetricGroupCoverageDeltas = (
  lines: string[],
  groups: ReturnType<typeof metricGroupCoverageDeltas>
): void => {
  appendMarkdownTable(lines, {
    heading: '## Metric Group Coverage Deltas',
    header: '| Group | Key | Base fixtures | Head fixtures | Delta | Status |',
    alignment: '| --- | --- | ---: | ---: | ---: | --- |',
    rows: groups.map(formatMetricGroupCoverageDeltaRow)
  })
}

export type MetricGroupDeltaInput = {
  readonly pairs: readonly ComparableMetricGroupPair[]
  readonly reports: EvalReportPair
  readonly comparability: MetricComparability
}

const groupRows = (
  input: MetricGroupDeltaInput,
  format: (row: MetricGroupRowInput) => string
): readonly string[] =>
  input.pairs.map((pair) =>
    format({
      pair,
      reports: input.reports,
      comparability: input.comparability
    })
  )

export const appendMetricGroupQualityDeltas = (
  lines: string[],
  input: MetricGroupDeltaInput
): void => {
  appendMarkdownTable(lines, {
    heading: '## Metric Group Deltas',
    header:
      '| Group | Key | Base fixtures | Head fixtures | Base recall | Head recall | Recall delta | Base precision (raw to adjusted) | Head precision (raw to adjusted) | Raw precision delta | Adjusted precision delta | Base F1 | Head F1 | F1 delta | Base false positives | Head false positives | False positive delta |',
    alignment:
      '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    rows: groupRows(input, formatMetricGroupQualityDeltaRow)
  })
}

export const appendMetricGroupResourceDeltas = (
  lines: string[],
  input: MetricGroupDeltaInput
): void => {
  appendMarkdownTable(lines, {
    heading: '## Metric Group Resource Deltas',
    header:
      '| Group | Key | Base fixtures | Head fixtures | Base input tokens | Head input tokens | Input token delta | Base output tokens | Head output tokens | Output token delta | Base cost | Head cost | Cost delta | Base unavailable cost cases | Head unavailable cost cases | Unavailable cost delta |',
    alignment:
      '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    rows: groupRows(input, formatMetricGroupResourceDeltaRow)
  })
}

export const appendMetricGroupProofLoopDeltas = (
  lines: string[],
  input: MetricGroupDeltaInput
): void => {
  appendMarkdownTable(lines, {
    heading: '## Metric Group Proof-Loop Deltas',
    header:
      '| Group | Key | Base fixtures | Head fixtures | Base refutation false negatives | Head refutation false negatives | Refutation false negative delta | Base refutation false positives | Head refutation false positives | Refutation false positive delta |',
    alignment:
      '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    rows: groupRows(input, formatMetricGroupProofLoopDeltaRow)
  })
}
