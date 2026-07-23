import {
  appendMarkdownTable,
  escapeMarkdownCell,
  formatCostMetric,
  formatInteger,
  formatPercent
} from './eval-report-markdown-formatting.js'
import { type EvalReport } from './eval-report-contracts.js'
import { type EvalMetrics } from './metrics.js'

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

const metricGroupKey = (
  group: EvalReport['metricGroups'][number]
): string => `${group.groupBy}\0${group.key}`

type ComparableMetricGroup = EvalReport['metricGroups'][number] & {
  readonly groupBy: 'sourceProfile' | 'language'
}

export type ComparableMetricGroupPair = {
  readonly base: ComparableMetricGroup
  readonly head: ComparableMetricGroup
}

const comparableMetricGroupDimensions = (
  group: EvalReport['metricGroups'][number]
): group is ComparableMetricGroup =>
  group.groupBy === 'sourceProfile' || group.groupBy === 'language'

export const comparableMetricGroups = (
  input: EvalReportPair
): ReadonlyArray<ComparableMetricGroupPair> => {
  const headGroups = new Map(
    input.head.metricGroups
      .filter(comparableMetricGroupDimensions)
      .map((group) => [metricGroupKey(group), group])
  )

  return input.base.metricGroups
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
  readonly baseFixtureCount: number
  readonly headFixtureCount: number
  readonly status: 'new' | 'removed' | 'changed'
}> => {
  const baseGroups = new Map(
    input.base.metricGroups
      .filter(comparableMetricGroupDimensions)
      .map((group) => [metricGroupKey(group), group])
  )
  const headGroups = new Map(
    input.head.metricGroups
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

      const baseFixtureCount = baseGroup?.fixtureCount ?? 0
      const headFixtureCount = headGroup?.fixtureCount ?? 0

      if (baseFixtureCount === headFixtureCount) {
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

const formatMetricGroupIdentityCells = (
  input: {
    readonly groupBy: string
    readonly key: string
    readonly baseFixtureCount: number
    readonly headFixtureCount: number
  }
): string =>
  `| ${input.groupBy} | ${escapeMarkdownCell(input.key)} | ${input.baseFixtureCount} | ${input.headFixtureCount}`

const formatMetricGroupCoverageDeltaRow = (
  group: ReturnType<typeof metricGroupCoverageDeltas>[number]
): string =>
  `${formatMetricGroupIdentityCells({
    groupBy: group.groupBy,
    key: group.key,
    baseFixtureCount: group.baseFixtureCount,
    headFixtureCount: group.headFixtureCount
  })} | ${formatNumberDelta(
    group.baseFixtureCount,
    group.headFixtureCount
  )} | ${group.status} |`

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
  base: number,
  head: number
): string =>
  `${formatPercent(base)} | ${formatPercent(head)} | ${formatPercentagePointDelta(
    base,
    head
  )}`

const formatCountMetricDeltaCells = (base: number, head: number): string =>
  `${base} | ${head} | ${formatNumberDelta(base, head)}`

const formatIntegerMetricDeltaCells = (base: number, head: number): string =>
  `${formatInteger(base)} | ${formatInteger(head)} | ${formatNumberDelta(
    base,
    head
  )}`

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

const formatMetricGroupQualityDeltaRow = (
  pair: ComparableMetricGroupPair
): string =>
  `${formatMetricGroupComparisonPrefix(pair)} | ${formatPercentMetricDeltaCells(
    pair.base.metrics.recall,
    pair.head.metrics.recall
  )} | ${formatPercentMetricDeltaCells(
    pair.base.metrics.precision,
    pair.head.metrics.precision
  )} | ${formatPercentMetricDeltaCells(
    pair.base.metrics.f1,
    pair.head.metrics.f1
  )} | ${formatCountMetricDeltaCells(
    pair.base.metrics.falsePositiveCount,
    pair.head.metrics.falsePositiveCount
  )} |`

const formatMetricGroupResourceDeltaRow = (
  pair: ComparableMetricGroupPair
): string => {
  const costCells = formatCostMetricDeltaCells(pair.base.metrics, pair.head.metrics)

  return `${formatMetricGroupComparisonPrefix(pair)} | ${formatIntegerMetricDeltaCells(
    pair.base.metrics.inputTokens,
    pair.head.metrics.inputTokens
  )} | ${formatIntegerMetricDeltaCells(
    pair.base.metrics.outputTokens,
    pair.head.metrics.outputTokens
  )} | ${costCells.base} | ${costCells.head} | ${costCells.delta} | ${formatCountMetricDeltaCells(
    pair.base.metrics.costUnavailableCount,
    pair.head.metrics.costUnavailableCount
  )} |`
}

const formatMetricGroupProofLoopDeltaRow = (
  pair: ComparableMetricGroupPair
): string =>
  `${formatMetricGroupComparisonPrefix(pair)} | ${formatCountMetricDeltaCells(
    pair.base.metrics.refutationFalseNegativeCount,
    pair.head.metrics.refutationFalseNegativeCount
  )} | ${formatCountMetricDeltaCells(
    pair.base.metrics.refutationFalsePositiveCount,
    pair.head.metrics.refutationFalsePositiveCount
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

export const appendMetricGroupQualityDeltas = (
  lines: string[],
  pairs: readonly ComparableMetricGroupPair[]
): void => {
  appendMarkdownTable(lines, {
    heading: '## Metric Group Deltas',
    header:
      '| Group | Key | Base fixtures | Head fixtures | Base recall | Head recall | Recall delta | Base precision | Head precision | Precision delta | Base F1 | Head F1 | F1 delta | Base false positives | Head false positives | False positive delta |',
    alignment:
      '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    rows: pairs.map(formatMetricGroupQualityDeltaRow)
  })
}

export const appendMetricGroupResourceDeltas = (
  lines: string[],
  pairs: readonly ComparableMetricGroupPair[]
): void => {
  appendMarkdownTable(lines, {
    heading: '## Metric Group Resource Deltas',
    header:
      '| Group | Key | Base fixtures | Head fixtures | Base input tokens | Head input tokens | Input token delta | Base output tokens | Head output tokens | Output token delta | Base cost | Head cost | Cost delta | Base unavailable cost cases | Head unavailable cost cases | Unavailable cost delta |',
    alignment:
      '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    rows: pairs.map(formatMetricGroupResourceDeltaRow)
  })
}

export const appendMetricGroupProofLoopDeltas = (
  lines: string[],
  pairs: readonly ComparableMetricGroupPair[]
): void => {
  appendMarkdownTable(lines, {
    heading: '## Metric Group Proof-Loop Deltas',
    header:
      '| Group | Key | Base fixtures | Head fixtures | Base refutation false negatives | Head refutation false negatives | Refutation false negative delta | Base refutation false positives | Head refutation false positives | Refutation false positive delta |',
    alignment:
      '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    rows: pairs.map(formatMetricGroupProofLoopDeltaRow)
  })
}
