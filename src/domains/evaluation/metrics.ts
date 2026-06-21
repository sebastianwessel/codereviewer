import { z } from 'zod'
import type { Severity } from '../../shared/contracts/index.js'

const RATE_MIN = 0
const RATE_MAX = 1
const METRIC_PRECISION = 1_000_000

const severityWeights: Readonly<Record<Severity, number>> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1
}

export const EvalMetricsSchema = z.strictObject({
  parseValidity: z.number().min(RATE_MIN).max(RATE_MAX),
  recall: z.number().min(RATE_MIN).max(RATE_MAX),
  precision: z.number().min(RATE_MIN).max(RATE_MAX),
  f1: z.number().min(RATE_MIN).max(RATE_MAX),
  severityWeightedPrecision: z.number().min(RATE_MIN).max(RATE_MAX),
  severityWeightedRecall: z.number().min(RATE_MIN).max(RATE_MAX),
  severityWeightedF1: z.number().min(RATE_MIN).max(RATE_MAX),
  lineAccuracy: z.number().min(RATE_MIN).max(RATE_MAX),
  severityAccuracy: z.number().min(RATE_MIN).max(RATE_MAX),
  falsePositiveCount: z.int().min(0),
  noFindingZoneFalsePositiveCount: z.int().min(0),
  actionableRate: z.number().min(RATE_MIN).max(RATE_MAX),
  commentsPerKloc: z.number().min(0),
  commentsPerDiffHunk: z.number().min(0),
  incompleteCoverageRate: z.number().min(RATE_MIN).max(RATE_MAX),
  contextMutationRate: z.number().min(RATE_MIN).max(RATE_MAX),
  providerErrorRate: z.number().min(RATE_MIN).max(RATE_MAX),
  costUsd: z.number().min(0),
  durationMs: z.int().min(0)
})

export type EvalMetrics = z.infer<typeof EvalMetricsSchema>

export type EvalMetricCaseResult = {
  readonly caseId: string
  readonly parseValid: boolean
  readonly providerErrored: boolean
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
  readonly noFindingZoneFalsePositiveCount: number
  readonly changedLineCount: number
  readonly diffHunkCount: number
  readonly coverageIncomplete: boolean
  readonly contextLedgerEntryCount: number
  readonly mutatedContextLedgerEntryCount: number
  readonly costUsd: number
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
    totalAdmittedFindingCount,
    1
  )
  const recall = ratio(totalMatchedFindingCount, totalExpectedFindingCount, 1)
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
    costUsd: roundMetric(sum(caseResults.map((result) => result.costUsd))),
    durationMs: sum(caseResults.map((result) => result.durationMs))
  })
}

export const calculateEvalMetrics: CalculateEvalMetrics = Object.assign(
  calculate,
  { severityWeight }
)
