import type { z } from 'zod'
import { uniqueSorted } from '../../../shared/text/unique-sorted.js'
import type { EvalCase } from '../corpus/eval-fixture.schema.js'
import {
  calculateEvalMetrics,
  type EvalMetricsSchema,
  type EvalJudgeReliability,
  type EvalMetricCaseResult,
  type EvalMetrics,
  type EvalRunTotals
} from '../scoring/metrics.js'
import {
  EvalMetricGroupSchema,
  type EvalRegressionGateOutcome,
  type EvalRegressionThresholds
} from '../report/eval-report-contracts.js'

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

export const buildMetricGroups = (
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

// Threshold helpers only compare scalar metrics; per-tier record metrics are
// excluded so a Record value never reaches a numeric comparison.
// `-?` strips optionality so an optional metric (e.g. `judgeAgreement`) cannot
// leak `undefined` into the key union and index the metrics record.
type NumericMetricKey = {
  [Key in keyof EvalMetrics]-?: EvalMetrics[Key] extends number ? Key : never
}[keyof EvalMetrics]

const formatMetricValue = (value: number): string => value.toString()

// Evaluate the eval regression gate. See `EvalRegressionGateSchema` for why the
// outcome is three-valued and why a refusal names no failing case.
export const evaluateRegressionGate = (
  input: {
    readonly thresholds: EvalRegressionThresholds
    readonly metrics: z.infer<typeof EvalMetricsSchema>
    readonly caseResults: readonly EvalMetricCaseResult[]
  }
): {
  readonly outcome: EvalRegressionGateOutcome
  readonly reasons: readonly string[]
  readonly notEvaluableReasons: readonly string[]
  readonly failingCaseIds: readonly string[]
} => {
  const reasons: string[] = []
  const notEvaluableReasons: string[] = []
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
  // A ceiling threshold on a total that sums only the MEASURED cases. Unknown
  // spend can only add, so the comparison is still decisive in one direction:
  // a floor already above the threshold fails, whatever the unknowns hold. It is
  // the other direction that is not established, and that is where the gate
  // refuses instead of reporting a pass it cannot support.
  const addAboveReasonOverKnownOnlyTotal = (
    metricName: NumericMetricKey,
    threshold: number | undefined,
    unavailableCaseCount: number,
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

      return
    }

    if (unavailableCaseCount > 0) {
      notEvaluableReasons.push(
        `${metricName} not evaluable against threshold ${formatMetricValue(threshold)}: ${formatMetricValue(value)} is a known-only total, unmeasured for ${unavailableCaseCount} case(s), so the run's true total may be on either side of the threshold`
      )
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
  addAboveReasonOverKnownOnlyTotal(
    'costUsd',
    input.thresholds.maxCostUsd,
    input.metrics.costUnavailableCount,
    input.caseResults
  )
  addAboveReasonOverKnownOnlyTotal(
    'durationMs',
    input.thresholds.maxDurationMs,
    input.metrics.durationUnavailableCount,
    input.caseResults
  )

  return {
    // A definite failure outranks a refusal: an unknown elsewhere never rescues
    // a threshold the run demonstrably breached.
    outcome:
      reasons.length > 0
        ? 'failed'
        : notEvaluableReasons.length > 0
          ? 'not-evaluable'
          : 'passed',
    reasons,
    notEvaluableReasons,
    failingCaseIds: uniqueSorted(failingCaseIds)
  }
}
