import { z } from 'zod'
import type {
  AdmittedFinding,
  ReviewReport
} from '../../shared/contracts/index.js'
import {
  EvalCaseSchema,
  parseEvalCases,
  resolveExpectedFindingTier,
  type EvalCase
} from './eval-fixture.schema.js'
import {
  matchEvalFindings,
  matchEvalFindingsWithSemanticJudge,
  type EvalMatcherResult,
  type EvalSemanticJudge
} from './eval-matcher.js'
import {
  calculateEvalMetrics,
  emptyTierCounts,
  EvalMetricsSchema,
  severityWeight,
  type EvalMetricCaseResult,
  type EvalMetrics
} from './metrics.js'
import {
  EvalCaseOutputSchema,
  EvalCaseReportSchema,
  EvalAgenticStageReportSchema,
  EvalExpectedFindingReportSchema,
  EvalFalsePositiveFindingReportSchema,
  EvalMetricGroupSchema,
  EvalProviderIssueReportSchema,
  EvalRegressionThresholdsSchema,
  EvalRefutationResultReportSchema,
  EvalReportSchema,
  EvalReportSelectionSchema,
  type EvalCaseOutput,
  type EvalContextLedgerEntry,
  type EvalRegressionThresholds,
  type EvalReport,
  type EvalReportScoring,
  type EvalReportSelection
} from './eval-report-contracts.js'
import {
  EVAL_REPORT_ARTIFACT_NAME,
  EVAL_RECALL_REPORT_ARTIFACT_NAME,
  EVAL_SUMMARY_ARTIFACT_NAME,
  renderEvalComparison,
  renderEvalRecallReport,
  renderEvalSummary
} from './eval-report-rendering.js'

export {
  EvalRegressionThresholdsSchema,
  EvalReportSchema,
  type EvalCaseOutput,
  type EvalContextLedgerEntry,
  type EvalRegressionThresholds,
  type EvalReport,
  type EvalReportScoring,
  type EvalReportSelection
} from './eval-report-contracts.js'
export {
  EVAL_REPORT_ARTIFACT_NAME,
  EVAL_RECALL_REPORT_ARTIFACT_NAME,
  EVAL_SUMMARY_ARTIFACT_NAME,
  renderEvalComparison,
  renderEvalRecallReport,
  renderEvalSummary
} from './eval-report-rendering.js'

type EvalCaseComputation = {
  readonly reportCase: z.infer<typeof EvalCaseReportSchema>
  readonly metricCase: EvalMetricCaseResult
}

// Threshold helpers only compare scalar metrics; per-tier record metrics are
// excluded so a Record value never reaches a numeric comparison.
type NumericMetricKey = {
  [Key in keyof EvalMetrics]: EvalMetrics[Key] extends number ? Key : never
}[keyof EvalMetrics]

const formatMetricValue = (value: number): string => value.toString()

const expectedMatchModeLabel = (
  expected: EvalCase['expectedFindings'][number]
): 'path-line' | 'path-semantic' | 'semantic-only' =>
  expected.matchMode ??
  (expected.path === undefined
    ? 'semantic-only'
    : expected.lineRange === undefined
      ? 'path-semantic'
      : 'path-line')

const providerIssuesFromWarnings = (
  warnings: readonly string[]
): readonly z.infer<typeof EvalProviderIssueReportSchema>[] =>
  warnings.flatMap((warning) => {
    if (warning.startsWith('provider-error:')) {
      return [
        EvalProviderIssueReportSchema.parse({
          code: warning.slice('provider-error:'.length),
          recovered: false
        })
      ]
    }

    if (warning.startsWith('eval-provider-retry:')) {
      return [
        EvalProviderIssueReportSchema.parse({
          code: warning.slice('eval-provider-retry:'.length),
          recovered: true
        })
      ]
    }

    return []
  })

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

const falsePositiveFindingSummaries = (
  findings: readonly AdmittedFinding[],
  findingIds: readonly string[]
): readonly z.infer<typeof EvalFalsePositiveFindingReportSchema>[] => {
  const findingIdSet = new Set(findingIds)

  return findings
    .filter((finding) => findingIdSet.has(finding.id))
    .map((finding) =>
      EvalFalsePositiveFindingReportSchema.parse({
        findingId: finding.id,
        severity: finding.severity,
        category: finding.category,
        path: finding.location.path,
        line: finding.location.startLine,
        title: finding.title
      })
    )
}

const providerIssuesFromReport = (
  report: ReviewReport
): readonly z.infer<typeof EvalProviderIssueReportSchema>[] => [
  ...providerIssuesFromWarnings(report.run.warnings),
  ...report.providerIssues.map((issue) =>
    EvalProviderIssueReportSchema.parse({
      code: issue.code,
      ...(issue.stage === undefined ? {} : { stage: issue.stage }),
      recovered: issue.recovered ?? false,
      ...(issue.message === undefined ? {} : { message: issue.message })
    })
  )
]

const judgeProviderIssuesFromMatchResults = (
  results: readonly EvalMatcherResult[]
): readonly z.infer<typeof EvalProviderIssueReportSchema>[] =>
  results.flatMap((result) =>
    (result.judgeProviderIssues ?? []).map((issue) =>
      EvalProviderIssueReportSchema.parse({
        code: issue.code,
        stage: issue.stage,
        recovered: issue.recovered,
        ...(issue.message === undefined ? {} : { message: issue.message })
      })
    )
  )

const stageStatusForCount = (
  count: number
): z.infer<typeof EvalAgenticStageReportSchema>['status'] =>
  count > 0 ? 'active' : 'skipped'

const agenticStagesForReport = (
  report: ReviewReport
): readonly z.infer<typeof EvalAgenticStageReportSchema>[] => {
  const recoveredProviderIssues = providerIssuesFromReport(report).filter(
    (issue) => issue.recovered
  ).length
  const stageCounts = [
    ['refutation', report.refutationResults.length]
  ] as const

  return [
    ...stageCounts.map(([stage, count]) =>
      EvalAgenticStageReportSchema.parse({
        stage,
        status: stageStatusForCount(count),
        count
      })
    ),
    EvalAgenticStageReportSchema.parse({
      stage: 'provider-recovery',
      status: recoveredProviderIssues > 0 ? 'recovered' : 'skipped',
      count: recoveredProviderIssues
    })
  ]
}

const providerErrorStageNames = ['refutation'] as const

type ProviderErrorStageName = (typeof providerErrorStageNames)[number]

const isKnownProviderErrorStage = (
  stage: string | undefined
): stage is ProviderErrorStageName =>
  stage !== undefined &&
  (providerErrorStageNames as readonly string[]).includes(stage)

// When the failing stage is known, mark it as `error` instead of `skipped` so
// the hard provider error stays attributable to where it happened.
const agenticStagesForProviderError = (
  failingStage?: string
): readonly z.infer<typeof EvalAgenticStageReportSchema>[] =>
  providerErrorStageNames
    .map((stage) =>
      EvalAgenticStageReportSchema.parse({
        stage,
        status: stage === failingStage ? 'error' : 'skipped',
        count: 0
      })
    )
    .concat(
      EvalAgenticStageReportSchema.parse({
        stage: 'provider-recovery',
        status: 'error',
        count: 1
      })
    )

const refutationResultSummaries = (
  report: ReviewReport
): readonly z.infer<typeof EvalRefutationResultReportSchema>[] =>
  report.refutationResults.map((refutation) =>
    EvalRefutationResultReportSchema.parse({
      id: refutation.id,
      candidateId: refutation.candidateId,
      verdict: refutation.verdict
    })
  )

const actionableFindingsForEval = (
  admittedFindings: readonly AdmittedFinding[]
): readonly AdmittedFinding[] =>
  admittedFindings.filter(
    (finding) => finding.reporterEligibility !== 'artifact-only'
  )

const artifactOnlyFindingsForEval = (
  admittedFindings: readonly AdmittedFinding[]
): readonly AdmittedFinding[] =>
  admittedFindings.filter(
    (finding) => finding.reporterEligibility === 'artifact-only'
  )

const trustedDeterministicFindingsForEval = (
  admittedFindings: readonly AdmittedFinding[]
): readonly AdmittedFinding[] =>
  actionableFindingsForEval(admittedFindings).filter(
    (finding) => finding.proposedBy === 'deterministic-trusted-rule'
  )

const expectedFindingSummaries = (
  evalCase: EvalCase
): readonly z.infer<typeof EvalExpectedFindingReportSchema>[] =>
  evalCase.expectedFindings.map((expected, expectedIndex) =>
    EvalExpectedFindingReportSchema.parse({
      expectedIndex,
      category: expected.category,
      severity: expected.severity,
      ...(expected.path === undefined ? {} : { path: expected.path }),
      ...(expected.lineRange === undefined
        ? {}
        : { lineRange: [...expected.lineRange] }),
      matchMode: expectedMatchModeLabel(expected),
      semanticSummary: expected.semanticSummary
    })
  )

const tierCountsForCase = (
  evalCase: EvalCase,
  matchResult: EvalMatcherResult
): EvalMetricCaseResult['tierCounts'] => {
  const counts = emptyTierCounts()
  const matchedExpectedIndexes = new Set(
    matchResult.matches.map((match) => match.expectedIndex)
  )

  evalCase.expectedFindings.forEach((expected, expectedIndex) => {
    const tier = resolveExpectedFindingTier(expected)
    counts[tier] = {
      expected: counts[tier].expected + 1,
      matched:
        counts[tier].matched + (matchedExpectedIndexes.has(expectedIndex) ? 1 : 0)
    }
  })

  return counts
}

const buildMetricCase = (
  input: {
    readonly evalCase: EvalCase
    readonly output: EvalCaseOutput
    readonly matchResult: EvalMatcherResult
    readonly artifactOnlyMatchResult: EvalMatcherResult
    readonly reviewReport?: ReviewReport
  }
): EvalMetricCaseResult => {
  const judgeProviderIssueCount =
    (input.matchResult.judgeProviderIssues?.length ?? 0) +
    (input.artifactOnlyMatchResult.judgeProviderIssues?.length ?? 0)
  const admittedFindings = input.reviewReport?.admittedFindings ?? []
  const actionableFindings = actionableFindingsForEval(admittedFindings)
  const artifactOnlyFindings = artifactOnlyFindingsForEval(admittedFindings)
  const trustedDeterministicFindings =
    trustedDeterministicFindingsForEval(admittedFindings)
  const matchedExpectedSeverityWeights = input.matchResult.matches.map((match) =>
    severityWeight(input.evalCase.expectedFindings[match.expectedIndex]!.severity)
  )
  const matchedLineCheckCount = input.matchResult.matches.filter(
    (match) =>
      input.evalCase.expectedFindings[match.expectedIndex]?.lineRange !== undefined
  ).length
  const falsePositiveFindingIdSet = new Set(
    input.matchResult.falsePositiveFindingIds
  )
  const falsePositiveFindings = admittedFindings.filter((finding) =>
    falsePositiveFindingIdSet.has(finding.id)
  )
  const warnings = input.reviewReport?.run.warnings ?? []
  const providerIssues =
    input.reviewReport === undefined ? [] : providerIssuesFromReport(input.reviewReport)
  const contextLedgerEntries = input.output.contextLedger.filter(
    (entry) => entry.consideredForModelContext
  )
  const refutationResults = input.reviewReport?.refutationResults ?? []
  const rejectedFindings = input.reviewReport?.rejectedFindings ?? []

  return {
    caseId: input.evalCase.id,
    parseValid: input.reviewReport !== undefined,
    providerErrored: input.output.result.status === 'provider-error',
    providerIssueCount:
      input.output.result.status === 'provider-error'
        ? 1
        : providerIssues.length + judgeProviderIssueCount,
    expectedFindingCount: input.evalCase.expectedFindings.length,
    admittedFindingCount: actionableFindings.length,
    matchedFindingCount: input.matchResult.matches.length,
    expectedSeverityWeights: input.evalCase.expectedFindings.map((expected) =>
      severityWeight(expected.severity)
    ),
    matchedExpectedSeverityWeights,
    falsePositiveSeverityWeights: falsePositiveFindings.map((finding) =>
      severityWeight(finding.severity)
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
        : actionableFindings.filter((finding) =>
            isActionableFinding(finding, input.reviewReport!)
          ).length,
    falsePositiveCount: input.matchResult.falsePositiveFindingIds.length,
    duplicateFindingCount: input.matchResult.duplicateFindingIds.length,
    artifactOnlyFindingCount: artifactOnlyFindings.length,
    artifactOnlyMatchedFindingCount:
      input.artifactOnlyMatchResult.matches.length,
    artifactOnlyFalsePositiveCount:
      input.artifactOnlyMatchResult.falsePositiveFindingIds.length,
    trustedDeterministicFindingCount: trustedDeterministicFindings.length,
    provedRefutationCount: refutationResults.filter(
      (refutation) => refutation.verdict === 'proved'
    ).length,
    rejectedFindingCount: rejectedFindings.length,
    tierCounts: tierCountsForCase(input.evalCase, input.matchResult),
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
    inputTokens: input.reviewReport?.run.inputTokens ?? 0,
    cachedInputTokens: input.reviewReport?.run.cachedInputTokens ?? 0,
    outputTokens: input.reviewReport?.run.outputTokens ?? 0,
    costUnavailable: warnings.includes('cost-unavailable'),
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
      duplicateFindingIds: [],
      falsePositiveFindingIds: [],
      noFindingZoneFalsePositiveIds: []
    }

    return {
      reportCase: {
        caseId: evalCase.id,
        parseValid: false,
        providerErrored: true,
        providerIssues: [
          {
            code: output.result.code,
            ...(isKnownProviderErrorStage(output.result.stage)
              ? { stage: output.result.stage }
              : {}),
            recovered: false,
            message: output.result.message
          }
        ],
        agenticStages: [
          ...agenticStagesForProviderError(output.result.stage)
        ],
        contextLedger: [...output.contextLedger],
        expectedFindings: [...expectedFindingSummaries(evalCase)],
        matchedFindings: [],
        unmatchedExpectedIndexes: [...matchResult.unmatchedExpectedIndexes],
        duplicateFindingIds: [],
        duplicateFindings: [],
        falsePositiveFindingIds: [],
        falsePositiveFindings: [],
        noFindingZoneFalsePositiveIds: [],
        artifactOnlyFindingIds: [],
        artifactOnlyMatchedFindings: [],
        artifactOnlyFalsePositiveFindingIds: [],
        artifactOnlyFalsePositiveFindings: [],
        refutationResults: [],
        inlineFindingCount: 0,
        warnings: [`provider-error:${output.result.code}`],
        durationMs: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        costUnavailable: false,
        costUsd: 0
      },
      metricCase: buildMetricCase({
        evalCase,
        output,
        matchResult,
        artifactOnlyMatchResult: matchResult
      })
    }
  }

  const reviewReport = output.result.reviewReport
  const actionableFindings = actionableFindingsForEval(
    reviewReport.admittedFindings
  )
  const artifactOnlyFindings = artifactOnlyFindingsForEval(
    reviewReport.admittedFindings
  )
  const inlineFindingCount = reviewReport.admittedFindings.filter(
    (finding) => finding.reporterEligibility === 'inline'
  ).length
  const matchResult = matchEvalFindings({
    evalCase,
    admittedFindings: actionableFindings
  })
  const artifactOnlyMatchResult = matchEvalFindings({
    evalCase,
    admittedFindings: artifactOnlyFindings
  })

  return {
    reportCase: {
      caseId: evalCase.id,
      parseValid: true,
      providerErrored: false,
      contextLedger: [...output.contextLedger],
      agenticStages: [...agenticStagesForReport(reviewReport)],
      expectedFindings: [...expectedFindingSummaries(evalCase)],
      matchedFindings: [...matchResult.matches],
      unmatchedExpectedIndexes: [...matchResult.unmatchedExpectedIndexes],
      duplicateFindingIds: [...matchResult.duplicateFindingIds],
      duplicateFindings: [
        ...falsePositiveFindingSummaries(
          actionableFindings,
          matchResult.duplicateFindingIds
        )
      ],
      falsePositiveFindingIds: [...matchResult.falsePositiveFindingIds],
      falsePositiveFindings: [
        ...falsePositiveFindingSummaries(
          actionableFindings,
          matchResult.falsePositiveFindingIds
        )
      ],
      noFindingZoneFalsePositiveIds: [
        ...matchResult.noFindingZoneFalsePositiveIds
      ],
      artifactOnlyFindingIds: artifactOnlyFindings.map((finding) => finding.id),
      artifactOnlyMatchedFindings: [...artifactOnlyMatchResult.matches],
      artifactOnlyFalsePositiveFindingIds: [
        ...artifactOnlyMatchResult.falsePositiveFindingIds
      ],
      artifactOnlyFalsePositiveFindings: [
        ...falsePositiveFindingSummaries(
          artifactOnlyFindings,
          artifactOnlyMatchResult.falsePositiveFindingIds
        )
      ],
      refutationResults: [...refutationResultSummaries(reviewReport)],
      inlineFindingCount,
      providerIssues: [...providerIssuesFromReport(reviewReport)],
      warnings: [...reviewReport.run.warnings],
      durationMs: reviewReport.run.durationMs,
      inputTokens: reviewReport.run.inputTokens ?? 0,
      cachedInputTokens: reviewReport.run.cachedInputTokens ?? 0,
      outputTokens: reviewReport.run.outputTokens ?? 0,
      costUnavailable: reviewReport.run.warnings.includes('cost-unavailable'),
      costUsd: reviewReport.run.costUsd ?? 0
    },
    metricCase: buildMetricCase({
      evalCase,
      output,
      matchResult,
      artifactOnlyMatchResult,
      reviewReport
    })
  }
}

const computeCaseResultWithSemanticJudge = async (
  evalCase: EvalCase,
  output: EvalCaseOutput,
  judge: EvalSemanticJudge
): Promise<EvalCaseComputation> => {
  if (output.result.status === 'provider-error') {
    return computeCaseResult(evalCase, output)
  }

  const reviewReport = output.result.reviewReport
  const actionableFindings = actionableFindingsForEval(
    reviewReport.admittedFindings
  )
  const artifactOnlyFindings = artifactOnlyFindingsForEval(
    reviewReport.admittedFindings
  )
  const inlineFindingCount = reviewReport.admittedFindings.filter(
    (finding) => finding.reporterEligibility === 'inline'
  ).length
  const matchResult = await matchEvalFindingsWithSemanticJudge({
    evalCase,
    admittedFindings: actionableFindings,
    judge
  })
  const artifactOnlyMatchResult = await matchEvalFindingsWithSemanticJudge({
    evalCase,
    admittedFindings: artifactOnlyFindings,
    judge
  })

  return {
    reportCase: {
      caseId: evalCase.id,
      parseValid: true,
      providerErrored: false,
      contextLedger: [...output.contextLedger],
      agenticStages: [...agenticStagesForReport(reviewReport)],
      expectedFindings: [...expectedFindingSummaries(evalCase)],
      matchedFindings: [...matchResult.matches],
      unmatchedExpectedIndexes: [...matchResult.unmatchedExpectedIndexes],
      duplicateFindingIds: [...matchResult.duplicateFindingIds],
      duplicateFindings: [
        ...falsePositiveFindingSummaries(
          actionableFindings,
          matchResult.duplicateFindingIds
        )
      ],
      falsePositiveFindingIds: [...matchResult.falsePositiveFindingIds],
      falsePositiveFindings: [
        ...falsePositiveFindingSummaries(
          actionableFindings,
          matchResult.falsePositiveFindingIds
        )
      ],
      noFindingZoneFalsePositiveIds: [
        ...matchResult.noFindingZoneFalsePositiveIds
      ],
      artifactOnlyFindingIds: artifactOnlyFindings.map((finding) => finding.id),
      artifactOnlyMatchedFindings: [...artifactOnlyMatchResult.matches],
      artifactOnlyFalsePositiveFindingIds: [
        ...artifactOnlyMatchResult.falsePositiveFindingIds
      ],
      artifactOnlyFalsePositiveFindings: [
        ...falsePositiveFindingSummaries(
          artifactOnlyFindings,
          artifactOnlyMatchResult.falsePositiveFindingIds
        )
      ],
      refutationResults: [...refutationResultSummaries(reviewReport)],
      inlineFindingCount,
      providerIssues: [
        ...providerIssuesFromReport(reviewReport),
        ...judgeProviderIssuesFromMatchResults([
          matchResult,
          artifactOnlyMatchResult
        ])
      ],
      warnings: [...reviewReport.run.warnings],
      durationMs: reviewReport.run.durationMs,
      inputTokens: reviewReport.run.inputTokens ?? 0,
      cachedInputTokens: reviewReport.run.cachedInputTokens ?? 0,
      outputTokens: reviewReport.run.outputTokens ?? 0,
      costUnavailable: reviewReport.run.warnings.includes('cost-unavailable'),
      costUsd: reviewReport.run.costUsd ?? 0
    },
    metricCase: buildMetricCase({
      evalCase,
      output,
      matchResult,
      artifactOnlyMatchResult,
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

const metricCaseById = (
  metricCases: readonly EvalMetricCaseResult[]
): ReadonlyMap<string, EvalMetricCaseResult> =>
  new Map(metricCases.map((metricCase) => [metricCase.caseId, metricCase]))

const buildMetricGroupsForDimension = (
  input: {
    readonly cases: readonly EvalCase[]
    readonly metricCaseMap: ReadonlyMap<string, EvalMetricCaseResult>
    readonly groupBy: 'sourceProfile' | 'language' | 'tag'
  }
): readonly z.infer<typeof EvalMetricGroupSchema>[] => {
  const grouped = new Map<
    string,
    {
      readonly caseIds: string[]
      readonly metricCases: EvalMetricCaseResult[]
    }
  >()

  const addCase = (key: string, evalCase: EvalCase): void => {
    const metricCase = input.metricCaseMap.get(evalCase.id)
    if (metricCase === undefined) {
      return
    }

    const group = grouped.get(key) ?? { caseIds: [], metricCases: [] }
    group.caseIds.push(evalCase.id)
    group.metricCases.push(metricCase)
    grouped.set(key, group)
  }

  for (const evalCase of input.cases) {
    if (input.groupBy === 'sourceProfile') {
      addCase(evalCase.sourceProfile ?? 'project', evalCase)
    } else if (input.groupBy === 'language') {
      addCase(evalCase.language, evalCase)
    } else {
      for (const tag of evalCase.tags) {
        addCase(tag, evalCase)
      }
    }
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, group]) =>
      EvalMetricGroupSchema.parse({
        groupBy: input.groupBy,
        key,
        fixtureCount: group.caseIds.length,
        caseIds: group.caseIds,
        metrics: calculateEvalMetrics(group.metricCases)
      })
    )
}

const buildMetricGroups = (
  cases: readonly EvalCase[],
  metricCases: readonly EvalMetricCaseResult[]
): readonly z.infer<typeof EvalMetricGroupSchema>[] => {
  const metricCaseMap = metricCaseById(metricCases)

  return [
    ...buildMetricGroupsForDimension({
      cases,
      metricCaseMap,
      groupBy: 'sourceProfile'
    }),
    ...buildMetricGroupsForDimension({
      cases,
      metricCaseMap,
      groupBy: 'language'
    }),
    ...buildMetricGroupsForDimension({
      cases,
      metricCaseMap,
      groupBy: 'tag'
    })
  ]
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
    metricName: NumericMetricKey,
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
    metricName: NumericMetricKey,
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
  addBelowReason('productRecall', input.thresholds.minProductRecall)
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

type RunEvaluationInput = {
  readonly cases: unknown
  readonly outputs: readonly EvalCaseOutput[]
  readonly thresholds?: EvalRegressionThresholds
  readonly selection?: {
    readonly fixtureSource: EvalReportSelection['fixtureSource']
    readonly sliceRoot?: string
    readonly caseFilters: readonly string[]
    readonly selectedCaseIds?: readonly string[]
  }
  readonly generatedAt?: string
}

const buildEvaluationResult = (
  input: {
    readonly cases: readonly EvalCase[]
    readonly thresholds: EvalRegressionThresholds
    readonly selection?: RunEvaluationInput['selection']
    readonly scoring: EvalReportScoring
    readonly generatedAt?: string
    readonly caseComputations: readonly EvalCaseComputation[]
  }
): {
  readonly artifactName: typeof EVAL_REPORT_ARTIFACT_NAME
  readonly report: EvalReport
} => {
  const metricCases = input.caseComputations.map(
    (computation) => computation.metricCase
  )
  const metrics = calculateEvalMetrics(metricCases)
  const selection = EvalReportSelectionSchema.parse({
    fixtureSource: input.selection?.fixtureSource ?? 'default',
    ...(input.selection?.sliceRoot === undefined
      ? {}
      : { sliceRoot: input.selection.sliceRoot }),
    caseFilters: input.selection?.caseFilters ?? [],
    selectedCaseIds: input.cases.map((evalCase) => evalCase.id)
  })
  const metricGroups = buildMetricGroups(input.cases, metricCases)
  const gate = thresholdReasons({
    thresholds: input.thresholds,
    metrics,
    caseResults: metricCases
  })
  const report = EvalReportSchema.parse({
    schemaVersion: '1.0',
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    fixtureCount: input.cases.length,
    selection,
    scoring: input.scoring,
    caseResults: input.caseComputations.map((computation) => computation.reportCase),
    metrics,
    metricGroups,
    regressionGate: {
      passed: gate.reasons.length === 0,
      reasons: gate.reasons,
      thresholds: input.thresholds,
      failingCaseIds: gate.failingCaseIds
    }
  })

  return {
    artifactName: EVAL_REPORT_ARTIFACT_NAME,
    report
  }
}

const prepareEvaluationInputs = (
  input: RunEvaluationInput
): {
  readonly cases: readonly EvalCase[]
  readonly outputs: readonly EvalCaseOutput[]
  readonly thresholds: EvalRegressionThresholds
} => {
  const cases = parseEvalCases(input.cases)
  const outputs = z.array(EvalCaseOutputSchema).parse(input.outputs)
  const thresholds = EvalRegressionThresholdsSchema.parse(
    input.thresholds ?? {}
  )

  assertOutputCoverage(cases, outputs)

  return { cases, outputs, thresholds }
}

export const runEvaluation = (
  input: RunEvaluationInput
): {
  readonly artifactName: typeof EVAL_REPORT_ARTIFACT_NAME
  readonly report: EvalReport
} => {
  const prepared = prepareEvaluationInputs(input)
  const outputByCaseId = new Map(
    prepared.outputs.map((output) => [output.caseId, output])
  )
  const caseComputations = prepared.cases.map((evalCase) => {
    const output = outputByCaseId.get(evalCase.id)

    if (output === undefined) {
      throw new Error(`Missing eval output for case "${evalCase.id}".`)
    }

    return computeCaseResult(EvalCaseSchema.parse(evalCase), output)
  })

  return buildEvaluationResult({
    cases: prepared.cases,
    thresholds: prepared.thresholds,
    ...(input.selection === undefined ? {} : { selection: input.selection }),
    scoring: {
      semanticMatcher: 'deterministic'
    },
    ...(input.generatedAt === undefined ? {} : { generatedAt: input.generatedAt }),
    caseComputations
  })
}

export const runEvaluationWithSemanticJudge = async (
  input: RunEvaluationInput & {
    readonly judge: EvalSemanticJudge
  }
): Promise<{
  readonly artifactName: typeof EVAL_REPORT_ARTIFACT_NAME
  readonly report: EvalReport
}> => {
  const prepared = prepareEvaluationInputs(input)
  const outputByCaseId = new Map(
    prepared.outputs.map((output) => [output.caseId, output])
  )
  const caseComputations = await Promise.all(
    prepared.cases.map(async (evalCase) => {
      const output = outputByCaseId.get(evalCase.id)

      if (output === undefined) {
        throw new Error(`Missing eval output for case "${evalCase.id}".`)
      }

      return computeCaseResultWithSemanticJudge(
        EvalCaseSchema.parse(evalCase),
        output,
        input.judge
      )
    })
  )

  return buildEvaluationResult({
    cases: prepared.cases,
    thresholds: prepared.thresholds,
    ...(input.selection === undefined ? {} : { selection: input.selection }),
    scoring: {
      semanticMatcher: 'semantic-judge'
    },
    ...(input.generatedAt === undefined ? {} : { generatedAt: input.generatedAt }),
    caseComputations
  })
}
