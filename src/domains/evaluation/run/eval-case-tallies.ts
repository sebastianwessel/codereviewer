import { z } from 'zod'
import type {
  AdmittedFinding,
  ReviewReport
} from '../../../shared/contracts/index.js'
import { COST_UNAVAILABLE_WARNING } from '../../costs/index.js'
import {
  EVAL_PROVIDER_RETRY_WARNING_PREFIX,
  PROVIDER_ERROR_WARNING_PREFIX
} from '../eval-warnings.js'
import {
  resolveExpectedFindingMatchMode,
  resolveExpectedFindingTier,
  type EvalCase
} from '../corpus/eval-fixture.schema.js'
import { type EvalMatcherResult } from '../judging/eval-matcher.js'
import { expectedFindingDiffScopes } from '../scoring/eval-diff-scope.js'
import {
  emptyDiffScopeCounts,
  emptySecurityContextDepthCounts,
  emptySecurityMechanismCounts,
  emptyTierCounts,
  type EvalMetricCaseResult
} from '../scoring/metrics.js'
import {
  EvalAgenticStageReportSchema,
  EvalExpectedFindingReportSchema,
  EvalFindingSummaryReportSchema,
  EvalProviderIssueReportSchema,
  EvalRefutationResultReportSchema,
  type EvalCaseOutput
} from '../report/eval-report-contracts.js'

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

export const isActionableFinding = (
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

// Bucket for a rejected candidate whose severity could not be recovered (a
// refutation-stage rejection, whose contract does not yet thread severity
// through). Named rather than left as `undefined` so the rendered tally is
// self-explanatory instead of silently losing those rejections from the count.
const UNKNOWN_REJECTION_SEVERITY = 'unknown'

// Per-severity and reason x severity tallies of rejected candidates (spec 06
// item 0.4). Without this, "is the model over-calling severity" is confounded
// by the admission floor deleting every model-origin `low` candidate before
// anyone downstream can observe it -- the floor and the question it is
// suspected of confounding would otherwise share exactly one blind spot.
export const rejectionSeverityTallies = (
  rejectedFindings: ReviewReport['rejectedFindings']
): {
  readonly rejectionSeverityCounts: Record<string, number>
  readonly rejectionReasonBySeverityCounts: Record<string, Record<string, number>>
} => {
  const rejectionSeverityCounts: Record<string, number> = {}
  const rejectionReasonBySeverityCounts: Record<string, Record<string, number>> = {}

  for (const rejected of rejectedFindings) {
    const severity = rejected.severity ?? UNKNOWN_REJECTION_SEVERITY
    rejectionSeverityCounts[severity] =
      (rejectionSeverityCounts[severity] ?? 0) + 1

    const reasonCounts = rejectionReasonBySeverityCounts[rejected.reason] ?? {}
    reasonCounts[severity] = (reasonCounts[severity] ?? 0) + 1
    rejectionReasonBySeverityCounts[rejected.reason] = reasonCounts
  }

  return { rejectionSeverityCounts, rejectionReasonBySeverityCounts }
}

// Attributes for EVERY produced finding, unfiltered. It takes no ID list on
// purpose: the classifications are recorded as ID lists into this one array, so
// a helper that summarized a subset would reintroduce the per-classification
// copies this replaced -- and would keep the matched findings attribute-less,
// which is what made the matched and unmatched halves of a population
// incomparable in saved reports.
export const findingSummaries = (
  findings: readonly AdmittedFinding[]
): readonly z.infer<typeof EvalFindingSummaryReportSchema>[] =>
  findings.map((finding) =>
    EvalFindingSummaryReportSchema.parse({
      findingId: finding.id,
      severity: finding.severity,
      category: finding.category,
      path: finding.location.path,
      line: finding.location.startLine,
      title: finding.title
    })
  )

export const providerIssuesFromReport = (
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

export const judgeProviderIssuesFromMatchResults = (
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

export const agenticStagesForReport = (
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

export const isKnownProviderErrorStage = (
  stage: string | undefined
): stage is ProviderErrorStageName =>
  stage !== undefined &&
  (providerErrorStageNames as readonly string[]).includes(stage)

// When the failing stage is known, mark it as `error` instead of `skipped` so
// the hard provider error stays attributable to where it happened.
export const agenticStagesForProviderError = (
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

export const refutationResultSummaries = (
  report: ReviewReport
): readonly z.infer<typeof EvalRefutationResultReportSchema>[] =>
  report.refutationResults.map((refutation) =>
    EvalRefutationResultReportSchema.parse({
      id: refutation.id,
      candidateId: refutation.candidateId,
      verdict: refutation.verdict
    })
  )

export const actionableFindingsForEval = (
  admittedFindings: readonly AdmittedFinding[]
): readonly AdmittedFinding[] =>
  admittedFindings.filter(
    (finding) => finding.reporterEligibility !== 'artifact-only'
  )

export const artifactOnlyFindingsForEval = (
  admittedFindings: readonly AdmittedFinding[]
): readonly AdmittedFinding[] =>
  admittedFindings.filter(
    (finding) => finding.reporterEligibility === 'artifact-only'
  )

// Per-expectation report entries, including the diff-scope classification
// (spec 17) derived from the case's own reviewed diff. Deriving it here, at the
// single site that writes the scored artefact, is what makes it durable: every
// consumer reads one stored value instead of re-deriving the split by hand.
export const expectedFindingSummaries = (
  evalCase: EvalCase
): readonly z.infer<typeof EvalExpectedFindingReportSchema>[] => {
  const diffScopes = expectedFindingDiffScopes(evalCase)

  return evalCase.expectedFindings.map((expected, expectedIndex) =>
    EvalExpectedFindingReportSchema.parse({
      expectedIndex,
      category: expected.category,
      severity: expected.severity,
      ...(expected.path === undefined ? {} : { path: expected.path }),
      ...(expected.lineRange === undefined
        ? {}
        : { lineRange: [...expected.lineRange] }),
      matchMode: resolveExpectedFindingMatchMode(expected),
      diffScope: diffScopes[expectedIndex],
      semanticSummary: expected.semanticSummary
    })
  )
}

// Join the match result to the diff-scope classification so recall is scored
// per population (spec 17). An inconclusive expectation leaves the denominator
// for the same reason it leaves the aggregate recall one: a failed judge call is
// not a miss.
export const diffScopeCountsForCase = (
  evalCase: EvalCase,
  matchResult: EvalMatcherResult
): EvalMetricCaseResult['diffScopeCounts'] => {
  const counts = emptyDiffScopeCounts()
  const diffScopes = expectedFindingDiffScopes(evalCase)
  const matchedExpectedIndexes = new Set(
    matchResult.matches.map((match) => match.expectedIndex)
  )
  const inconclusiveExpectedIndexes = new Set(
    matchResult.inconclusiveExpectedIndexes
  )

  evalCase.expectedFindings.forEach((_expected, expectedIndex) => {
    if (inconclusiveExpectedIndexes.has(expectedIndex)) {
      return
    }

    const scope = diffScopes[expectedIndex]!
    counts[scope] = {
      expected: counts[scope].expected + 1,
      matched:
        counts[scope].matched + (matchedExpectedIndexes.has(expectedIndex) ? 1 : 0)
    }
  })

  return counts
}

export const tierCountsForCase = (
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
export const securityCountsForCase = (
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

type EvalCaseSpend = {
  // `null` means NOT MEASURED. See `EvalCaseReportSchema` and
  // `EvalMetricCaseResult` for why absence is never flattened to 0 here.
  readonly costUsd: number | null
  readonly durationMs: number | null
  readonly inputTokens: number | null
  readonly cachedInputTokens: number | null
  readonly outputTokens: number | null
}

// Whether the review report surfaced any token usage at all.
//
// `summarizeRunCost` produces all three counts or none: they come from ONE usage
// record, so they are known or unknown as a unit and need one predicate rather
// than three. The absent-and-warned combination is what distinguishes a provider
// run whose usage never arrived (unknown) from a deterministic run that made no
// model call (a real zero) -- exactly the distinction the cost derivation below
// already draws, and for the same reason.
//
// Keyed on the token fields themselves, not on the warning alone: a run that
// surfaced usage but had no price for its model carries `cost-unavailable` while
// reporting every token count, and those counts are measurements.
const usageUnavailable = (reviewReport: ReviewReport): boolean =>
  reviewReport.run.inputTokens === undefined &&
  reviewReport.run.outputTokens === undefined &&
  reviewReport.run.warnings.includes(COST_UNAVAILABLE_WARNING)

/**
 * The model cost, token usage and review duration of one case, with unknown
 * represented as `null` rather than 0. ONE derivation, so the report fields, the
 * aggregate totals and the unavailability counts cannot drift apart.
 *
 * A provider-errored case has NO review report: the call failed before any usage
 * or timing was surfaced, so every quantity here is genuinely unknown. Publishing
 * them as 0 made the run's headline cost silently understate itself while
 * `costUnavailableCount` stayed at zero — an incomplete total presented as an
 * exact one. Cost is a decision input in capability-withdrawal rules, and the
 * arm that errors more is usually the more expensive one, so the understatement
 * lands on whichever side the rule is about to judge. Token counts carry the
 * same lie at lower stakes: a run whose token totals silently omit its failed
 * cases reads as cheaper in exactly the comparison that is measuring cost.
 *
 * Cost is also unknown for a COMPLETED case whose report carries
 * `COST_UNAVAILABLE_WARNING` (no surfaced token usage, or no provider cost and no
 * configured prices). `costs/token-cost.ts` already models that as
 * `costUsd: number | null`; this is the single place the eval lane reads it, so
 * it cannot be re-flattened.
 *
 * Cost and tokens are two questions, deliberately answered separately: a run
 * with usage but no price for its model has KNOWN tokens and an UNKNOWN cost.
 *
 * A completed report always carries a duration, so `durationMs` is `null`
 * exactly when there is no report at all.
 */
export const caseSpend = (
  reviewReport: ReviewReport | undefined
): EvalCaseSpend => {
  if (reviewReport === undefined) {
    return {
      costUsd: null,
      durationMs: null,
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null
    }
  }

  const tokensUnknown = usageUnavailable(reviewReport)

  return {
    costUsd: reviewReport.run.warnings.includes(COST_UNAVAILABLE_WARNING)
      ? null
      : // Absent WITHOUT the warning means a deterministic run with no provider
        // configured, which genuinely cost nothing (see `summarizeRunCost`).
        (reviewReport.run.costUsd ?? 0),
    durationMs: reviewReport.run.durationMs,
    // Absent without the warning is the same deterministic-run case: no model
    // call was made, so zero tokens is a measurement rather than a default.
    inputTokens: tokensUnknown ? null : (reviewReport.run.inputTokens ?? 0),
    cachedInputTokens: tokensUnknown
      ? null
      : (reviewReport.run.cachedInputTokens ?? 0),
    outputTokens: tokensUnknown ? null : (reviewReport.run.outputTokens ?? 0)
  }
}

// The saved report's rendering of the same values. An unmeasured quantity is
// OMITTED rather than written as 0, and each `*Unavailable` flag is derived from
// the very value that decides whether its figure is present, so a flag the
// aggregate counts cannot disagree with the figure it qualifies.
export const spendReportFields = (
  spend: EvalCaseSpend
): {
  readonly costUnavailable: boolean
  readonly usageUnavailable: boolean
  readonly costUsd?: number
  readonly durationMs?: number
  readonly inputTokens?: number
  readonly cachedInputTokens?: number
  readonly outputTokens?: number
} => ({
  costUnavailable: spend.costUsd === null,
  usageUnavailable: spend.inputTokens === null,
  ...(spend.costUsd === null ? {} : { costUsd: spend.costUsd }),
  ...(spend.durationMs === null ? {} : { durationMs: spend.durationMs }),
  ...(spend.inputTokens === null ? {} : { inputTokens: spend.inputTokens }),
  ...(spend.cachedInputTokens === null
    ? {}
    : { cachedInputTokens: spend.cachedInputTokens }),
  ...(spend.outputTokens === null ? {} : { outputTokens: spend.outputTokens })
})
