import { type DiffScope } from '../../scoring/eval-diff-scope.js'
import {
  appendMarkdownTable,
  escapeMarkdownCell,
  formatCostMetric,
  formatCurrency,
  formatDuration,
  formatDurationMetric,
  formatEvalGateOutcome,
  formatInteger,
  formatListValue,
  formatPercent,
  formatPrecisionBound,
  formatPrecisionBracket,
  formatRateOverCount,
  formatTokenMetric
} from '../eval-report-markdown-formatting.js'
import {
  precisionBracket,
  type PrecisionBracket
} from '../../scoring/eval-precision-bracket.js'
import { type EvalReport } from '../../report/eval-report-contracts.js'
import { type EvalMetrics } from '../../scoring/metrics.js'

// Precision is published as a BRACKET everywhere, never as a point. See
// `eval-precision-bracket.ts`: under an incomplete answer key precision is not
// identifiable, raw precision is its lower bound and adjusted precision its
// upper, and the upper end is the less trustworthy one.
const evalReportPrecisionBracket = (report: EvalReport): PrecisionBracket =>
  precisionBracket({
    precision: report.metrics.precision,
    adjustedPrecision: report.metrics.adjustedPrecision,
    plausibilityJudged: report.scoring.plausibilityJudged,
    adjustedPrecisionTrustworthy: report.scoring.adjustedPrecisionTrustworthy
  })

// Cached input tokens are a subset of input tokens. Render the absolute count
// alongside the share of input it represents so a benchmark shows prompt-cache
// effectiveness.
const formatCachedInputTokens = (metrics: EvalMetrics): string => {
  const cached = formatTokenMetric(metrics.cachedInputTokens, metrics)
  if (metrics.inputTokens === 0) {
    return cached
  }

  return `${cached} (${formatPercent(metrics.cachedInputTokens / metrics.inputTokens)} of input)`
}

// Judge + plausibility-judge spend for the whole run, kept as its OWN metric
// (see `scoringCostUsd` on `EvalMetrics`) rather than folded into the review
// "Cost" row: the two figures answer different questions and combining them
// would make neither one trustworthy.
const formatScoringCost = (metrics: EvalMetrics): string => {
  const value = formatCurrency(metrics.scoringCostUsd)

  return metrics.scoringCostUnavailable
    ? `${value} known; additional judge/plausibility spend unavailable`
    : value
}

// Judge agreement is omitted when no calibration pair was scored (a fully
// negative fixture set needs no judge). Render the denominator with it so a
// partially scored calibration set is visible.
const formatJudgeAgreement = (report: EvalReport): string =>
  report.scoring.judgeAgreement === undefined
    ? 'not scored'
    : `${formatPercent(report.scoring.judgeAgreement)} (${report.metrics.judgeAgreementPairCount} pairs)`

// Plausibility-judge agreement is omitted when no plausibility calibration pair
// was scored (an offline run needs no judge). Render the denominator with it.
const formatPlausibilityJudgeAgreement = (report: EvalReport): string =>
  report.metrics.plausibilityJudgeAgreement === undefined
    ? 'not scored'
    : `${formatPercent(report.metrics.plausibilityJudgeAgreement)} (${report.metrics.plausibilityJudgeAgreementPairCount} pairs)`

// A fix-lane rate (spec 12) is `null` whenever the lane produced no population
// to score, which is every run with `fix.enabled` off. `n/a` says that; `0.0%`
// said "the lane ran and got nothing right", which is a different claim about a
// lane that never ran.
//
// The denominator's NOUN is kept per row -- judged, false positives, real,
// attempted, expected -- rather than routing these through `formatRateOverCount`,
// whose fixed "checked" would erase which population each rate is over. The n/a
// wording matches that helper's so a reader learns one phrase.
const formatRateOverNamedCount = (
  value: number | null,
  denominatorCount: number,
  denominatorNoun: string
): string =>
  value === null || denominatorCount === 0
    ? `n/a (0 ${denominatorNoun})`
    : `${formatPercent(value)} (${denominatorCount} ${denominatorNoun})`

// Shared formatter for a `Record<string, number>` tally rendered as an inline
// comma-joined summary (e.g. rejection reason or severity counts). Reused so
// the reason and severity rows can never drift into two different renderings
// of the same shape.
const formatCountRecord = (record: Readonly<Record<string, number>>): string =>
  Object.entries(record)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key} ${count}`)
    .join(', ') || 'none'

// Diff-scope recall (spec 17) is rendered through `formatRateOverCount` so an
// empty population reads `n/a (0 checked)`. Rendering it as 0.0% would be
// indistinguishable from the engine's real, measured out-of-diff result, which
// IS 0.0% over a full denominator.
export const formatDiffScopeRecall = (
  metrics: EvalMetrics,
  scope: DiffScope
): string =>
  formatRateOverCount(
    metrics.recallByDiffScope[scope] ?? null,
    metrics.diffScopeCounts[scope]?.expected ?? 0
  )

export const appendEvalSummaryHeader = (
  lines: string[],
  report: EvalReport
): void => {
  lines.push('# Evaluation Summary')
  lines.push('')
  lines.push(`Gate: ${formatEvalGateOutcome(report.regressionGate.outcome)}`)
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Fixtures: ${report.fixtureCount}`)
  lines.push('')
}

export const appendEvalSummarySelection = (
  lines: string[],
  report: EvalReport
): void => {
  appendMarkdownTable(lines, {
    heading: '## Selection',
    header: '| Field | Value |',
    alignment: '| --- | --- |',
    rows: [
      `| Fixture source | ${report.selection.fixtureSource} |`,
      `| Slice root | ${escapeMarkdownCell(report.selection.sliceRoot ?? '-')} |`,
      `| Case filters | ${formatListValue(report.selection.caseFilters)} |`,
      `| Selected cases | ${formatListValue(report.selection.selectedCaseIds)} |`,
      `| Judge agreement | ${formatJudgeAgreement(report)} |`,
      `| Judge trustworthy | ${report.scoring.judgeTrustworthy ? 'yes' : 'no'} |`,
      `| Plausibility judge agreement | ${formatPlausibilityJudgeAgreement(report)} |`,
      `| Adjusted precision trustworthy | ${report.scoring.adjustedPrecisionTrustworthy ? 'yes' : 'no'} |`
    ]
  })
}

// The headline centers the three things reviews are judged on — findings,
// false-positives, and priority (severity) — so the primary signal is read first.
// Per-mechanism security labels are a secondary breakdown further down; label
// accuracy is not a headline goal. The full metric catalog stays in `## Metrics`.
export const appendEvalSummaryHeadline = (
  lines: string[],
  report: EvalReport
): void => {
  const metrics = report.metrics
  appendMarkdownTable(lines, {
    heading: '## Headline',
    header: '| Priority | Metric | Value |',
    alignment: '| --- | --- | ---: |',
    rows: [
      `| Findings | Product recall | ${formatPercent(metrics.productRecall)} |`,
      `| Findings | Recall (all tiers) | ${formatPercent(metrics.recall)} |`,
      // The blended figure above is not interpretable on its own: it depends on
      // the in/out ratio of the fixture set as much as on the reviewer, and the
      // two populations have measured tens of points apart. They are rendered
      // immediately beside it (spec 17) so neither can be quietly favoured --
      // headlining the in-diff figure alone would be as dishonest as blending
      // them without saying so.
      `| Findings | Recall (in-diff) | ${formatDiffScopeRecall(metrics, 'in-diff')} |`,
      `| Findings | Recall (out-of-diff) | ${formatDiffScopeRecall(metrics, 'out-of-diff')} |`,
      `| Findings | Unmatched but plausible | ${formatInteger(metrics.unlistedRealFindingCount)} |`,
      // Precision is published as its BRACKET and never as a point. Raw
      // precision is the lower bound (every unjudged finding charged as wrong)
      // and adjusted precision the upper (every unjudged finding credited);
      // under an incomplete answer key the true value is not identifiable
      // between them, and the upper end is the less trustworthy one.
      `| False positives | Precision (raw to adjusted bracket) | ${formatPrecisionBracket(
        evalReportPrecisionBracket(report)
      )} |`,
      `| False positives | Genuine false positives | ${formatInteger(metrics.genuineFalsePositiveCount)} |`,
      `| False positives | Duplicate findings | ${formatInteger(metrics.duplicateFindingCount)} |`,
      `| Priority | Severity accuracy | ${formatRateOverCount(metrics.severityAccuracy, metrics.severityCheckCount)} |`,
      `| Health | Provider error rate | ${formatPercent(metrics.providerErrorRate)} |`,
      `| Health | Review cost | ${formatCostMetric(metrics)} |`,
      // Deliberately its own row rather than folded into "Review cost" above:
      // this is judge + plausibility-judge provider spend for the whole run,
      // which used to be counted nowhere. Summing the two would silently
      // change what "Review cost" has always meant to every existing report.
      `| Health | Scoring cost (judge, separate from review cost) | ${formatScoringCost(metrics)} |`
    ]
  })
}

export const appendEvalSummaryMetrics = (
  lines: string[],
  report: EvalReport
): void => {
  appendMarkdownTable(lines, {
    heading: '## Metrics',
    header: '| Metric | Value |',
    alignment: '| --- | --- |',
    rows: [
      `| Recall | ${formatPercent(report.metrics.recall)} |`,
      `| Product recall | ${formatPercent(report.metrics.productRecall)} |`,
      `| Nit recall | ${formatPercent(report.metrics.nitRecall)} |`,
      `| In-diff recall | ${formatDiffScopeRecall(report.metrics, 'in-diff')} |`,
      `| Out-of-diff recall | ${formatDiffScopeRecall(report.metrics, 'out-of-diff')} |`,
      // `n/a` when the corpus expected no security finding, for the reason
      // diff-scope recall above is: this project's primary corpus carries no
      // security expectation at all, so these two printed a flat 0.0% that read as
      // the reviewer having missed every security defect. The denominator's noun
      // stays "expected" -- it counts expected findings, not checks -- following
      // the same rule as the fix-lane rates.
      `| Security obvious recall | ${formatRateOverNamedCount(
        report.metrics.securityObviousRecall,
        report.metrics.securityObviousCount,
        'expected'
      )} |`,
      `| Security hard recall | ${formatRateOverNamedCount(
        report.metrics.securityHardRecall,
        report.metrics.securityHardCount,
        'expected'
      )} |`,
      `| Precision (raw to adjusted bracket) | ${formatPrecisionBracket(
        evalReportPrecisionBracket(report)
      )} |`,
      `| Precision (lower bound, raw) | ${formatPrecisionBound(
        evalReportPrecisionBracket(report).lower
      )} |`,
      // Rendered through the bracket, not from `adjustedPrecision` directly: a
      // run with no plausibility judge sets that field equal to raw precision,
      // and printing it here would republish the lower bound as an upper one.
      `| Precision (upper bound, adjusted) | ${formatPrecisionBound(
        evalReportPrecisionBracket(report).upper
      )} |`,
      `| F1 | ${formatPercent(report.metrics.f1)} |`,
      `| Severity weighted F1 | ${formatPercent(report.metrics.severityWeightedF1)} |`,
      `| Line accuracy | ${formatRateOverCount(report.metrics.lineAccuracy, report.metrics.lineCheckCount)} |`,
      // DIAGNOSTIC ONLY -- see the schema comment on `linePlacementRate`. This is
      // NOT lineAccuracy: it is a looser measurement over every matched
      // expectation that declares a lineRange regardless of match mode, and it
      // gates nothing. Rendered as its own row rather than folded into the line
      // accuracy row above so a reader can never mistake one for the other.
      `| Line placement rate (diagnostic, all match modes) | ${formatRateOverCount(report.metrics.linePlacementRate, report.metrics.linePlacementCheckCount)} |`,
      `| Severity accuracy | ${formatRateOverCount(report.metrics.severityAccuracy, report.metrics.severityCheckCount)} |`,
      `| Parse validity | ${formatPercent(report.metrics.parseValidity)} |`,
      `| Provider error rate | ${formatPercent(report.metrics.providerErrorRate)} |`,
      `| Provider issue rate | ${formatPercent(report.metrics.providerIssueRate)} (${report.metrics.providerIssueCount} cases) |`,
      `| False positives | ${report.metrics.falsePositiveCount} |`,
      `| Genuine false positives | ${report.metrics.genuineFalsePositiveCount} |`,
      `| Unmatched but plausible | ${report.metrics.unlistedRealFindingCount} |`,
      `| Plausibility judge agreement | ${formatPlausibilityJudgeAgreement(report)} |`,
      `| Inconclusive matches | ${report.metrics.inconclusiveMatchCount} |`,
      `| Artifact-only recall | ${formatPercent(report.metrics.artifactOnlyRecall)} |`,
      `| Artifact-only precision | ${formatPercent(report.metrics.artifactOnlyPrecision)} |`,
      `| Artifact-only findings | ${report.metrics.artifactOnlyFindingCount} |`,
      `| Artifact-only matched | ${report.metrics.artifactOnlyMatchedFindingCount} |`,
      `| Artifact-only false positives | ${report.metrics.artifactOnlyFalsePositiveCount} |`,
      `| Rejected candidates by reason | ${formatCountRecord(report.metrics.rejectionReasonCounts)} |`,
      // Severity of the REJECTED candidate (spec 06 item 0.4), not the
      // expectation's severity. Answers "is the model over-calling severity"
      // without the admission floor's `low` deletion hiding the answer.
      `| Rejected candidates by severity | ${formatCountRecord(report.metrics.rejectionSeverityCounts)} |`,
      `| Refutation false negatives (upper bound) | ${report.metrics.refutationFalseNegativeCount} |`,
      `| Refutation false positives | ${report.metrics.refutationFalsePositiveCount} |`,
      `| Fix judgment accuracy | ${formatRateOverNamedCount(report.metrics.fixJudgmentAccuracy, report.metrics.fixJudgedFindingCount, 'judged')} |`,
      `| Fix false-positive detection rate | ${formatRateOverNamedCount(report.metrics.fixFalsePositiveDetectionRate, report.metrics.fixGroundTruthFalsePositiveCount, 'false positives')} |`,
      `| Fix produce rate | ${formatRateOverNamedCount(report.metrics.fixProduceRate, report.metrics.fixRealFindingCount, 'real')} |`,
      `| Fix apply failure rate | ${formatRateOverNamedCount(report.metrics.fixApplyFailureRate, report.metrics.fixAttemptedCount, 'attempted')} |`,
      `| Duplicate findings | ${report.metrics.duplicateFindingCount} |`,
      `| No-finding-zone hits | ${report.metrics.noFindingZoneFalsePositiveCount} |`,
      `| Actionable rate | ${formatPercent(report.metrics.actionableRate)} |`,
      `| Incomplete coverage rate | ${formatPercent(report.metrics.incompleteCoverageRate)} |`,
      `| Context mutation rate | ${formatPercent(report.metrics.contextMutationRate)} |`,
      // Elapsed is the monotonic wall clock for the WHOLE run (case reviews
      // plus judge/plausibility scoring); Duration only SUMS each case's own
      // review time and cannot be compared to how long the run actually took.
      `| Elapsed (wall clock) | ${formatDuration(report.metrics.elapsedMs)} |`,
      `| Duration (summed review time) | ${formatDurationMetric(report.metrics)} |`,
      `| Input tokens | ${formatTokenMetric(report.metrics.inputTokens, report.metrics)} |`,
      `| Input tokens (cached) | ${formatCachedInputTokens(report.metrics)} |`,
      `| Output tokens | ${formatTokenMetric(report.metrics.outputTokens, report.metrics)} |`,
      `| Review cost | ${formatCostMetric(report.metrics)} |`,
      `| Scoring input tokens (judge + plausibility judge) | ${formatInteger(report.metrics.scoringInputTokens)} |`,
      `| Scoring output tokens (judge + plausibility judge) | ${formatInteger(report.metrics.scoringOutputTokens)} |`,
      `| Scoring cost (judge, separate from review cost) | ${formatScoringCost(report.metrics)} |`
    ]
  })
}

// Reason x severity cross-tab (spec 06 item 0.4), rendered only when there is
// at least one rejection: an all-zero table would just repeat "none" for
// every reason and add nothing a reader could act on. Sorted by reason then
// severity so the table is deterministic across identical runs.
export const appendEvalSummaryRejectionsByReasonAndSeverity = (
  lines: string[],
  report: EvalReport
): void => {
  const rows = Object.entries(report.metrics.rejectionReasonBySeverityCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([reason, severityCounts]) =>
      Object.entries(severityCounts)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(
          ([severity, count]) =>
            `| ${escapeMarkdownCell(reason)} | ${escapeMarkdownCell(severity)} | ${count} |`
        )
    )

  appendMarkdownTable(lines, {
    heading: '## Rejections by Reason and Severity',
    header: '| Reason | Severity | Count |',
    alignment: '| --- | --- | ---: |',
    rows
  })
}
