import type { Logger } from '@purista/harness'
import { performance } from 'node:perf_hooks'
import { z } from 'zod'
import type {
  AdmittedFinding,
  ReviewReport
} from '../../shared/contracts/index.js'
import { uniqueSorted } from '../../shared/text/unique-sorted.js'
import { COST_UNAVAILABLE_WARNING, type RunCostSummary } from '../costs/index.js'
import {
  EVAL_PROVIDER_RETRY_WARNING_PREFIX,
  inconclusiveMatchWarnings,
  plausibilityFailClosedWarnings,
  PROVIDER_ERROR_WARNING_PREFIX
} from './eval-warnings.js'
import {
  EvalCaseSchema,
  parseEvalCases,
  resolveExpectedFindingMatchMode,
  resolveExpectedFindingTier,
  type EvalCase
} from './eval-fixture.schema.js'
import {
  matchEvalFindings,
  missingSemanticJudgeError,
  type EvalMatcherResult,
  type EvalSemanticJudge
} from './eval-matcher.js'
import {
  scoreJudgeCalibration,
  type EvalJudgeCalibrationResult
} from './eval-judge-calibration.js'
import {
  scorePlausibilityCalibration,
  type EvalPlausibilityCalibrationResult
} from './eval-plausibility-calibration.js'
import {
  judgeUnmatchedFindingsPlausibility,
  type EvalCaseFileReader,
  type EvalPlausibilityJudge,
  type EvalPlausibilityResult
} from './eval-plausibility-judge.js'
import {
  calculateEvalMetrics,
  emptySecurityContextDepthCounts,
  emptySecurityMechanismCounts,
  emptyTierCounts,
  EvalMetricsSchema,
  severityWeight,
  type EvalJudgeReliability,
  type EvalMetricCaseResult,
  type EvalMetrics,
  type EvalRunTotals
} from './metrics.js'
import {
  EvalCaseOutputSchema,
  EvalCaseReportSchema,
  EvalAgenticStageReportSchema,
  EvalExpectedFindingReportSchema,
  EVAL_METRICS_VERSION,
  EvalFalsePositiveFindingReportSchema,
  EvalMetricGroupSchema,
  EvalProviderIssueReportSchema,
  EvalRegressionThresholdsSchema,
  EvalRefutationResultReportSchema,
  EvalReportSchema,
  EvalReportSelectionSchema,
  type EvalCaseOutput,
  type EvalRegressionThresholds,
  type EvalReport,
  type EvalReportScoring,
  type EvalReportSelection
} from './eval-report-contracts.js'
import { EVAL_REPORT_ARTIFACT_NAME } from './eval-summary-report-rendering.js'

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
  renderEvalSummary
} from './eval-summary-report-rendering.js'
export { renderEvalComparison } from './eval-comparison-report-rendering.js'
export { renderEvalRecallReport } from './eval-recall-report-rendering.js'

type EvalCaseComputation = {
  readonly reportCase: z.infer<typeof EvalCaseReportSchema>
  readonly metricCase: EvalMetricCaseResult
}

// Threshold helpers only compare scalar metrics; per-tier record metrics are
// excluded so a Record value never reaches a numeric comparison.
// `-?` strips optionality so an optional metric (e.g. `judgeAgreement`) cannot
// leak `undefined` into the key union and index the metrics record.
type NumericMetricKey = {
  [Key in keyof EvalMetrics]-?: EvalMetrics[Key] extends number ? Key : never
}[keyof EvalMetrics]

const formatMetricValue = (value: number): string => value.toString()

const providerIssuesFromWarnings = (
  warnings: readonly string[]
): readonly z.infer<typeof EvalProviderIssueReportSchema>[] =>
  warnings.flatMap((warning) => {
    if (warning.startsWith(PROVIDER_ERROR_WARNING_PREFIX)) {
      return [
        EvalProviderIssueReportSchema.parse({
          code: warning.slice(PROVIDER_ERROR_WARNING_PREFIX.length),
          recovered: false
        })
      ]
    }

    if (warning.startsWith(EVAL_PROVIDER_RETRY_WARNING_PREFIX)) {
      return [
        EvalProviderIssueReportSchema.parse({
          code: warning.slice(EVAL_PROVIDER_RETRY_WARNING_PREFIX.length),
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

  const hasFixProposal =
    finding.fixProposal !== undefined &&
    finding.fixProposal.evidenceIds.some((evidenceId) =>
      finding.evidenceIds.includes(evidenceId)
    ) &&
    finding.fixProposal.summary.trim().length > 0

  return (
    hasLocation &&
    hasEvidence &&
    finding.description.trim().length > 0 &&
    hasFixProposal
  )
}

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
  report: ReviewReport,
  // Count of fix-lane outcomes the case produced. The lane is a real agentic
  // step (spec 12), so it appears here as active/skipped with its count, matching
  // the refutation and provider-recovery stages for the per-step comparison view.
  fixOutcomeCount: number
): readonly z.infer<typeof EvalAgenticStageReportSchema>[] => {
  const providerIssues = providerIssuesFromReport(report)
  const recoveredProviderIssues = providerIssues.filter(
    (issue) => issue.recovered
  ).length
  // A fix lane that crashed produces no outcomes, and so did a lane that was
  // disabled or found nothing eligible. Counting alone cannot tell those apart,
  // and reporting a crash as `skipped` hides a broken stage behind a word that
  // means "correctly did nothing". An unrecovered fix-stage provider issue is
  // the signal that separates them.
  const fixLaneFailed = providerIssues.some(
    (issue) => issue.stage === 'fix' && !issue.recovered
  )
  const stageCounts = [
    ['refutation', report.refutationResults.length],
    ['fix', fixOutcomeCount]
  ] as const

  return [
    ...stageCounts.map(([stage, count]) =>
      EvalAgenticStageReportSchema.parse({
        stage,
        status:
          stage === 'fix' && count === 0 && fixLaneFailed
            ? 'error'
            : stageStatusForCount(count),
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

const providerErrorStageNames = ['refutation', 'fix'] as const

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
      matchMode: resolveExpectedFindingMatchMode(expected),
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
  // Inconclusive expectations leave the per-tier recall denominator for the
  // same reason they leave the aggregate one: a failed judge call is not a miss.
  const inconclusiveExpectedIndexes = new Set(
    matchResult.inconclusiveExpectedIndexes
  )

  evalCase.expectedFindings.forEach((expected, expectedIndex) => {
    if (inconclusiveExpectedIndexes.has(expectedIndex)) {
      return
    }

    const tier = resolveExpectedFindingTier(expected)
    counts[tier] = {
      expected: counts[tier].expected + 1,
      matched:
        counts[tier].matched + (matchedExpectedIndexes.has(expectedIndex) ? 1 : 0)
    }
  })

  return counts
}

// Join the match result to the labelled expected findings so the security
// dimension (spec 15) is scored per mechanism and per context depth. Only
// security-category expected findings carrying the respective label enter the
// counts, so a non-security finding never touches a security denominator, and an
// inconclusive expectation leaves the denominator for the same reason it leaves
// the aggregate recall one: a failed judge call is not a miss.
const securityCountsForCase = (
  evalCase: EvalCase,
  matchResult: EvalMatcherResult
): {
  readonly securityMechanismCounts: EvalMetricCaseResult['securityMechanismCounts']
  readonly securityContextDepthCounts: EvalMetricCaseResult['securityContextDepthCounts']
} => {
  const securityMechanismCounts = emptySecurityMechanismCounts()
  const securityContextDepthCounts = emptySecurityContextDepthCounts()
  const matchedExpectedIndexes = new Set(
    matchResult.matches.map((match) => match.expectedIndex)
  )
  const inconclusiveExpectedIndexes = new Set(
    matchResult.inconclusiveExpectedIndexes
  )

  evalCase.expectedFindings.forEach((expected, expectedIndex) => {
    if (
      expected.category !== 'security' ||
      inconclusiveExpectedIndexes.has(expectedIndex)
    ) {
      return
    }

    const matched = matchedExpectedIndexes.has(expectedIndex) ? 1 : 0

    if (expected.securityMechanism !== undefined) {
      const current = securityMechanismCounts[expected.securityMechanism]
      securityMechanismCounts[expected.securityMechanism] = {
        expected: current.expected + 1,
        matched: current.matched + matched
      }
    }

    if (expected.contextDepth !== undefined) {
      const current = securityContextDepthCounts[expected.contextDepth]
      securityContextDepthCounts[expected.contextDepth] = {
        expected: current.expected + 1,
        matched: current.matched + matched
      }
    }
  })

  return { securityMechanismCounts, securityContextDepthCounts }
}

type FixLaneCaseTallies = {
  readonly fixJudgmentAgreementCount: number
  readonly fixJudgedLabeledCount: number
  readonly fixFalsePositiveDetectedCount: number
  readonly fixGroundTruthFalsePositiveCount: number
  readonly fixProducedForRealCount: number
  readonly fixRealFindingCount: number
  readonly fixApplyFailedCount: number
  readonly fixApplyAttemptedCount: number
}

// Join the fix lane's per-finding outcomes to the ground truth so its accuracy
// (spec 12) is scored the way the product actually behaves:
//
// - Ground truth is corrected by the plausibility judge. A matched finding OR an
//   unmatched finding the plausibility judge deemed a real-but-unlisted defect is
//   a real defect; only a genuine false positive is a non-defect. Raw
//   matched/unmatched would score a correct `real` judgment on an unlisted-real
//   finding as wrong — the same fixture-incompleteness inversion adjustedPrecision
//   fixes (spec 06). A fail-closed (unjudged) finding stays a genuine false
//   positive.
// - Every denominator is restricted to fix-lane-eligible findings. The lane runs
//   only on findings at/above `fix.minSeverity`, and only those produce an
//   outcome — so iterating the outcomes is exactly the eligible set. A matched or
//   false-positive finding below the floor the lane never touched is neither
//   credited nor penalised.
export const fixLaneCaseTallies = (
  input: {
    readonly fixOutcomes: EvalCaseOutput['fixOutcomes']
    readonly matchResult: EvalMatcherResult
    readonly unlistedRealFindingIds: readonly string[]
  }
): FixLaneCaseTallies => {
  const matchedFindingIds = new Set(
    input.matchResult.matches.map((match) => match.findingId)
  )
  const unlistedRealFindingIds = new Set(input.unlistedRealFindingIds)
  const rawFalsePositiveFindingIds = new Set(
    input.matchResult.falsePositiveFindingIds
  )
  const isReal = (findingId: string): boolean =>
    matchedFindingIds.has(findingId) || unlistedRealFindingIds.has(findingId)
  // A genuine false positive is an unmatched finding the plausibility judge did
  // not credit as real (spurious or fail-closed).
  const isGenuineFalsePositive = (findingId: string): boolean =>
    rawFalsePositiveFindingIds.has(findingId) &&
    !unlistedRealFindingIds.has(findingId)

  let fixJudgmentAgreementCount = 0
  let fixJudgedLabeledCount = 0
  let fixApplyFailedCount = 0
  let fixApplyAttemptedCount = 0
  let fixRealFindingCount = 0
  let fixProducedForRealCount = 0
  let fixGroundTruthFalsePositiveCount = 0
  let fixFalsePositiveDetectedCount = 0

  for (const outcome of input.fixOutcomes) {
    const real = isReal(outcome.findingId)
    const genuineFalsePositive = isGenuineFalsePositive(outcome.findingId)

    if (outcome.findingJudgment !== undefined && (real || genuineFalsePositive)) {
      fixJudgedLabeledCount += 1
      const groundTruth = real ? 'real' : 'false-positive'
      if (outcome.findingJudgment === groundTruth) {
        fixJudgmentAgreementCount += 1
      }
    }

    if (real) {
      fixRealFindingCount += 1
      if (outcome.applyCheck === 'passed') {
        fixProducedForRealCount += 1
      }
    }

    if (genuineFalsePositive) {
      fixGroundTruthFalsePositiveCount += 1
      if (outcome.findingJudgment === 'false-positive') {
        fixFalsePositiveDetectedCount += 1
      }
    }

    if (outcome.applyCheck === 'passed' || outcome.applyCheck === 'failed') {
      fixApplyAttemptedCount += 1
      if (outcome.applyCheck === 'failed') {
        fixApplyFailedCount += 1
      }
    }
  }

  return {
    fixJudgmentAgreementCount,
    fixJudgedLabeledCount,
    fixFalsePositiveDetectedCount,
    fixGroundTruthFalsePositiveCount,
    fixProducedForRealCount,
    fixRealFindingCount,
    fixApplyFailedCount,
    fixApplyAttemptedCount
  }
}

const buildMetricCase = (
  input: {
    readonly evalCase: EvalCase
    readonly output: EvalCaseOutput
    readonly matchResult: EvalMatcherResult
    readonly artifactOnlyMatchResult: EvalMatcherResult
    // Plausibility outcomes for the case's raw false-positive findings. Absent on
    // a provider-error case (no findings to judge), where it defaults to empty.
    readonly plausibility?: EvalPlausibilityResult
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
  // Only a path-line expectation can ever satisfy the line check: the matcher
  // records lineOverlaps as false for every other match mode by construction.
  // Counting a path-semantic expectation here put it in the denominator while
  // making the numerator unreachable, so a corpus matched semantically reported a
  // guaranteed 0.0% -- a metric that cannot pass, displayed as one that failed.
  // An explicit path-line that declares no lineRange is excluded too: it asserts
  // no line, and lineRulePasses would credit it unconditionally. Both sides of
  // the ratio come from this one set, so they cannot drift apart again.
  const lineCheckedMatches = input.matchResult.matches.filter((match) => {
    const expected = input.evalCase.expectedFindings[match.expectedIndex]

    return (
      expected?.lineRange !== undefined &&
      resolveExpectedFindingMatchMode(expected) === 'path-line'
    )
  })
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
    // Recall denominator: declared expectations minus the ones the judge could
    // not decide. An inconclusive expectation must never be scored as missed.
    expectedFindingCount:
      input.evalCase.expectedFindings.length -
      input.matchResult.inconclusiveExpectedIndexes.length,
    inconclusiveMatchCount:
      input.matchResult.inconclusiveMatches.length +
      input.artifactOnlyMatchResult.inconclusiveMatches.length,
    admittedFindingCount: actionableFindings.length,
    matchedFindingCount: input.matchResult.matches.length,
    expectedSeverityWeights: input.evalCase.expectedFindings
      .filter(
        (_expected, expectedIndex) =>
          !input.matchResult.inconclusiveExpectedIndexes.includes(expectedIndex)
      )
      .map((expected) => severityWeight(expected.severity)),
    matchedExpectedSeverityWeights,
    falsePositiveSeverityWeights: falsePositiveFindings.map((finding) =>
      severityWeight(finding.severity)
    ),
    matchedLineCheckCount: lineCheckedMatches.length,
    accurateLineMatchCount: lineCheckedMatches.filter(
      (match) => match.lineOverlaps
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
    unlistedRealFindingCount:
      input.plausibility?.unlistedRealFindingIds.length ?? 0,
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
    // Why candidates were dropped, tallied by reason. Without this an archived run
    // cannot answer whether the admission gate discarded a candidate before anyone
    // could observe it -- a question that came up when the severity floor was
    // suspected of hiding low-severity findings, and which no stored artifact
    // could settle in either direction.
    rejectionReasonCounts: rejectedFindings.reduce<Record<string, number>>(
      (counts, rejected) => ({
        ...counts,
        [rejected.reason]: (counts[rejected.reason] ?? 0) + 1
      }),
      {}
    ),
    ...fixLaneCaseTallies({
      fixOutcomes: input.output.fixOutcomes,
      matchResult: input.matchResult,
      unlistedRealFindingIds: input.plausibility?.unlistedRealFindingIds ?? []
    }),
    tierCounts: tierCountsForCase(input.evalCase, input.matchResult),
    ...securityCountsForCase(input.evalCase, input.matchResult),
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
    costUnavailable: warnings.includes(COST_UNAVAILABLE_WARNING),
    durationMs: input.reviewReport?.run.durationMs ?? 0,
    warnings,
    failingFindingIds: input.matchResult.falsePositiveFindingIds
  }
}

// Assemble the per-case eval report entry.
const buildReportCase = (
  input: {
    readonly evalCase: EvalCase
    readonly output: EvalCaseOutput
    readonly reviewReport: ReviewReport
    readonly actionableFindings: readonly AdmittedFinding[]
    readonly artifactOnlyFindings: readonly AdmittedFinding[]
    readonly inlineFindingCount: number
    readonly matchResult: EvalMatcherResult
    readonly artifactOnlyMatchResult: EvalMatcherResult
    readonly plausibility: EvalPlausibilityResult
    readonly providerIssues: readonly z.infer<
      typeof EvalProviderIssueReportSchema
    >[]
  }
): z.infer<typeof EvalCaseReportSchema> => ({
  caseId: input.evalCase.id,
  parseValid: true,
  providerErrored: false,
  contextLedger: [...input.output.contextLedger],
  agenticStages: [
    ...agenticStagesForReport(input.reviewReport, input.output.fixOutcomes.length)
  ],
  fixOutcomes: [...input.output.fixOutcomes],
  expectedFindings: [...expectedFindingSummaries(input.evalCase)],
  matchedFindings: [...input.matchResult.matches],
  unmatchedExpectedIndexes: [...input.matchResult.unmatchedExpectedIndexes],
  inconclusiveExpectedIndexes: [
    ...input.matchResult.inconclusiveExpectedIndexes
  ],
  inconclusiveFindingIds: [
    ...input.matchResult.inconclusiveFindingIds,
    ...input.artifactOnlyMatchResult.inconclusiveFindingIds
  ],
  inconclusiveMatches: [
    ...input.matchResult.inconclusiveMatches,
    ...input.artifactOnlyMatchResult.inconclusiveMatches
  ],
  duplicateFindingIds: [...input.matchResult.duplicateFindingIds],
  duplicateFindings: [
    ...falsePositiveFindingSummaries(
      input.actionableFindings,
      input.matchResult.duplicateFindingIds
    )
  ],
  falsePositiveFindingIds: [...input.matchResult.falsePositiveFindingIds],
  falsePositiveFindings: [
    ...falsePositiveFindingSummaries(
      input.actionableFindings,
      input.matchResult.falsePositiveFindingIds
    )
  ],
  unlistedRealFindingIds: [...input.plausibility.unlistedRealFindingIds],
  unlistedRealFindings: [
    ...falsePositiveFindingSummaries(
      input.actionableFindings,
      input.plausibility.unlistedRealFindingIds
    )
  ],
  genuineFalsePositiveFindingIds: input.matchResult.falsePositiveFindingIds.filter(
    (findingId) => !input.plausibility.unlistedRealFindingIds.includes(findingId)
  ),
  noFindingZoneFalsePositiveIds: [
    ...input.matchResult.noFindingZoneFalsePositiveIds
  ],
  artifactOnlyFindingIds: input.artifactOnlyFindings.map((finding) => finding.id),
  artifactOnlyMatchedFindings: [...input.artifactOnlyMatchResult.matches],
  artifactOnlyFalsePositiveFindingIds: [
    ...input.artifactOnlyMatchResult.falsePositiveFindingIds
  ],
  artifactOnlyFalsePositiveFindings: [
    ...falsePositiveFindingSummaries(
      input.artifactOnlyFindings,
      input.artifactOnlyMatchResult.falsePositiveFindingIds
    )
  ],
  refutationResults: [...refutationResultSummaries(input.reviewReport)],
  inlineFindingCount: input.inlineFindingCount,
  providerIssues: [...input.providerIssues],
  warnings: [
    ...input.reviewReport.run.warnings,
    ...inconclusiveMatchWarnings(
      input.matchResult.inconclusiveMatches.length +
        input.artifactOnlyMatchResult.inconclusiveMatches.length
    ),
    ...plausibilityFailClosedWarnings(input.plausibility.failClosedFindingIds.length)
  ],
  durationMs: input.reviewReport.run.durationMs,
  inputTokens: input.reviewReport.run.inputTokens ?? 0,
  cachedInputTokens: input.reviewReport.run.cachedInputTokens ?? 0,
  outputTokens: input.reviewReport.run.outputTokens ?? 0,
  costUnavailable: input.reviewReport.run.warnings.includes(COST_UNAVAILABLE_WARNING),
  costUsd: input.reviewReport.run.costUsd ?? 0
})

// One case-computation path. The semantic judge is optional only because a case
// without expected findings needs no judge; a case with expected findings and no
// judge fails loudly inside the matcher.
const computeCaseResult = async (
  input: {
    readonly evalCase: EvalCase
    readonly output: EvalCaseOutput
    readonly judge: EvalSemanticJudge | undefined
    // Independent plausibility judge and source reader. Both optional: an offline
    // run has neither, and every unmatched finding then stays a genuine false
    // positive (adjustedPrecision equals precision).
    readonly plausibilityJudge: EvalPlausibilityJudge | undefined
    readonly readFindingSource: EvalCaseFileReader | undefined
  }
): Promise<EvalCaseComputation> => {
  const { evalCase, output, judge } = input

  if (output.result.status === 'provider-error') {
    const matchResult: EvalMatcherResult = {
      matches: [],
      unmatchedExpectedIndexes: evalCase.expectedFindings.map(
        (_finding, index) => index
      ),
      inconclusiveExpectedIndexes: [],
      inconclusiveFindingIds: [],
      inconclusiveMatches: [],
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
        fixOutcomes: [],
        contextLedger: [...output.contextLedger],
        expectedFindings: [...expectedFindingSummaries(evalCase)],
        matchedFindings: [],
        unmatchedExpectedIndexes: [...matchResult.unmatchedExpectedIndexes],
        inconclusiveExpectedIndexes: [],
        inconclusiveFindingIds: [],
        inconclusiveMatches: [],
        duplicateFindingIds: [],
        duplicateFindings: [],
        falsePositiveFindingIds: [],
        falsePositiveFindings: [],
        unlistedRealFindingIds: [],
        unlistedRealFindings: [],
        genuineFalsePositiveFindingIds: [],
        noFindingZoneFalsePositiveIds: [],
        artifactOnlyFindingIds: [],
        artifactOnlyMatchedFindings: [],
        artifactOnlyFalsePositiveFindingIds: [],
        artifactOnlyFalsePositiveFindings: [],
        refutationResults: [],
        inlineFindingCount: 0,
        warnings: [``],
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
  const matchResult = await matchEvalFindings({
    evalCase,
    admittedFindings: actionableFindings,
    ...(judge === undefined ? {} : { judge })
  })
  const artifactOnlyMatchResult = await matchEvalFindings({
    evalCase,
    admittedFindings: artifactOnlyFindings,
    ...(judge === undefined ? {} : { judge })
  })

  // Reclassify the raw false positives (unmatched actionable findings only) with
  // the independent plausibility judge. This never touches recall or what the
  // reviewer reported; it only splits the raw false positives into genuine false
  // positives and real-but-unlisted defects for adjustedPrecision.
  const falsePositiveFindingIdSet = new Set(matchResult.falsePositiveFindingIds)
  const plausibility = await judgeUnmatchedFindingsPlausibility({
    evalCase,
    unmatchedFindings: actionableFindings.filter((finding) =>
      falsePositiveFindingIdSet.has(finding.id)
    ),
    judge: input.plausibilityJudge,
    readFileContent: input.readFindingSource
  })

  return {
    reportCase: buildReportCase({
      evalCase,
      output,
      reviewReport,
      actionableFindings,
      artifactOnlyFindings,
      inlineFindingCount,
      matchResult,
      artifactOnlyMatchResult,
      plausibility,
      providerIssues: [
        ...providerIssuesFromReport(reviewReport),
        ...judgeProviderIssuesFromMatchResults([
          matchResult,
          artifactOnlyMatchResult
        ]),
        ...plausibility.providerIssues.map((issue) =>
          EvalProviderIssueReportSchema.parse({
            code: issue.code,
            stage: issue.stage,
            recovered: issue.recovered,
            ...(issue.message === undefined ? {} : { message: issue.message })
          })
        )
      ]
    }),
    metricCase: buildMetricCase({
      evalCase,
      output,
      matchResult,
      artifactOnlyMatchResult,
      plausibility,
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
    // Run-level judge reliability, repeated on every group: one judge produced
    // every group's numbers.
    readonly judgeReliability: EvalJudgeReliability
    // Run-level judge/plausibility spend and elapsed time, repeated on every
    // group for the same reason as `judgeReliability`: one run produced every
    // group's numbers.
    readonly runTotals: EvalRunTotals
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
        metrics: calculateEvalMetrics(
          group.metricCases,
          input.judgeReliability,
          input.runTotals
        )
      })
    )
}

const buildMetricGroups = (
  cases: readonly EvalCase[],
  metricCases: readonly EvalMetricCaseResult[],
  judgeReliability: EvalJudgeReliability,
  runTotals: EvalRunTotals
): readonly z.infer<typeof EvalMetricGroupSchema>[] => {
  const metricCaseMap = metricCaseById(metricCases)

  return [
    ...buildMetricGroupsForDimension({
      cases,
      metricCaseMap,
      judgeReliability,
      runTotals,
      groupBy: 'sourceProfile'
    }),
    ...buildMetricGroupsForDimension({
      cases,
      metricCaseMap,
      judgeReliability,
      runTotals,
      groupBy: 'language'
    }),
    ...buildMetricGroupsForDimension({
      cases,
      metricCaseMap,
      judgeReliability,
      runTotals,
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
    failingCaseIds: uniqueSorted(failingCaseIds)
  }
}

type RunEvaluationInput = {
  readonly cases: unknown
  // Pre-parse case outputs. `runEvaluation` re-validates them through
  // `EvalCaseOutputSchema`, so callers may omit fields that carry a schema
  // default (e.g. `fixOutcomes`, `contextLedger`).
  readonly outputs: readonly z.input<typeof EvalCaseOutputSchema>[]
  // The sole semantic authority for expected-finding matching. Required for any
  // case that declares expected findings; omitted only for fully negative
  // fixture sets, which score offline.
  readonly judge?: EvalSemanticJudge
  // Independent plausibility judge that reclassifies unmatched findings into
  // genuine false positives vs real-but-unlisted defects. Constructed whenever a
  // provider is available (like the match judge); omitted for offline runs.
  readonly plausibilityJudge?: EvalPlausibilityJudge
  // Reads the new-side content of a finding's file from the fixture repo so the
  // plausibility judge sees the whole file the reviewer saw. Omitted for offline
  // runs, where every unmatched finding stays a genuine false positive.
  readonly readFindingSource?: EvalCaseFileReader
  // Agreement below which the run reports its own metrics as untrustworthy.
  readonly judgeAgreementMinimum?: number
  // Used only to surface run-level judge-calibration provider failures, which
  // have no per-case slot in the eval report contract.
  readonly logger?: Logger | undefined
  // Reads the judge + plausibility-judge provider spend for the WHOLE run, as a
  // thunk rather than a precomputed value. The caller wraps the judge model
  // alias once with the SAME `createProviderUsageRecorder` mechanism the
  // review path already uses (see provider-usage-recorder.ts), so the SAME
  // wrapped alias backs both `judge` and `plausibilityJudge` above; every call
  // this function makes through them -- across matching AND the judge/
  // plausibility calibration passes below -- accumulates in that one
  // recorder. Reading it only here, after all of that has happened, is the
  // only way to see the run's true total rather than whatever had
  // accumulated when the thunk was constructed. The thunk returns the SAME
  // `RunCostSummary` shape `summarizeRunCost` already produces for review
  // cost, so this is not a second cost-accounting mechanism. Omitted for an
  // offline run (no judge, so nothing was spent).
  readonly evaluationScoringCost?: () => RunCostSummary
  // Reads the monotonic elapsed time for the WHOLE evaluation -- per-case
  // review execution (which happens entirely OUTSIDE this function, before it
  // is called) plus the judge/plausibility scoring this function performs --
  // as opposed to `durationMs` in the built report, which only SUMS each
  // case's own review time and so can never be compared to how long the run
  // actually took. The CLI supplies a thunk closed over its own monotonic
  // clock and a start timestamp captured before it began running cases; a
  // test supplies a deterministic thunk so a saved report stays byte-for-byte
  // reproducible, mirroring the `now` seam `CliRunOptions` already uses for
  // `generatedAt`. When omitted, this function times only its own execution
  // (matching and calibration), so a bare call still reports a real -- if
  // partial -- number instead of a silent 0.
  readonly evaluationElapsedMs?: () => number
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
    readonly judgeReliability: EvalJudgeReliability
    // Run-level judge/plausibility spend and elapsed time (see `EvalRunTotals`),
    // computed once for the whole run and folded into both the overall
    // metrics and every metric group below.
    readonly runTotals: EvalRunTotals
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
  const metrics = calculateEvalMetrics(
    metricCases,
    input.judgeReliability,
    input.runTotals
  )
  const selection = EvalReportSelectionSchema.parse({
    fixtureSource: input.selection?.fixtureSource ?? 'default',
    ...(input.selection?.sliceRoot === undefined
      ? {}
      : { sliceRoot: input.selection.sliceRoot }),
    caseFilters: input.selection?.caseFilters ?? [],
    selectedCaseIds: input.cases.map((evalCase) => evalCase.id)
  })
  const metricGroups = buildMetricGroups(
    input.cases,
    metricCases,
    input.judgeReliability,
    input.runTotals
  )
  const gate = thresholdReasons({
    thresholds: input.thresholds,
    metrics,
    caseResults: metricCases
  })
  const report = EvalReportSchema.parse({
    schemaVersion: '1.0',
    metricsVersion: EVAL_METRICS_VERSION,
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

// Judge availability is a run-level precondition. A case that declares expected
// findings cannot be scored without the semantic judge, and the engine never
// falls back to a heuristic, so the run fails with a config error (exit 2)
// before any case is scored.
const assertJudgeAvailableForExpectations = (
  cases: readonly EvalCase[],
  judge: EvalSemanticJudge | undefined
): void => {
  if (judge !== undefined) {
    return
  }

  const positiveCase = cases.find(
    (evalCase) => evalCase.expectedFindings.length > 0
  )

  if (positiveCase !== undefined) {
    throw missingSemanticJudgeError(positiveCase.id)
  }
}

export const runEvaluation = async (
  input: RunEvaluationInput
): Promise<{
  readonly artifactName: typeof EVAL_REPORT_ARTIFACT_NAME
  readonly report: EvalReport
}> => {
  // Fallback start reference for `elapsedMs` when the caller supplies no
  // `evaluationElapsedMs` thunk (e.g. a direct unit-test call). Reading it here,
  // before anything else runs, means a bare call still reports a real -- if
  // partial, since it excludes the per-case review work that happens before
  // this function is even called -- elapsed time instead of a silent 0.
  const internalStartMs = performance.now()
  const prepared = prepareEvaluationInputs(input)
  assertJudgeAvailableForExpectations(prepared.cases, input.judge)

  const outputByCaseId = new Map(
    prepared.outputs.map((output) => [output.caseId, output])
  )
  // Case computations run sequentially so judge calls stay ordered and the run
  // stays reproducible.
  const caseComputations: EvalCaseComputation[] = []
  for (const evalCase of prepared.cases) {
    const output = outputByCaseId.get(evalCase.id)

    if (output === undefined) {
      throw new Error(`Missing eval output for case "${evalCase.id}".`)
    }

    caseComputations.push(
      await computeCaseResult({
        evalCase: EvalCaseSchema.parse(evalCase),
        output,
        judge: input.judge,
        plausibilityJudge: input.plausibilityJudge,
        readFindingSource: input.readFindingSource
      })
    )
  }

  // Measure the judge itself against the committed human-labeled calibration
  // set. Calibration pairs whose judge call failed leave the agreement
  // denominator; if none could be scored, the run cannot claim trustworthiness.
  const calibration: EvalJudgeCalibrationResult | undefined =
    input.judge === undefined
      ? undefined
      : await scoreJudgeCalibration({
          judge: input.judge,
          ...(input.judgeAgreementMinimum === undefined
            ? {}
            : { minimumAgreement: input.judgeAgreementMinimum }),
          ...(input.logger === undefined ? {} : { logger: input.logger })
        })

  // Score the plausibility judge against its own committed calibration set,
  // once per run, whenever a plausibility judge exists. It reuses the same
  // minimum-agreement config key: adjusted precision is only as trustworthy as
  // the judge that produced it.
  const plausibilityCalibration:
    | EvalPlausibilityCalibrationResult
    | undefined =
    input.plausibilityJudge === undefined
      ? undefined
      : await scorePlausibilityCalibration({
          judge: input.plausibilityJudge,
          ...(input.judgeAgreementMinimum === undefined
            ? {}
            : { minimumAgreement: input.judgeAgreementMinimum }),
          ...(input.logger === undefined ? {} : { logger: input.logger })
        })

  // Read both run totals only NOW, after every judge/plausibility call this
  // function will ever make (matching above, calibration just above) has
  // already happened. Reading either earlier would under-count: the usage
  // recorder keeps accumulating through calibration, and the elapsed clock
  // must span everything this function did, not just the case-computation loop.
  const scoringCost = input.evaluationScoringCost?.()
  const elapsedMs = Math.max(
    0,
    Math.round(
      input.evaluationElapsedMs === undefined
        ? performance.now() - internalStartMs
        : input.evaluationElapsedMs()
    )
  )
  const runTotals: EvalRunTotals = {
    elapsedMs,
    scoringInputTokens: scoringCost?.inputTokens ?? 0,
    scoringCachedInputTokens: scoringCost?.cachedInputTokens ?? 0,
    scoringOutputTokens: scoringCost?.outputTokens ?? 0,
    scoringCostUsd: scoringCost?.costUsd ?? 0,
    scoringCostUnavailable:
      scoringCost?.warnings.includes(COST_UNAVAILABLE_WARNING) ?? false
  }

  return buildEvaluationResult({
    cases: prepared.cases,
    thresholds: prepared.thresholds,
    ...(input.selection === undefined ? {} : { selection: input.selection }),
    runTotals,
    scoring: {
      ...(calibration?.judgeAgreement === undefined
        ? {}
        : { judgeAgreement: calibration.judgeAgreement }),
      // With no judge in play there is no semantic authority to distrust: such a
      // run scores only cases without expected findings, fully deterministically.
      judgeTrustworthy: calibration?.judgeTrustworthy ?? true,
      ...(plausibilityCalibration?.plausibilityJudgeAgreement === undefined
        ? {}
        : {
            plausibilityJudgeAgreement:
              plausibilityCalibration.plausibilityJudgeAgreement
          }),
      // With no plausibility judge, no unmatched finding is ever credited as
      // real, so adjustedPrecision equals precision and is as trustworthy as it.
      adjustedPrecisionTrustworthy:
        plausibilityCalibration?.plausibilityJudgeTrustworthy ?? true
    },
    judgeReliability: {
      ...(calibration?.judgeAgreement === undefined
        ? {}
        : { judgeAgreement: calibration.judgeAgreement }),
      judgeAgreementPairCount: calibration?.judgeAgreementPairCount ?? 0,
      ...(plausibilityCalibration?.plausibilityJudgeAgreement === undefined
        ? {}
        : {
            plausibilityJudgeAgreement:
              plausibilityCalibration.plausibilityJudgeAgreement
          }),
      plausibilityJudgeAgreementPairCount:
        plausibilityCalibration?.plausibilityJudgeAgreementPairCount ?? 0
    },
    ...(input.generatedAt === undefined ? {} : { generatedAt: input.generatedAt }),
    caseComputations
  })
}
