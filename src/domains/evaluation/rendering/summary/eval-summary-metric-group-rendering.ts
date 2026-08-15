import {
  appendMarkdownTable,
  escapeMarkdownCell,
  formatPercent,
  formatPrecisionBracket,
  formatRateOverCount
} from '../eval-report-markdown-formatting.js'
import {
  precisionBracket,
  type PrecisionBracket
} from '../../scoring/eval-precision-bracket.js'
import type { EvalReport } from '../../report/eval-report-contracts.js'

type EvalSummaryMetricGroup = EvalReport['metricGroups'][number]

// A metric group carries no scoring block of its own -- one run produced every
// group -- so the run-level plausibility facts behind the precision bracket come
// from the report the group belongs to.
const metricGroupPrecisionBracket = (
  group: EvalSummaryMetricGroup,
  report: EvalReport
): PrecisionBracket =>
  precisionBracket({
    precision: group.metrics.precision,
    adjustedPrecision: group.metrics.adjustedPrecision,
    plausibilityJudged: report.scoring.plausibilityJudged,
    adjustedPrecisionTrustworthy: report.scoring.adjustedPrecisionTrustworthy
  })

const formatEvalSummaryMetricGroupRow = (
  group: EvalSummaryMetricGroup,
  report: EvalReport
): string =>
  `| ${group.groupBy} | ${escapeMarkdownCell(group.key)} | ${group.fixtureCount} | ${formatPercent(group.metrics.recall)} | ${formatPrecisionBracket(
    metricGroupPrecisionBracket(group, report)
  )} | ${formatPercent(group.metrics.f1)} | ${formatRateOverCount(group.metrics.lineAccuracy, group.metrics.lineCheckCount)} | ${group.metrics.falsePositiveCount} |`

export const appendEvalSummaryMetricGroups = (
  lines: string[],
  report: EvalReport
): void => {
  const summaryMetricGroups = report.metricGroups.filter(
    (group) => group.groupBy === 'sourceProfile' || group.groupBy === 'language'
  )

  appendMarkdownTable(lines, {
    heading: '## Metric Groups',
    header:
      '| Group | Key | Fixtures | Recall | Precision (raw to adjusted) | F1 | Line accuracy | False positives |',
    alignment: '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    rows: summaryMetricGroups.map((group) =>
      formatEvalSummaryMetricGroupRow(group, report)
    )
  })
}
