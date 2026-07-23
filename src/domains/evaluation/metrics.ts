import { z } from 'zod'
import type { Severity } from '../../shared/contracts/index.js'
import {
  ExpectedFindingTierSchema,
  productRecallTiers,
  type ExpectedFindingTier
} from './eval-fixture.schema.js'
import { isProviderIssueWarning } from './eval-warnings.js'

const RATE_MIN = 0
const RATE_MAX = 1
const METRIC_PRECISION = 1_000_000

const allTiers = ExpectedFindingTierSchema.options

export type TierFindingCounts = {
  readonly expected: number
  readonly matched: number
}

export const emptyTierCounts = (): Record<
  ExpectedFindingTier,
  TierFindingCounts
> =>
  Object.fromEntries(
    allTiers.map((tier) => [tier, { expected: 0, matched: 0 }])
  ) as Record<ExpectedFindingTier, TierFindingCounts>

const clampRate = (value: unknown): unknown =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(RATE_MAX, Math.max(RATE_MIN, value))
    : value

// Shared rate schema: a [0,1] number that defensively clamps its input before
// validation. Aggregation can legitimately produce a value just outside the
// range (e.g. a coverage ratio whose numerator exceeds its denominator), and an
// unclamped out-of-range value would fail EvalMetricsSchema and abort the entire
// eval run at report assembly. Reuse this for every rate field so that drift can
// never reintroduce that failure mode.
const RateSchema = z.preprocess(
  clampRate,
  z.number().min(RATE_MIN).max(RATE_MAX)
)

const TierRateSchema = z
  .record(ExpectedFindingTierSchema, RateSchema)
  .default(() =>
    Object.fromEntries(allTiers.map((tier) => [tier, 1])) as Record<
      ExpectedFindingTier,
      number
    >
  )

const severityWeights: Readonly<Record<Severity, number>> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1
}

export const EvalMetricsSchema = z.strictObject({
  parseValidity: RateSchema,
  recall: RateSchema,
  precision: RateSchema,
  f1: RateSchema,
  severityWeightedPrecision: RateSchema,
  severityWeightedRecall: RateSchema,
  severityWeightedF1: RateSchema,
  lineAccuracy: RateSchema,
  severityAccuracy: RateSchema,
  falsePositiveCount: z.int().min(0),
  noFindingZoneFalsePositiveCount: z.int().min(0),
  actionableRate: RateSchema,
  commentsPerKloc: z.number().min(0),
  commentsPerDiffHunk: z.number().min(0),
  incompleteCoverageRate: RateSchema,
  contextMutationRate: RateSchema,
  providerErrorRate: RateSchema,
  providerIssueRate: RateSchema.default(0),
  providerIssueCount: z.int().min(0).default(0),
  duplicateFindingCount: z.int().min(0).default(0),
  artifactOnlyRecall: RateSchema.default(1),
  artifactOnlyPrecision: RateSchema.default(1),
  artifactOnlyFindingCount: z.int().min(0).default(0),
  artifactOnlyMatchedFindingCount: z.int().min(0).default(0),
  artifactOnlyFalsePositiveCount: z.int().min(0).default(0),
  trustedDeterministicFindingCount: z.int().min(0).default(0),
  refutationFalseNegativeCount: z.int().min(0).default(0),
  refutationFalsePositiveCount: z.int().min(0).default(0),
  recallByTier: TierRateSchema,
  // precisionByTier mirrors recallByTier rather than computing a finding-side
  // tier. Admitted findings carry no expected-tier label, so a precise
  // per-tier precision is not derivable from the match result. We expose
  // recall-parity here so consumers have a stable, documented value.
  precisionByTier: TierRateSchema,
  productRecall: RateSchema.default(1),
  nitRecall: RateSchema.default(1),
  inputTokens: z.int().min(0).default(0),
  // Cached input tokens are a SUBSET of inputTokens (already counted there).
  cachedInputTokens: z.int().min(0).default(0),
  outputTokens: z.int().min(0).default(0),
  costUnavailableCount: z.int().min(0).default(0),
  costUsd: z.number().min(0),
  durationMs: z.int().min(0)
})

export type EvalMetrics = z.infer<typeof EvalMetricsSchema>

export type EvalMetricCaseResult = {
  readonly caseId: string
  readonly parseValid: boolean
  readonly providerErrored: boolean
  readonly providerIssueCount: number
  readonly expectedFindingCount: number
  readonly admittedFindingCount: number
  readonly matchedFindingCount: number
  readonly expectedSeverityWeights: readonly number[]
  readonly matchedExpectedSeverityWeights: readonly number[]
  readonly falsePositiveSeverityWeights: readonly number[]
  readonly matchedLineCheckCount: number
  readonly accurateLineMatchCount: number
  readonly matchedSeverityCheckCount: number
  readonly accurateSeverityMatchCount: number
  readonly actionableFindingCount: number
  readonly falsePositiveCount: number
  readonly duplicateFindingCount: number
  readonly artifactOnlyFindingCount: number
  readonly artifactOnlyMatchedFindingCount: number
  readonly artifactOnlyFalsePositiveCount: number
  readonly trustedDeterministicFindingCount: number
  // Refutation results with a `proved` verdict. Used to derive the refutation
  // false-positive count (proved refutations whose finding never matched).
  readonly provedRefutationCount: number
  // Rejected/demoted candidates. Used to derive the refutation false-negative
  // count (expected findings demoted without a matching admitted finding).
  readonly rejectedFindingCount: number
  readonly tierCounts: Record<ExpectedFindingTier, TierFindingCounts>
  readonly noFindingZoneFalsePositiveCount: number
  readonly changedLineCount: number
  readonly diffHunkCount: number
  readonly coverageIncomplete: boolean
  readonly contextLedgerEntryCount: number
  readonly mutatedContextLedgerEntryCount: number
  readonly costUsd: number
  readonly inputTokens: number
  readonly cachedInputTokens: number
  readonly outputTokens: number
  readonly costUnavailable: boolean
  readonly durationMs: number
  readonly warnings: readonly string[]
  readonly failingFindingIds: readonly string[]
}

const roundMetric = (value: number): number =>
  Math.round(value * METRIC_PRECISION) / METRIC_PRECISION

const ratio = (
  numerator: number,
  denominator: number,
  emptyValue: number
): number => (denominator === 0 ? emptyValue : roundMetric(numerator / denominator))

const harmonicMean = (left: number, right: number): number =>
  left + right === 0 ? 0 : roundMetric((2 * left * right) / (left + right))

const sum = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0)

export const severityWeight = (severity: Severity): number =>
  severityWeights[severity]

const hasProviderIssue = (result: EvalMetricCaseResult): boolean =>
  result.providerErrored ||
  result.providerIssueCount > 0 ||
  result.warnings.some(isProviderIssueWarning)

type CalculateEvalMetrics = {
  (caseResults: readonly EvalMetricCaseResult[]): EvalMetrics
  readonly severityWeight: (severity: Severity) => number
}

const calculate = (
  caseResults: readonly EvalMetricCaseResult[]
): EvalMetrics => {
  const totalCaseCount = caseResults.length
  const totalExpectedFindingCount = sum(
    caseResults.map((result) => result.expectedFindingCount)
  )
  const totalAdmittedFindingCount = sum(
    caseResults.map((result) => result.admittedFindingCount)
  )
  const totalMatchedFindingCount = sum(
    caseResults.map((result) => result.matchedFindingCount)
  )
  const totalFalsePositiveCount = sum(
    caseResults.map((result) => result.falsePositiveCount)
  )
  const providerIssueCount = caseResults.filter(hasProviderIssue).length
  const totalArtifactOnlyFindingCount = sum(
    caseResults.map((result) => result.artifactOnlyFindingCount)
  )
  const totalArtifactOnlyMatchedFindingCount = sum(
    caseResults.map((result) => result.artifactOnlyMatchedFindingCount)
  )
  const totalArtifactOnlyFalsePositiveCount = sum(
    caseResults.map((result) => result.artifactOnlyFalsePositiveCount)
  )
  const totalTrustedDeterministicFindingCount = sum(
    caseResults.map((result) => result.trustedDeterministicFindingCount)
  )
  const totalExpectedSeverityWeight = sum(
    caseResults.flatMap((result) => result.expectedSeverityWeights)
  )
  const totalMatchedExpectedSeverityWeight = sum(
    caseResults.flatMap((result) => result.matchedExpectedSeverityWeights)
  )
  const totalFalsePositiveSeverityWeight = sum(
    caseResults.flatMap((result) => result.falsePositiveSeverityWeights)
  )
  const precision = ratio(
    totalMatchedFindingCount,
    totalMatchedFindingCount + totalFalsePositiveCount,
    1
  )
  const recall = ratio(totalMatchedFindingCount, totalExpectedFindingCount, 1)
  const tierTotals = allTiers.map((tier) => {
    const expected = sum(
      caseResults.map((result) => result.tierCounts[tier].expected)
    )
    const matched = sum(
      caseResults.map((result) => result.tierCounts[tier].matched)
    )

    return { tier, expected, matched }
  })
  // Rate fields are clamped to [0,1] by RateSchema at validation, so these
  // ratios are written plainly; see RateSchema for why clamping is required.
  const recallByTier = Object.fromEntries(
    tierTotals.map(({ tier, expected, matched }) => [
      tier,
      ratio(matched, expected, 1)
    ])
  ) as Record<ExpectedFindingTier, number>
  const precisionByTier = recallByTier
  const productTierTotals = tierTotals.filter((entry) =>
    (productRecallTiers as readonly string[]).includes(entry.tier)
  )
  const productRecall = ratio(
    sum(productTierTotals.map((entry) => entry.matched)),
    sum(productTierTotals.map((entry) => entry.expected)),
    1
  )
  const nitRecall = recallByTier.nit
  const severityWeightedPrecision = ratio(
    totalMatchedExpectedSeverityWeight,
    totalMatchedExpectedSeverityWeight + totalFalsePositiveSeverityWeight,
    1
  )
  const severityWeightedRecall = ratio(
    totalMatchedExpectedSeverityWeight,
    totalExpectedSeverityWeight,
    1
  )

  return EvalMetricsSchema.parse({
    parseValidity: ratio(
      caseResults.filter((result) => result.parseValid).length,
      totalCaseCount,
      1
    ),
    recall,
    precision,
    f1: harmonicMean(precision, recall),
    severityWeightedPrecision,
    severityWeightedRecall,
    severityWeightedF1: harmonicMean(
      severityWeightedPrecision,
      severityWeightedRecall
    ),
    lineAccuracy: ratio(
      sum(caseResults.map((result) => result.accurateLineMatchCount)),
      sum(caseResults.map((result) => result.matchedLineCheckCount)),
      1
    ),
    severityAccuracy: ratio(
      sum(caseResults.map((result) => result.accurateSeverityMatchCount)),
      sum(caseResults.map((result) => result.matchedSeverityCheckCount)),
      1
    ),
    falsePositiveCount: sum(
      caseResults.map((result) => result.falsePositiveCount)
    ),
    noFindingZoneFalsePositiveCount: sum(
      caseResults.map((result) => result.noFindingZoneFalsePositiveCount)
    ),
    actionableRate: ratio(
      sum(caseResults.map((result) => result.actionableFindingCount)),
      totalAdmittedFindingCount,
      1
    ),
    commentsPerKloc:
      sum(caseResults.map((result) => result.changedLineCount)) === 0
        ? 0
        : roundMetric(
            (totalAdmittedFindingCount * 1000) /
              sum(caseResults.map((result) => result.changedLineCount))
          ),
    commentsPerDiffHunk: ratio(
      totalAdmittedFindingCount,
      sum(caseResults.map((result) => result.diffHunkCount)),
      0
    ),
    incompleteCoverageRate: ratio(
      caseResults.filter((result) => result.coverageIncomplete).length,
      totalCaseCount,
      0
    ),
    contextMutationRate: ratio(
      sum(caseResults.map((result) => result.mutatedContextLedgerEntryCount)),
      sum(caseResults.map((result) => result.contextLedgerEntryCount)),
      0
    ),
    providerErrorRate: ratio(
      caseResults.filter((result) => result.providerErrored).length,
      totalCaseCount,
      0
    ),
    providerIssueRate: ratio(providerIssueCount, totalCaseCount, 0),
    providerIssueCount,
    duplicateFindingCount: sum(
      caseResults.map((result) => result.duplicateFindingCount)
    ),
    artifactOnlyRecall: ratio(
      totalArtifactOnlyMatchedFindingCount,
      totalExpectedFindingCount,
      1
    ),
    artifactOnlyPrecision: ratio(
      totalArtifactOnlyMatchedFindingCount,
      totalArtifactOnlyMatchedFindingCount + totalArtifactOnlyFalsePositiveCount,
      1
    ),
    artifactOnlyFindingCount: totalArtifactOnlyFindingCount,
    artifactOnlyMatchedFindingCount: totalArtifactOnlyMatchedFindingCount,
    artifactOnlyFalsePositiveCount: totalArtifactOnlyFalsePositiveCount,
    trustedDeterministicFindingCount: totalTrustedDeterministicFindingCount,
    // Expected findings that were demoted/rejected without a matching admitted
    // finding. Bounded by the unmatched-expected count so a case that rejected
    // many duplicates of an otherwise-matched expectation is not penalised.
    refutationFalseNegativeCount: sum(
      caseResults.map((result) =>
        Math.min(
          result.rejectedFindingCount,
          Math.max(0, result.expectedFindingCount - result.matchedFindingCount)
        )
      )
    ),
    // Refutations marked `proved` whose admitted finding never matched an
    // expected finding.
    refutationFalsePositiveCount: sum(
      caseResults.map((result) =>
        Math.max(0, result.provedRefutationCount - result.matchedFindingCount)
      )
    ),
    recallByTier,
    precisionByTier,
    productRecall,
    nitRecall,
    inputTokens: sum(caseResults.map((result) => result.inputTokens)),
    cachedInputTokens: sum(caseResults.map((result) => result.cachedInputTokens)),
    outputTokens: sum(caseResults.map((result) => result.outputTokens)),
    costUnavailableCount: caseResults.filter((result) => result.costUnavailable)
      .length,
    costUsd: roundMetric(sum(caseResults.map((result) => result.costUsd))),
    durationMs: sum(caseResults.map((result) => result.durationMs))
  })
}

export const calculateEvalMetrics: CalculateEvalMetrics = Object.assign(
  calculate,
  { severityWeight }
)
