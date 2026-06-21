import { z } from 'zod'
import {
  ReviewReportSchema,
  type AdmittedFinding,
  type ReviewReport
} from '../../shared/contracts/index.js'
import {
  EvalCaseSchema,
  parseEvalCases,
  type EvalCase
} from './eval-fixture.schema.js'
import { matchEvalFindings, type EvalMatcherResult } from './eval-matcher.js'
import {
  calculateEvalMetrics,
  EvalMetricsSchema,
  severityWeight,
  type EvalMetricCaseResult
} from './metrics.js'

export const EVAL_REPORT_ARTIFACT_NAME = 'eval-report.json'
export const EVAL_SUMMARY_ARTIFACT_NAME = 'eval-summary.md'

const EvalContextLedgerEntrySchema = z.strictObject({
  consideredForModelContext: z.boolean(),
  truncated: z.boolean()
})

const ProviderErrorSchema = z.strictObject({
  status: z.literal('provider-error'),
  code: z.string().min(1),
  message: z.string().min(1).max(500)
})

const SuccessfulEvalOutputSchema = z.strictObject({
  status: z.literal('ok'),
  reviewReport: ReviewReportSchema
})

const EvalCaseOutputSchema = z.strictObject({
  caseId: z.string().min(1),
  changedLineCount: z.int().min(0),
  diffHunkCount: z.int().min(0),
  contextLedger: z.array(EvalContextLedgerEntrySchema).default([]),
  result: z.discriminatedUnion('status', [
    SuccessfulEvalOutputSchema,
    ProviderErrorSchema
  ])
})

export const EvalRegressionThresholdsSchema = z.strictObject({
  minParseValidity: z.number().min(0).max(1).optional(),
  minRecall: z.number().min(0).max(1).optional(),
  minPrecision: z.number().min(0).max(1).optional(),
  minSeverityWeightedF1: z.number().min(0).max(1).optional(),
  maxFalsePositiveCount: z.int().min(0).optional(),
  maxCommentsPerKloc: z.number().min(0).optional(),
  maxCommentsPerDiffHunk: z.number().min(0).optional(),
  maxIncompleteCoverageRate: z.number().min(0).max(1).optional(),
  maxContextMutationRate: z.number().min(0).max(1).optional(),
  maxCostUsd: z.number().min(0).optional(),
  maxDurationMs: z.int().min(0).optional(),
  failOnProviderError: z.boolean().default(true)
})

const EvalFindingMatchReportSchema = z.strictObject({
  expectedIndex: z.int().min(0),
  findingId: z.string().min(1),
  semanticScore: z.number().min(0).max(1),
  lineOverlaps: z.boolean(),
  severityMatches: z.boolean()
})

const EvalCaseReportSchema = z.strictObject({
  caseId: z.string().min(1),
  parseValid: z.boolean(),
  providerErrored: z.boolean(),
  matchedFindings: z.array(EvalFindingMatchReportSchema),
  unmatchedExpectedIndexes: z.array(z.int().min(0)),
  falsePositiveFindingIds: z.array(z.string().min(1)),
  noFindingZoneFalsePositiveIds: z.array(z.string().min(1)),
  warnings: z.array(z.string()),
  durationMs: z.int().min(0),
  costUsd: z.number().min(0)
})

const EvalRegressionGateSchema = z.strictObject({
  passed: z.boolean(),
  reasons: z.array(z.string()),
  thresholds: EvalRegressionThresholdsSchema,
  failingCaseIds: z.array(z.string().min(1))
})

export const EvalReportSchema = z.strictObject({
  schemaVersion: z.literal('1.0'),
  generatedAt: z.iso.datetime(),
  fixtureCount: z.int().min(0),
  caseResults: z.array(EvalCaseReportSchema),
  metrics: EvalMetricsSchema,
  regressionGate: EvalRegressionGateSchema
})

export type EvalContextLedgerEntry = z.infer<typeof EvalContextLedgerEntrySchema>
export type EvalCaseOutput = z.infer<typeof EvalCaseOutputSchema>
export type EvalRegressionThresholds = z.infer<
  typeof EvalRegressionThresholdsSchema
>
export type EvalReport = z.infer<typeof EvalReportSchema>

type EvalCaseComputation = {
  readonly reportCase: z.infer<typeof EvalCaseReportSchema>
  readonly metricCase: EvalMetricCaseResult
}

const formatMetricValue = (value: number): string =>
  Number.isInteger(value) ? value.toString() : value.toString()

const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`

const formatDuration = (durationMs: number): string =>
  durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`

const formatCurrency = (value: number): string =>
  value === 0 ? '$0.00' : `$${value.toFixed(4)}`

const escapeMarkdownCell = (value: string): string =>
  value.replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ')

const formatLineRange = (
  lineRange: readonly [number, number] | undefined
): string => {
  if (lineRange === undefined) {
    return ''
  }

  const [startLine, endLine] = lineRange
  return startLine === endLine ? `:${startLine}` : `:${startLine}-${endLine}`
}

const caseStatus = (
  caseResult: z.infer<typeof EvalCaseReportSchema>
): 'PASS' | 'FAIL' | 'ERROR' => {
  if (caseResult.providerErrored || !caseResult.parseValid) {
    return 'ERROR'
  }

  return caseResult.unmatchedExpectedIndexes.length === 0 &&
    caseResult.falsePositiveFindingIds.length === 0 &&
    caseResult.noFindingZoneFalsePositiveIds.length === 0
    ? 'PASS'
    : 'FAIL'
}

const humanActionableWarnings = (
  warnings: readonly string[]
): readonly string[] =>
  warnings.filter((warning) => warning !== 'config-file-missing')

const noteForCase = (
  caseResult: z.infer<typeof EvalCaseReportSchema>
): string => {
  const notes: string[] = []
  const warnings = humanActionableWarnings(caseResult.warnings)

  if (caseResult.providerErrored) {
    notes.push('provider error')
  }

  if (caseResult.unmatchedExpectedIndexes.length > 0) {
    notes.push(`missing ${caseResult.unmatchedExpectedIndexes.length}`)
  }

  if (caseResult.falsePositiveFindingIds.length > 0) {
    notes.push(`false positives ${caseResult.falsePositiveFindingIds.length}`)
  }

  if (caseResult.noFindingZoneFalsePositiveIds.length > 0) {
    notes.push(
      `no-finding-zone hits ${caseResult.noFindingZoneFalsePositiveIds.length}`
    )
  }

  if (warnings.length > 0) {
    notes.push(`warnings ${warnings.length}`)
  }

  return notes.length === 0 ? '-' : notes.join('; ')
}

const findCase = (
  cases: readonly EvalCase[],
  caseId: string
): EvalCase | undefined => cases.find((evalCase) => evalCase.id === caseId)

export const renderEvalSummary = (
  input: {
    readonly cases: readonly EvalCase[]
    readonly report: EvalReport
    readonly artifactRoot?: string
  }
): string => {
  const artifactRoot = input.artifactRoot ?? '.review/eval'
  const lines: string[] = []
  const failedCases = input.report.caseResults.filter(
    (caseResult) => caseStatus(caseResult) !== 'PASS'
  )

  lines.push('# Evaluation Summary')
  lines.push('')
  lines.push(`Gate: ${input.report.regressionGate.passed ? 'PASS' : 'FAIL'}`)
  lines.push(`Generated: ${input.report.generatedAt}`)
  lines.push(`Fixtures: ${input.report.fixtureCount}`)
  lines.push('')
  lines.push('## Metrics')
  lines.push('')
  lines.push('| Metric | Value |')
  lines.push('| --- | --- |')
  lines.push(`| Recall | ${formatPercent(input.report.metrics.recall)} |`)
  lines.push(`| Precision | ${formatPercent(input.report.metrics.precision)} |`)
  lines.push(`| F1 | ${formatPercent(input.report.metrics.f1)} |`)
  lines.push(
    `| Severity weighted F1 | ${formatPercent(input.report.metrics.severityWeightedF1)} |`
  )
  lines.push(`| Line accuracy | ${formatPercent(input.report.metrics.lineAccuracy)} |`)
  lines.push(
    `| Severity accuracy | ${formatPercent(input.report.metrics.severityAccuracy)} |`
  )
  lines.push(`| Parse validity | ${formatPercent(input.report.metrics.parseValidity)} |`)
  lines.push(
    `| Provider error rate | ${formatPercent(input.report.metrics.providerErrorRate)} |`
  )
  lines.push(`| False positives | ${input.report.metrics.falsePositiveCount} |`)
  lines.push(
    `| No-finding-zone hits | ${input.report.metrics.noFindingZoneFalsePositiveCount} |`
  )
  lines.push(`| Actionable rate | ${formatPercent(input.report.metrics.actionableRate)} |`)
  lines.push(
    `| Incomplete coverage rate | ${formatPercent(input.report.metrics.incompleteCoverageRate)} |`
  )
  lines.push(
    `| Context mutation rate | ${formatPercent(input.report.metrics.contextMutationRate)} |`
  )
  lines.push(`| Duration | ${formatDuration(input.report.metrics.durationMs)} |`)
  lines.push(`| Cost | ${formatCurrency(input.report.metrics.costUsd)} |`)
  lines.push('')
  lines.push('## Cases')
  lines.push('')
  lines.push('| Case | Status | Expected | Matched | False positives | Notes |')
  lines.push('| --- | --- | ---: | ---: | ---: | --- |')

  for (const caseResult of input.report.caseResults) {
    const evalCase = findCase(input.cases, caseResult.caseId)
    const expectedCount = evalCase?.expectedFindings.length ?? 0
    lines.push(
      [
        '|',
        escapeMarkdownCell(caseResult.caseId),
        '|',
        caseStatus(caseResult),
        '|',
        String(expectedCount),
        '|',
        String(caseResult.matchedFindings.length),
        '|',
        String(caseResult.falsePositiveFindingIds.length),
        '|',
        escapeMarkdownCell(noteForCase(caseResult)),
        '|'
      ].join(' ')
    )
  }

  lines.push('')

  if (input.report.regressionGate.reasons.length > 0) {
    lines.push('## Gate Reasons')
    lines.push('')
    for (const reason of input.report.regressionGate.reasons) {
      lines.push(`- ${reason}`)
    }
    lines.push('')
  }

  if (failedCases.length > 0) {
    lines.push('## Attention Needed')
    lines.push('')
    for (const caseResult of failedCases) {
      const evalCase = findCase(input.cases, caseResult.caseId)
      lines.push(`### ${caseResult.caseId}`)
      lines.push('')

      if (caseResult.unmatchedExpectedIndexes.length > 0 && evalCase !== undefined) {
        lines.push('Missed expected findings:')
        for (const expectedIndex of caseResult.unmatchedExpectedIndexes) {
          const expected = evalCase.expectedFindings[expectedIndex]
          if (expected === undefined) {
            continue
          }

          lines.push(
            `- #${expectedIndex} ${expected.severity} ${expected.category} ${expected.path}${formatLineRange(expected.lineRange)} - ${expected.semanticSummary}`
          )
        }
      }

      if (caseResult.falsePositiveFindingIds.length > 0) {
        lines.push(
          `False positive finding IDs: ${caseResult.falsePositiveFindingIds.join(', ')}`
        )
      }

      if (caseResult.noFindingZoneFalsePositiveIds.length > 0) {
        lines.push(
          `No-finding-zone hit IDs: ${caseResult.noFindingZoneFalsePositiveIds.join(', ')}`
        )
      }

      const warnings = humanActionableWarnings(caseResult.warnings)
      if (warnings.length > 0) {
        lines.push(`Warnings: ${warnings.join(', ')}`)
      }

      lines.push('')
    }
  }

  lines.push('## Artifacts')
  lines.push('')
  lines.push(`- ${artifactRoot}/${EVAL_REPORT_ARTIFACT_NAME}`)
  lines.push(`- ${artifactRoot}/${EVAL_SUMMARY_ARTIFACT_NAME}`)
  lines.push('')

  return `${lines.join('\n')}`
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

const caseStatusById = (
  report: EvalReport
): ReadonlyMap<string, ReturnType<typeof caseStatus>> =>
  new Map(
    report.caseResults.map((caseResult) => [
      caseResult.caseId,
      caseStatus(caseResult)
    ])
  )

const transitionLabel = (
  baseStatus: ReturnType<typeof caseStatus> | undefined,
  headStatus: ReturnType<typeof caseStatus> | undefined
): string => {
  if (baseStatus === undefined) {
    return 'new'
  }

  if (headStatus === undefined) {
    return 'removed'
  }

  if (baseStatus !== 'PASS' && headStatus === 'PASS') {
    return 'fixed'
  }

  if (baseStatus === 'PASS' && headStatus !== 'PASS') {
    return 'regressed'
  }

  return baseStatus === headStatus ? 'unchanged' : 'changed'
}

export const renderEvalComparison = (
  input: {
    readonly base: EvalReport
    readonly head: EvalReport
    readonly baseLabel?: string
    readonly headLabel?: string
  }
): string => {
  const baseLabel = input.baseLabel ?? 'base'
  const headLabel = input.headLabel ?? 'head'
  const baseStatus = caseStatusById(input.base)
  const headStatus = caseStatusById(input.head)
  const caseIds = [...new Set([...baseStatus.keys(), ...headStatus.keys()])].sort(
    (left, right) => left.localeCompare(right)
  )
  const lines: string[] = []

  lines.push('# Evaluation Comparison')
  lines.push('')
  lines.push(`Base: ${baseLabel}`)
  lines.push(`Head: ${headLabel}`)
  lines.push('')
  lines.push('## Gate')
  lines.push('')
  lines.push('| Report | Gate | Fixtures | Generated |')
  lines.push('| --- | --- | ---: | --- |')
  lines.push(
    `| Base | ${input.base.regressionGate.passed ? 'PASS' : 'FAIL'} | ${input.base.fixtureCount} | ${input.base.generatedAt} |`
  )
  lines.push(
    `| Head | ${input.head.regressionGate.passed ? 'PASS' : 'FAIL'} | ${input.head.fixtureCount} | ${input.head.generatedAt} |`
  )
  lines.push('')
  lines.push('## Metric Deltas')
  lines.push('')
  lines.push('| Metric | Base | Head | Delta |')
  lines.push('| --- | ---: | ---: | ---: |')
  lines.push(
    `| Recall | ${formatPercent(input.base.metrics.recall)} | ${formatPercent(input.head.metrics.recall)} | ${formatPercentagePointDelta(
      input.base.metrics.recall,
      input.head.metrics.recall
    )} |`
  )
  lines.push(
    `| Precision | ${formatPercent(input.base.metrics.precision)} | ${formatPercent(input.head.metrics.precision)} | ${formatPercentagePointDelta(
      input.base.metrics.precision,
      input.head.metrics.precision
    )} |`
  )
  lines.push(
    `| F1 | ${formatPercent(input.base.metrics.f1)} | ${formatPercent(input.head.metrics.f1)} | ${formatPercentagePointDelta(
      input.base.metrics.f1,
      input.head.metrics.f1
    )} |`
  )
  lines.push(
    `| Severity weighted F1 | ${formatPercent(input.base.metrics.severityWeightedF1)} | ${formatPercent(input.head.metrics.severityWeightedF1)} | ${formatPercentagePointDelta(
      input.base.metrics.severityWeightedF1,
      input.head.metrics.severityWeightedF1
    )} |`
  )
  lines.push(
    `| False positives | ${input.base.metrics.falsePositiveCount} | ${input.head.metrics.falsePositiveCount} | ${formatNumberDelta(
      input.base.metrics.falsePositiveCount,
      input.head.metrics.falsePositiveCount
    )} |`
  )
  lines.push(
    `| Duration | ${formatDuration(input.base.metrics.durationMs)} | ${formatDuration(input.head.metrics.durationMs)} | ${formatNumberDelta(
      input.base.metrics.durationMs,
      input.head.metrics.durationMs
    )}ms |`
  )
  lines.push(
    `| Cost | ${formatCurrency(input.base.metrics.costUsd)} | ${formatCurrency(input.head.metrics.costUsd)} | ${formatNumberDelta(
      input.base.metrics.costUsd,
      input.head.metrics.costUsd
    )} |`
  )
  lines.push('')
  lines.push('## Case Transitions')
  lines.push('')
  lines.push('| Case | Base | Head | Change |')
  lines.push('| --- | --- | --- | --- |')

  for (const caseId of caseIds) {
    const baseCaseStatus = baseStatus.get(caseId)
    const headCaseStatus = headStatus.get(caseId)
    lines.push(
      `| ${escapeMarkdownCell(caseId)} | ${baseCaseStatus ?? '-'} | ${headCaseStatus ?? '-'} | ${transitionLabel(
        baseCaseStatus,
        headCaseStatus
      )} |`
    )
  }

  lines.push('')

  return lines.join('\n')
}

const isActionableFinding = (
  finding: AdmittedFinding,
  reviewReport: ReviewReport
): boolean => {
  const hasLocation = finding.location.path.length > 0 && finding.location.startLine > 0
  const hasEvidence = finding.evidenceIds.some((evidenceId) =>
    reviewReport.evidence.some((evidence) => evidence.id === evidenceId)
  )

  const hasSuggestedFix =
    finding.fixProposal !== undefined &&
    finding.fixProposal.evidenceIds.some((evidenceId) =>
      finding.evidenceIds.includes(evidenceId)
    ) &&
    finding.fixProposal.summary.trim().length > 0
  const hasLegacySuggestedFix =
    finding.suggestedFix !== undefined &&
    finding.suggestedFix.trim().length > 0

  return (
    hasLocation &&
    hasEvidence &&
    finding.description.trim().length > 0 &&
    (hasSuggestedFix || hasLegacySuggestedFix)
  )
}

const dedupeSorted = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right))

const findingIdsByIndex = (
  findings: readonly AdmittedFinding[],
  indexes: readonly number[]
): readonly string[] =>
  indexes
    .map((index) => findings[index]?.id)
    .filter((id): id is string => id !== undefined)

const buildMetricCase = (
  input: {
    readonly evalCase: EvalCase
    readonly output: EvalCaseOutput
    readonly matchResult: EvalMatcherResult
    readonly reviewReport?: ReviewReport
  }
): EvalMetricCaseResult => {
  const admittedFindings = input.reviewReport?.admittedFindings ?? []
  const matchedExpectedSeverityWeights = input.matchResult.matches.map((match) =>
    severityWeight(input.evalCase.expectedFindings[match.expectedIndex]!.severity)
  )
  const matchedLineCheckCount = input.matchResult.matches.filter(
    (match) =>
      input.evalCase.expectedFindings[match.expectedIndex]?.lineRange !== undefined
  ).length
  const falsePositiveIndexes = admittedFindings
    .map((_finding, index) => index)
    .filter(
      (index) =>
        !input.matchResult.matches.some(
          (match) => admittedFindings[index]?.id === match.findingId
        )
    )
  const warnings = input.reviewReport?.run.warnings ?? []
  const contextLedgerEntries = input.output.contextLedger.filter(
    (entry) => entry.consideredForModelContext
  )

  return {
    caseId: input.evalCase.id,
    parseValid: input.reviewReport !== undefined,
    providerErrored: input.output.result.status === 'provider-error',
    expectedFindingCount: input.evalCase.expectedFindings.length,
    admittedFindingCount: admittedFindings.length,
    matchedFindingCount: input.matchResult.matches.length,
    expectedSeverityWeights: input.evalCase.expectedFindings.map((expected) =>
      severityWeight(expected.severity)
    ),
    matchedExpectedSeverityWeights,
    falsePositiveSeverityWeights: falsePositiveIndexes.map((index) =>
      severityWeight(admittedFindings[index]!.severity)
    ),
    matchedLineCheckCount,
    accurateLineMatchCount: input.matchResult.matches.filter(
      (match) =>
        input.evalCase.expectedFindings[match.expectedIndex]?.lineRange !==
          undefined && match.lineOverlaps
    ).length,
    matchedSeverityCheckCount: input.matchResult.matches.length,
    accurateSeverityMatchCount: input.matchResult.matches.filter(
      (match) => match.severityMatches
    ).length,
    actionableFindingCount:
      input.reviewReport === undefined
        ? 0
        : admittedFindings.filter((finding) =>
            isActionableFinding(finding, input.reviewReport!)
          ).length,
    falsePositiveCount: input.matchResult.falsePositiveFindingIds.length,
    noFindingZoneFalsePositiveCount:
      input.matchResult.noFindingZoneFalsePositiveIds.length,
    changedLineCount: input.output.changedLineCount,
    diffHunkCount: input.output.diffHunkCount,
    coverageIncomplete: input.reviewReport?.coverage.status === 'incomplete',
    contextLedgerEntryCount: contextLedgerEntries.length,
    mutatedContextLedgerEntryCount: contextLedgerEntries.filter(
      (entry) => entry.truncated
    ).length,
    costUsd: input.reviewReport?.run.costUsd ?? 0,
    durationMs: input.reviewReport?.run.durationMs ?? 0,
    warnings,
    failingFindingIds: input.matchResult.falsePositiveFindingIds
  }
}

const computeCaseResult = (
  evalCase: EvalCase,
  output: EvalCaseOutput
): EvalCaseComputation => {
  if (output.result.status === 'provider-error') {
    const matchResult: EvalMatcherResult = {
      matches: [],
      unmatchedExpectedIndexes: evalCase.expectedFindings.map(
        (_finding, index) => index
      ),
      falsePositiveFindingIds: [],
      noFindingZoneFalsePositiveIds: []
    }

    return {
      reportCase: {
        caseId: evalCase.id,
        parseValid: false,
        providerErrored: true,
        matchedFindings: [],
        unmatchedExpectedIndexes: [...matchResult.unmatchedExpectedIndexes],
        falsePositiveFindingIds: [],
        noFindingZoneFalsePositiveIds: [],
        warnings: [`provider-error:${output.result.code}`],
        durationMs: 0,
        costUsd: 0
      },
      metricCase: buildMetricCase({
        evalCase,
        output,
        matchResult
      })
    }
  }

  const reviewReport = output.result.reviewReport
  const matchResult = matchEvalFindings({
    evalCase,
    admittedFindings: reviewReport.admittedFindings
  })

  return {
    reportCase: {
      caseId: evalCase.id,
      parseValid: true,
      providerErrored: false,
      matchedFindings: [...matchResult.matches],
      unmatchedExpectedIndexes: [...matchResult.unmatchedExpectedIndexes],
      falsePositiveFindingIds: [...matchResult.falsePositiveFindingIds],
      noFindingZoneFalsePositiveIds: [
        ...matchResult.noFindingZoneFalsePositiveIds
      ],
      warnings: [...reviewReport.run.warnings],
      durationMs: reviewReport.run.durationMs,
      costUsd: reviewReport.run.costUsd ?? 0
    },
    metricCase: buildMetricCase({
      evalCase,
      output,
      matchResult,
      reviewReport
    })
  }
}

const assertOutputCoverage = (
  cases: readonly EvalCase[],
  outputs: readonly EvalCaseOutput[]
): void => {
  const caseIds = new Set(cases.map((evalCase) => evalCase.id))
  const seenOutputIds = new Set<string>()

  for (const output of outputs) {
    if (!caseIds.has(output.caseId)) {
      throw new Error(`Eval output references unknown case "${output.caseId}".`)
    }

    if (seenOutputIds.has(output.caseId)) {
      throw new Error(`Duplicate eval output for case "${output.caseId}".`)
    }

    seenOutputIds.add(output.caseId)
  }

  for (const evalCase of cases) {
    if (!seenOutputIds.has(evalCase.id)) {
      throw new Error(`Missing eval output for case "${evalCase.id}".`)
    }
  }
}

const thresholdReasons = (
  input: {
    readonly thresholds: EvalRegressionThresholds
    readonly metrics: z.infer<typeof EvalMetricsSchema>
    readonly caseResults: readonly EvalMetricCaseResult[]
  }
): {
  readonly reasons: readonly string[]
  readonly failingCaseIds: readonly string[]
} => {
  const reasons: string[] = []
  const failingCaseIds: string[] = []
  const addBelowReason = (
    metricName: keyof z.infer<typeof EvalMetricsSchema>,
    threshold: number | undefined
  ): void => {
    if (threshold === undefined) {
      return
    }

    const value = input.metrics[metricName]
    if (value < threshold) {
      reasons.push(
        `${metricName} below threshold: ${formatMetricValue(value)} < ${formatMetricValue(threshold)}`
      )
      failingCaseIds.push(...input.caseResults.map((result) => result.caseId))
    }
  }
  const addAboveReason = (
    metricName: keyof z.infer<typeof EvalMetricsSchema>,
    threshold: number | undefined,
    casesForMetric: readonly EvalMetricCaseResult[]
  ): void => {
    if (threshold === undefined) {
      return
    }

    const value = input.metrics[metricName]
    if (value > threshold) {
      reasons.push(
        `${metricName} above threshold: ${formatMetricValue(value)} > ${formatMetricValue(threshold)}`
      )
      failingCaseIds.push(...casesForMetric.map((result) => result.caseId))
    }
  }

  if (
    input.thresholds.failOnProviderError &&
    input.caseResults.some((result) => result.providerErrored)
  ) {
    reasons.push('provider error present')
    failingCaseIds.push(
      ...input.caseResults
        .filter((result) => result.providerErrored)
        .map((result) => result.caseId)
    )
  }

  addBelowReason('parseValidity', input.thresholds.minParseValidity)
  addBelowReason('recall', input.thresholds.minRecall)
  addBelowReason('precision', input.thresholds.minPrecision)
  addBelowReason(
    'severityWeightedF1',
    input.thresholds.minSeverityWeightedF1
  )
  addAboveReason(
    'falsePositiveCount',
    input.thresholds.maxFalsePositiveCount,
    input.caseResults.filter((result) => result.falsePositiveCount > 0)
  )
  addAboveReason(
    'commentsPerKloc',
    input.thresholds.maxCommentsPerKloc,
    input.caseResults
  )
  addAboveReason(
    'commentsPerDiffHunk',
    input.thresholds.maxCommentsPerDiffHunk,
    input.caseResults
  )
  addAboveReason(
    'incompleteCoverageRate',
    input.thresholds.maxIncompleteCoverageRate,
    input.caseResults.filter((result) => result.coverageIncomplete)
  )
  addAboveReason(
    'contextMutationRate',
    input.thresholds.maxContextMutationRate,
    input.caseResults.filter(
      (result) => result.mutatedContextLedgerEntryCount > 0
    )
  )
  addAboveReason('costUsd', input.thresholds.maxCostUsd, input.caseResults)
  addAboveReason('durationMs', input.thresholds.maxDurationMs, input.caseResults)

  return {
    reasons,
    failingCaseIds: dedupeSorted(failingCaseIds)
  }
}

export const runEvaluation = (
  input: {
    readonly cases: unknown
    readonly outputs: readonly EvalCaseOutput[]
    readonly thresholds?: EvalRegressionThresholds
    readonly generatedAt?: string
  }
): {
  readonly artifactName: typeof EVAL_REPORT_ARTIFACT_NAME
  readonly report: EvalReport
} => {
  const cases = parseEvalCases(input.cases)
  const outputs = z.array(EvalCaseOutputSchema).parse(input.outputs)
  const thresholds = EvalRegressionThresholdsSchema.parse(
    input.thresholds ?? {}
  )

  assertOutputCoverage(cases, outputs)

  const outputByCaseId = new Map(outputs.map((output) => [output.caseId, output]))
  const caseComputations = cases.map((evalCase) => {
    const output = outputByCaseId.get(evalCase.id)

    if (output === undefined) {
      throw new Error(`Missing eval output for case "${evalCase.id}".`)
    }

    return computeCaseResult(EvalCaseSchema.parse(evalCase), output)
  })
  const metricCases = caseComputations.map(
    (computation) => computation.metricCase
  )
  const metrics = calculateEvalMetrics(metricCases)
  const gate = thresholdReasons({
    thresholds,
    metrics,
    caseResults: metricCases
  })
  const report = EvalReportSchema.parse({
    schemaVersion: '1.0',
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    fixtureCount: cases.length,
    caseResults: caseComputations.map((computation) => computation.reportCase),
    metrics,
    regressionGate: {
      passed: gate.reasons.length === 0,
      reasons: gate.reasons,
      thresholds,
      failingCaseIds: gate.failingCaseIds
    }
  })

  return {
    artifactName: EVAL_REPORT_ARTIFACT_NAME,
    report
  }
}
