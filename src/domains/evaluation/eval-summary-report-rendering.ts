import { z } from 'zod'
import { type EvalCase } from './eval-fixture.schema.js'
import {
  appendMarkdownBulletSection,
  appendMarkdownTable,
  escapeMarkdownCell,
  formatCostMetric,
  formatDuration,
  formatInteger,
  formatListValue,
  formatPercent
} from './eval-report-markdown-formatting.js'
import {
  expectedLocationLabel,
  expectedMatchModeLabel
} from './eval-report-expected-finding-labels.js'
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

export const EVAL_REPORT_ARTIFACT_NAME = 'eval-report.json'
export const EVAL_SUMMARY_ARTIFACT_NAME = 'eval-summary.md'
export const EVAL_RECALL_REPORT_ARTIFACT_NAME = 'eval-recall-report.md'

type EvalMetrics = EvalReport['metrics']

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
      `| Semantic matcher | ${report.scoring.semanticMatcher} |`
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
      `| Precision | ${formatPercent(report.metrics.precision)} |`,
      `| F1 | ${formatPercent(report.metrics.f1)} |`,
      `| Severity weighted F1 | ${formatPercent(report.metrics.severityWeightedF1)} |`,
      `| Line accuracy | ${formatPercent(report.metrics.lineAccuracy)} |`,
      `| Severity accuracy | ${formatPercent(report.metrics.severityAccuracy)} |`,
      `| Parse validity | ${formatPercent(report.metrics.parseValidity)} |`,
      `| Provider error rate | ${formatPercent(report.metrics.providerErrorRate)} |`,
      `| Provider issue rate | ${formatPercent(report.metrics.providerIssueRate)} (${report.metrics.providerIssueCount} cases) |`,
      `| False positives | ${report.metrics.falsePositiveCount} |`,
      `| Artifact-only recall | ${formatPercent(report.metrics.artifactOnlyRecall)} |`,
      `| Artifact-only precision | ${formatPercent(report.metrics.artifactOnlyPrecision)} |`,
      `| Artifact-only findings | ${report.metrics.artifactOnlyFindingCount} |`,
      `| Artifact-only matched | ${report.metrics.artifactOnlyMatchedFindingCount} |`,
      `| Artifact-only false positives | ${report.metrics.artifactOnlyFalsePositiveCount} |`,
      `| Trusted deterministic findings | ${report.metrics.trustedDeterministicFindingCount} |`,
      `| Refutation false negatives | ${report.metrics.refutationFalseNegativeCount} |`,
      `| Refutation false positives | ${report.metrics.refutationFalsePositiveCount} |`,
      `| Duplicate findings | ${report.metrics.duplicateFindingCount} |`,
      `| No-finding-zone hits | ${report.metrics.noFindingZoneFalsePositiveCount} |`,
      `| Actionable rate | ${formatPercent(report.metrics.actionableRate)} |`,
      `| Incomplete coverage rate | ${formatPercent(report.metrics.incompleteCoverageRate)} |`,
      `| Context mutation rate | ${formatPercent(report.metrics.contextMutationRate)} |`,
      `| Duration | ${formatDuration(report.metrics.durationMs)} |`,
      `| Input tokens | ${formatInteger(report.metrics.inputTokens)} |`,
      `| Input tokens (cached) | ${formatCachedInputTokens(report.metrics)} |`,
      `| Output tokens | ${formatInteger(report.metrics.outputTokens)} |`,
      `| Cost | ${formatCostMetric(report.metrics)} |`
    ]
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
    header: '| Tier | Recall | Precision |',
    alignment: '| --- | ---: | ---: |',
    rows: tierDisplayOrder.map(
      (tier) =>
        `| ${tier} | ${formatPercent(report.metrics.recallByTier[tier])} | ${formatPercent(report.metrics.precisionByTier[tier])} |`
    )
  })
}

type EvalSummaryMetricGroup = EvalReport['metricGroups'][number]

const formatEvalSummaryMetricGroupRow = (
  group: EvalSummaryMetricGroup
): string =>
  `| ${group.groupBy} | ${escapeMarkdownCell(group.key)} | ${group.fixtureCount} | ${formatPercent(group.metrics.recall)} | ${formatPercent(group.metrics.precision)} | ${formatPercent(group.metrics.f1)} | ${formatPercent(group.metrics.lineAccuracy)} | ${group.metrics.falsePositiveCount} |`

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
      '| Group | Key | Fixtures | Recall | Precision | F1 | Line accuracy | False positives |',
    alignment: '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    rows: summaryMetricGroups.map(formatEvalSummaryMetricGroupRow)
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
  lines.push('| Case | Refutation | Provider recovery |')
  lines.push('| --- | --- | --- |')
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
  const semanticJudgeMatches = report.caseResults.flatMap((caseResult) =>
    [...caseResult.matchedFindings, ...caseResult.artifactOnlyMatchedFindings]
      .filter((match) => match.semanticReason !== undefined)
      .map((match) => ({
        caseResult,
        match,
        reason: match.semanticReason!
      }))
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
      caseResult.artifactOnlyMatchedFindings.length > 0 ||
      caseResult.artifactOnlyFalsePositiveFindings.length > 0 ||
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
  readonly semanticScore: number
}

const formatAttentionMatchedFindingBullet = (
  caseResult: z.infer<typeof EvalCaseReportSchema>,
  match: EvalSummaryAttentionMatch
): string =>
  `- ${match.findingId} matched ${expectedLabelForMatch(caseResult, match.expectedIndex)} (semantic ${formatPercent(match.semanticScore)})`

type EvalSummaryExpectedFinding = EvalCase['expectedFindings'][number]

const formatAttentionMissedExpectedBullet = (
  expectedIndex: number,
  expected: EvalSummaryExpectedFinding
): string =>
  `- #${expectedIndex} ${expected.severity} ${expected.category} ${expectedLocationLabel(expected)} [${expectedMatchModeLabel(expected)}] - ${expected.semanticSummary}`

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
  appendEvalSummarySelection(lines, input.report)
  appendEvalSummaryMetrics(lines, input.report)
  appendEvalSummaryRecallByTier(lines, input.report)
  appendEvalSummaryMetricGroups(lines, input.report)
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
