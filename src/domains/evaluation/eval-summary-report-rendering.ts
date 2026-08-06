import { z } from 'zod'
import { allDiffScopes, type DiffScope } from './eval-diff-scope.js'
import {
  resolveExpectedFindingMatchMode,
  SecurityContextDepthSchema,
  SecurityMechanismSchema,
  type EvalCase
} from './eval-fixture.schema.js'
import {
  appendMarkdownBulletSection,
  appendMarkdownTable,
  escapeMarkdownCell,
  formatCostMetric,
  formatDuration,
  formatInteger,
  formatListValue,
  formatPercent,
  formatPrecisionBound,
  formatPrecisionBracket,
  formatRateOverCount
} from './eval-report-markdown-formatting.js'
import {
  precisionBracket,
  type PrecisionBracket
} from './eval-precision-bracket.js'
import { expectedLocationLabel } from './eval-report-expected-finding-labels.js'
import {
  agenticStageLabel,
  caseStatus,
  contextLedgerConsideredCount,
  contextLedgerKindLabel,
  contextLedgerTruncatedCount,
  humanActionableWarnings,
  noteForCase,
  providerIssueLabel
} from './eval-report-case-labels.js'
import { EvalCaseReportSchema, type EvalReport } from './eval-report-contracts.js'
import { type EvalMetrics } from './metrics.js'

export const EVAL_REPORT_ARTIFACT_NAME = 'eval-report.json'
export const EVAL_SUMMARY_ARTIFACT_NAME = 'eval-summary.md'
export const EVAL_RECALL_REPORT_ARTIFACT_NAME = 'eval-recall-report.md'

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
  const cached = formatInteger(metrics.cachedInputTokens)
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
  const value = `$${metrics.scoringCostUsd.toFixed(4)}`

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
const formatDiffScopeRecall = (
  metrics: EvalMetrics,
  scope: DiffScope
): string =>
  formatRateOverCount(
    metrics.recallByDiffScope[scope] ?? null,
    metrics.diffScopeCounts[scope]?.expected ?? 0
  )

const findCase = (
  cases: readonly EvalCase[],
  caseId: string
): EvalCase | undefined => cases.find((evalCase) => evalCase.id === caseId)

const expectedLabelForMatch = (
  caseResult: z.infer<typeof EvalCaseReportSchema>,
  expectedIndex: number
): string => {
  const expected = caseResult.expectedFindings.find(
    (finding) => finding.expectedIndex === expectedIndex
  )

  return expected === undefined
    ? `expected #${expectedIndex}`
    : `expected #${expectedIndex} ${expected.severity} ${expected.category}`
}

const appendEvalSummaryHeader = (
  lines: string[],
  report: EvalReport
): void => {
  lines.push('# Evaluation Summary')
  lines.push('')
  lines.push(`Gate: ${report.regressionGate.passed ? 'PASS' : 'FAIL'}`)
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Fixtures: ${report.fixtureCount}`)
  lines.push('')
}

const appendEvalSummarySelection = (
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
const appendEvalSummaryHeadline = (
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

const appendEvalSummaryMetrics = (
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
      `| Security obvious recall | ${formatPercent(report.metrics.securityObviousRecall)} (${report.metrics.securityObviousCount} expected) |`,
      `| Security hard recall | ${formatPercent(report.metrics.securityHardRecall)} (${report.metrics.securityHardCount} expected) |`,
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
      `| Fix judgment accuracy | ${formatPercent(report.metrics.fixJudgmentAccuracy)} (${report.metrics.fixJudgedFindingCount} judged) |`,
      `| Fix false-positive detection rate | ${formatPercent(report.metrics.fixFalsePositiveDetectionRate)} (${report.metrics.fixGroundTruthFalsePositiveCount} false positives) |`,
      `| Fix produce rate | ${formatPercent(report.metrics.fixProduceRate)} (${report.metrics.fixRealFindingCount} real) |`,
      `| Fix apply failure rate | ${formatPercent(report.metrics.fixApplyFailureRate)} (${report.metrics.fixAttemptedCount} attempted) |`,
      `| Duplicate findings | ${report.metrics.duplicateFindingCount} |`,
      `| No-finding-zone hits | ${report.metrics.noFindingZoneFalsePositiveCount} |`,
      `| Actionable rate | ${formatPercent(report.metrics.actionableRate)} |`,
      `| Incomplete coverage rate | ${formatPercent(report.metrics.incompleteCoverageRate)} |`,
      `| Context mutation rate | ${formatPercent(report.metrics.contextMutationRate)} |`,
      // Elapsed is the monotonic wall clock for the WHOLE run (case reviews
      // plus judge/plausibility scoring); Duration only SUMS each case's own
      // review time and cannot be compared to how long the run actually took.
      `| Elapsed (wall clock) | ${formatDuration(report.metrics.elapsedMs)} |`,
      `| Duration (summed review time) | ${formatDuration(report.metrics.durationMs)} |`,
      `| Input tokens | ${formatInteger(report.metrics.inputTokens)} |`,
      `| Input tokens (cached) | ${formatCachedInputTokens(report.metrics)} |`,
      `| Output tokens | ${formatInteger(report.metrics.outputTokens)} |`,
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
const appendEvalSummaryRejectionsByReasonAndSeverity = (
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

const tierDisplayOrder = [
  'runtime-critical',
  'security',
  'logic',
  'nit'
] as const

const appendEvalSummaryRecallByTier = (
  lines: string[],
  report: EvalReport
): void => {
  appendMarkdownTable(lines, {
    heading: '## Recall by Tier',
    header: '| Tier | Recall |',
    alignment: '| --- | ---: |',
    rows: tierDisplayOrder.map(
      (tier) => `| ${tier} | ${formatPercent(report.metrics.recallByTier[tier])} |`
    )
  })
}

// Recall by diff scope (spec 17). Every scope with expectations is rendered,
// including `undetermined`: an expectation the hunk-span rule could not place is
// a hole in the classification, and hiding it would let a report look complete
// while part of its answer key sat outside both populations.
const appendEvalSummaryRecallByDiffScope = (
  lines: string[],
  report: EvalReport
): void => {
  appendMarkdownTable(lines, {
    heading: '## Recall by Diff Scope',
    header: '| Diff scope | Recall | Matched/Expected |',
    alignment: '| --- | ---: | ---: |',
    rows: allDiffScopes.flatMap((scope) => {
      const counts = report.metrics.diffScopeCounts[scope]
      if (counts === undefined || counts.expected === 0) {
        return []
      }

      return [
        `| ${scope} | ${formatDiffScopeRecall(report.metrics, scope)} | ${counts.matched}/${counts.expected} |`
      ]
    })
  })
}

// Security by mechanism / context depth (spec 15). Recall only — an admitted
// finding carries no mechanism label, so there is no per-mechanism precision to
// render. Only buckets with expected findings are shown, so a report with no
// security ground truth omits the section entirely, and matched/expected keeps
// a small sample from being over-read.
const appendEvalSummarySecurityByMechanism = (
  lines: string[],
  report: EvalReport
): void => {
  appendMarkdownTable(lines, {
    heading: '## Security by Mechanism',
    header: '| Mechanism | Recall | Matched/Expected |',
    alignment: '| --- | ---: | ---: |',
    rows: SecurityMechanismSchema.options.flatMap((mechanism) => {
      const counts = report.metrics.securityMechanismCounts[mechanism]
      if (counts === undefined || counts.expected === 0) {
        return []
      }

      return [
        `| ${mechanism} | ${formatPercent(report.metrics.securityRecallByMechanism[mechanism] ?? 0)} | ${counts.matched}/${counts.expected} |`
      ]
    })
  })
}

const appendEvalSummarySecurityByContextDepth = (
  lines: string[],
  report: EvalReport
): void => {
  appendMarkdownTable(lines, {
    heading: '## Security by Context Depth',
    header: '| Context depth | Recall | Matched/Expected |',
    alignment: '| --- | ---: | ---: |',
    rows: SecurityContextDepthSchema.options.flatMap((depth) => {
      const counts = report.metrics.securityContextDepthCounts[depth]
      if (counts === undefined || counts.expected === 0) {
        return []
      }

      return [
        `| ${depth} | ${formatPercent(report.metrics.securityRecallByContextDepth[depth] ?? 0)} | ${counts.matched}/${counts.expected} |`
      ]
    })
  })
}

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

const appendEvalSummaryMetricGroups = (
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

const formatEvalSummaryCaseRow = (
  caseResult: z.infer<typeof EvalCaseReportSchema>,
  evalCase: EvalCase | undefined
): string => {
  const expectedCount = evalCase?.expectedFindings.length ?? 0
  return [
    '|',
    escapeMarkdownCell(caseResult.caseId),
    '|',
    escapeMarkdownCell(evalCase?.sourceProfile ?? 'project'),
    '|',
    caseStatus(caseResult),
    '|',
    escapeMarkdownCell(providerIssueLabel(caseResult)),
    '|',
    String(expectedCount),
    '|',
    String(caseResult.matchedFindings.length),
    '|',
    String(caseResult.inlineFindingCount),
    '|',
    String(caseResult.artifactOnlyFindingIds.length),
    '|',
    String(caseResult.falsePositiveFindingIds.length),
    '|',
    String(caseResult.duplicateFindingIds.length),
    '|',
    escapeMarkdownCell(noteForCase(caseResult)),
    '|'
  ].join(' ')
}

const appendEvalSummaryCases = (
  lines: string[],
  input: {
    readonly cases: readonly EvalCase[]
    readonly report: EvalReport
  }
): void => {
  lines.push('## Cases')
  lines.push('')
  lines.push(
    '| Case | Profile | Status | Provider | Expected | Matched | Inline | Artifact-only | False positives | Duplicates | Notes |'
  )
  lines.push(
    '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |'
  )

  for (const caseResult of input.report.caseResults) {
    const evalCase = findCase(input.cases, caseResult.caseId)
    lines.push(formatEvalSummaryCaseRow(caseResult, evalCase))
  }

  lines.push('')
}

const formatEvalSummaryAgenticStageRow = (
  caseResult: z.infer<typeof EvalCaseReportSchema>
): string =>
  [
    '|',
    escapeMarkdownCell(caseResult.caseId),
    '|',
    agenticStageLabel(caseResult, 'refutation'),
    '|',
    agenticStageLabel(caseResult, 'fix'),
    '|',
    agenticStageLabel(caseResult, 'provider-recovery'),
    '|'
  ].join(' ')

const appendEvalSummaryAgenticStageCoverage = (
  lines: string[],
  report: EvalReport
): void => {
  const stageCoverageCases = report.caseResults.filter(
    (caseResult) => (caseResult.agenticStages ?? []).length > 0
  )

  if (stageCoverageCases.length === 0) {
    return
  }

  lines.push('## Agentic Stage Coverage')
  lines.push('')
  lines.push('| Case | Refutation | Fix | Provider recovery |')
  lines.push('| --- | --- | --- | --- |')
  for (const caseResult of stageCoverageCases) {
    lines.push(formatEvalSummaryAgenticStageRow(caseResult))
  }
  lines.push('')
}

const formatEvalSummaryContextLedgerRow = (
  caseResult: z.infer<typeof EvalCaseReportSchema>
): string =>
  `| ${escapeMarkdownCell(caseResult.caseId)} | ${escapeMarkdownCell(contextLedgerKindLabel(caseResult))} | ${contextLedgerConsideredCount(caseResult)} | ${contextLedgerTruncatedCount(caseResult)} |`

const appendEvalSummaryContextLedgerKinds = (
  lines: string[],
  report: EvalReport
): void => {
  const contextLedgerCases = report.caseResults.filter(
    (caseResult) => caseResult.contextLedger.length > 0
  )

  if (contextLedgerCases.length === 0) {
    return
  }

  lines.push('## Context Ledger Kinds')
  lines.push('')
  lines.push('| Case | Kinds | Considered | Truncated |')
  lines.push('| --- | --- | ---: | ---: |')
  for (const caseResult of contextLedgerCases) {
    lines.push(formatEvalSummaryContextLedgerRow(caseResult))
  }
  lines.push('')
}

const appendEvalSummaryGateReasons = (
  lines: string[],
  report: EvalReport
): void => {
  appendMarkdownBulletSection(lines, {
    heading: '## Gate Reasons',
    rows: report.regressionGate.reasons.map((reason) => `- ${reason}`)
  })
}

const appendEvalSummaryProviderIssues = (
  lines: string[],
  report: EvalReport
): void => {
  const providerIssueCases = report.caseResults.filter(
    (caseResult) => caseResult.providerIssues.length > 0
  )

  appendMarkdownTable(lines, {
    heading: '## Provider Issues',
    header: '| Case | Status | Provider issue |',
    alignment: '| --- | --- | --- |',
    rows: providerIssueCases.map(formatEvalSummaryProviderIssueRow)
  })
}

const formatEvalSummaryProviderIssueRow = (
  caseResult: z.infer<typeof EvalCaseReportSchema>
): string =>
  `| ${escapeMarkdownCell(caseResult.caseId)} | ${caseStatus(caseResult)} | ${escapeMarkdownCell(providerIssueLabel(caseResult))} |`

type EvalSummarySemanticJudgeMatchRow = {
  readonly caseResult: z.infer<typeof EvalCaseReportSchema>
  readonly match: z.infer<typeof EvalCaseReportSchema>['matchedFindings'][number]
  readonly reason: string
}

const formatEvalSummarySemanticJudgeMatchRow = (
  row: EvalSummarySemanticJudgeMatchRow
): string =>
  `| ${escapeMarkdownCell(row.caseResult.caseId)} | ${escapeMarkdownCell(row.match.findingId)} | ${escapeMarkdownCell(expectedLabelForMatch(row.caseResult, row.match.expectedIndex))} | ${escapeMarkdownCell(row.reason)} |`

const appendEvalSummarySemanticJudgeMatches = (
  lines: string[],
  report: EvalReport
): void => {
  // Every match is a judge decision, so `semanticReason` is always present.
  const semanticJudgeMatches = report.caseResults.flatMap((caseResult) =>
    [...caseResult.matchedFindings, ...caseResult.artifactOnlyMatchedFindings].map(
      (match) => ({ caseResult, match, reason: match.semanticReason })
    )
  )

  appendMarkdownTable(lines, {
    heading: '## Semantic Judge Matches',
    header: '| Case | Finding | Expected | Reason |',
    alignment: '| --- | --- | --- | --- |',
    rows: semanticJudgeMatches.map(formatEvalSummarySemanticJudgeMatchRow)
  })
}

const appendEvalSummaryArtifacts = (
  lines: string[],
  artifactRoot: string
): void => {
  appendMarkdownBulletSection(lines, {
    heading: '## Artifacts',
    rows: [
      `- ${artifactRoot}/${EVAL_REPORT_ARTIFACT_NAME}`,
      `- ${artifactRoot}/${EVAL_SUMMARY_ARTIFACT_NAME}`,
      `- ${artifactRoot}/${EVAL_RECALL_REPORT_ARTIFACT_NAME}`
    ]
  })
}

const attentionCasesForSummary = (
  report: EvalReport
): readonly z.infer<typeof EvalCaseReportSchema>[] =>
  report.caseResults.filter(
    (caseResult) =>
      caseStatus(caseResult) !== 'PASS' ||
      caseResult.inconclusiveMatches.length > 0 ||
      caseResult.artifactOnlyMatchedFindings.length > 0 ||
      caseResult.artifactOnlyFalsePositiveFindings.length > 0 ||
      caseResult.unlistedRealFindings.length > 0 ||
      caseResult.refutationResults.length > 0 ||
      caseResult.providerIssues.length > 0
  )

const appendAttentionBulletSection = (
  lines: string[],
  input: {
    readonly heading: string
    readonly rows: readonly string[]
  }
): void => {
  if (input.rows.length === 0) {
    return
  }

  lines.push(input.heading)
  lines.push(...input.rows)
}

type EvalSummaryAttentionFinding = {
  readonly findingId: string
  readonly severity: string
  readonly category: string
  readonly path: string
  readonly line: number
  readonly title: string
}

const formatAttentionFindingBullet = (
  finding: EvalSummaryAttentionFinding
): string =>
  `- ${finding.findingId} ${finding.severity} ${finding.category} ${finding.path}:${finding.line} - ${finding.title}`

type EvalSummaryAttentionMatch = {
  readonly findingId: string
  readonly expectedIndex: number
  readonly semanticReason: string
}

const formatAttentionMatchedFindingBullet = (
  caseResult: z.infer<typeof EvalCaseReportSchema>,
  match: EvalSummaryAttentionMatch
): string =>
  `- ${match.findingId} matched ${expectedLabelForMatch(caseResult, match.expectedIndex)} - ${match.semanticReason}`

type EvalSummaryInconclusiveMatch = {
  readonly findingId: string
  readonly expectedIndex: number
  readonly code: string
}

// Inconclusive pairs are neither misses nor false positives. They are rendered
// separately so a reader never mistakes a failed judge call for review quality.
const formatAttentionInconclusiveBullet = (
  caseResult: z.infer<typeof EvalCaseReportSchema>,
  inconclusive: EvalSummaryInconclusiveMatch
): string =>
  `- ${inconclusive.findingId} vs ${expectedLabelForMatch(caseResult, inconclusive.expectedIndex)} undecided (${inconclusive.code}); excluded from recall and precision`

type EvalSummaryExpectedFinding = EvalCase['expectedFindings'][number]

const formatAttentionMissedExpectedBullet = (
  expectedIndex: number,
  expected: EvalSummaryExpectedFinding
): string =>
  `- #${expectedIndex} ${expected.severity} ${expected.category} ${expectedLocationLabel(expected)} [${resolveExpectedFindingMatchMode(expected)}] - ${expected.semanticSummary}`

const attentionMissedExpectedRows = (
  caseResult: z.infer<typeof EvalCaseReportSchema>,
  evalCase: EvalCase | undefined
): readonly string[] => {
  if (evalCase === undefined) {
    return []
  }

  const rows: string[] = []
  for (const expectedIndex of caseResult.unmatchedExpectedIndexes) {
    const expected = evalCase.expectedFindings[expectedIndex]
    if (expected === undefined) {
      continue
    }

    rows.push(formatAttentionMissedExpectedBullet(expectedIndex, expected))
  }

  return rows
}

type EvalSummaryRefutationResult = {
  readonly id: string
  readonly candidateId: string
  readonly verdict: string
}

const formatAttentionRefutationBullet = (
  refutation: EvalSummaryRefutationResult
): string =>
  `- ${refutation.id} candidate ${refutation.candidateId} verdict ${refutation.verdict}`

const appendEvalSummaryAttentionNeeded = (
  lines: string[],
  input: {
    readonly cases: readonly EvalCase[]
    readonly report: EvalReport
  }
): void => {
  const attentionCases = attentionCasesForSummary(input.report)

  if (attentionCases.length === 0) {
    return
  }

  lines.push('## Attention Needed')
  lines.push('')
  for (const caseResult of attentionCases) {
    const evalCase = findCase(input.cases, caseResult.caseId)
    lines.push(`### ${caseResult.caseId}`)
    lines.push('')

    appendAttentionBulletSection(lines, {
      heading: 'Missed expected findings:',
      rows: attentionMissedExpectedRows(caseResult, evalCase)
    })

    appendAttentionBulletSection(lines, {
      heading: 'Inconclusive judge decisions:',
      rows: caseResult.inconclusiveMatches.map((inconclusive) =>
        formatAttentionInconclusiveBullet(caseResult, inconclusive)
      )
    })

    appendAttentionBulletSection(lines, {
      heading: 'Artifact-only matched findings:',
      rows: caseResult.artifactOnlyMatchedFindings.map((match) =>
        formatAttentionMatchedFindingBullet(caseResult, match)
      )
    })

    appendAttentionBulletSection(lines, {
      heading: 'Artifact-only findings:',
      rows: caseResult.artifactOnlyFalsePositiveFindings.map(
        formatAttentionFindingBullet
      )
    })

    appendAttentionBulletSection(lines, {
      heading: 'False positive findings:',
      rows: caseResult.falsePositiveFindings.map(formatAttentionFindingBullet)
    })

    // Real-but-unlisted defects: unmatched findings the plausibility judge
    // credited as genuine. They do not count against adjusted precision.
    appendAttentionBulletSection(lines, {
      heading: 'Real but unlisted findings (credited by plausibility judge):',
      rows: caseResult.unlistedRealFindings.map(formatAttentionFindingBullet)
    })

    appendAttentionBulletSection(lines, {
      heading: 'Duplicate findings:',
      rows: caseResult.duplicateFindings.map(formatAttentionFindingBullet)
    })

    if (caseResult.noFindingZoneFalsePositiveIds.length > 0) {
      lines.push(
        `No-finding-zone hit IDs: ${caseResult.noFindingZoneFalsePositiveIds.join(', ')}`
      )
    }

    appendAttentionBulletSection(lines, {
      heading: 'Refutation results:',
      rows: caseResult.refutationResults.map(formatAttentionRefutationBullet)
    })

    if (caseResult.providerIssues.length > 0) {
      lines.push(`Provider issues: ${providerIssueLabel(caseResult)}`)
    }

    const warnings = humanActionableWarnings(caseResult.warnings)
    if (warnings.length > 0) {
      lines.push(`Warnings: ${warnings.join(', ')}`)
    }

    lines.push('')
  }
}

export const renderEvalSummary = (
  input: {
    readonly cases: readonly EvalCase[]
    readonly report: EvalReport
    readonly artifactRoot?: string
  }
): string => {
  const artifactRoot = input.artifactRoot ?? '.codereviewer/eval'
  const lines: string[] = []

  appendEvalSummaryHeader(lines, input.report)
  appendEvalSummaryHeadline(lines, input.report)
  appendEvalSummarySelection(lines, input.report)
  appendEvalSummaryMetrics(lines, input.report)
  appendEvalSummaryRejectionsByReasonAndSeverity(lines, input.report)
  appendEvalSummaryRecallByTier(lines, input.report)
  appendEvalSummaryRecallByDiffScope(lines, input.report)
  appendEvalSummaryMetricGroups(lines, input.report)
  // Per-mechanism security labels are a secondary breakdown (label accuracy is not
  // a headline goal), rendered after the general aggregate metrics.
  appendEvalSummarySecurityByMechanism(lines, input.report)
  appendEvalSummarySecurityByContextDepth(lines, input.report)
  appendEvalSummaryCases(lines, {
    cases: input.cases,
    report: input.report
  })
  appendEvalSummaryAgenticStageCoverage(lines, input.report)
  appendEvalSummaryContextLedgerKinds(lines, input.report)
  appendEvalSummaryGateReasons(lines, input.report)
  appendEvalSummaryProviderIssues(lines, input.report)
  appendEvalSummarySemanticJudgeMatches(lines, input.report)
  appendEvalSummaryAttentionNeeded(lines, {
    cases: input.cases,
    report: input.report
  })

  appendEvalSummaryArtifacts(lines, artifactRoot)

  return `${lines.join('\n')}`
}
