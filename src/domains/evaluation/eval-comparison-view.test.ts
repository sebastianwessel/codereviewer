import { describe, expect, test } from 'vitest'
import {
  ComparisonMetricsSchema,
  parseEvalComparisonReport
} from './eval-comparison-view.js'
import { EvalReportSchema } from './eval-report-contracts.js'
import { EvalMetricsSchema } from './metrics.js'

// Metrics the producer records that the comparison read model deliberately does
// not model. Absence from this list and from `ComparisonMetricsSchema` is the
// failure the test below exists to catch: a new metric that silently renders as
// "unknown" in every comparison, forever, with nothing to say it went missing.
//
// Adding a metric here is a decision, not a formality. State which group it
// joins, and if none of them fit, model it in the read model instead.
const METRICS_DELIBERATELY_NOT_COMPARED: readonly string[] = [
  // Denominators. Each one is published in a single run's summary beside the
  // rate it divides; a delta between two denominators is not a quality signal,
  // and the rate above it already carries the comparison.
  'lineCheckCount',
  'severityCheckCount',
  'linePlacementCheckCount',
  'judgeAgreementPairCount',
  'plausibilityJudgeAgreementPairCount',
  'fixJudgedFindingCount',
  'fixGroundTruthFalsePositiveCount',
  'fixRealFindingCount',
  'fixAttemptedCount',
  'securityObviousCount',
  'securityHardCount',
  'artifactOnlyFindingCount',
  'artifactOnlyMatchedFindingCount',
  'artifactOnlyFalsePositiveCount',
  'inconclusiveMatchCount',
  'duplicateFindingCount',
  'noFindingZoneFalsePositiveCount',
  // Per-key record metrics. Comparison already diffs the populations it can
  // adjudicate (diff scope, metric groups); these break down one run's result
  // by a key set that is itself allowed to change between runs, so a
  // key-by-key delta would compare populations that are not the same.
  'recallByTier',
  'rejectionReasonCounts',
  'rejectionSeverityCounts',
  'rejectionReasonBySeverityCounts',
  'securityRecallByMechanism',
  'securityMechanismCounts',
  'securityRecallByContextDepth',
  'securityContextDepthCounts',
  'securityAdjustedPrecisionByMechanism',
  'securityFindingMechanismCounts',
  'securityMechanismAttributionCounts',
  // Judge spend and wall-clock. These measure what scoring and the harness
  // cost, not what the review under comparison did; `costUsd` and `durationMs`
  // are the review-side figures the comparison does diff.
  'scoringInputTokens',
  'scoringCachedInputTokens',
  'scoringOutputTokens',
  'scoringCostUnavailable',
  'scoringCostUsd',
  'elapsedMs',
  // Judge agreement is compared, but read from `scoring.judgeAgreement` rather
  // than from metrics: the gate/selection section adjudicates judge reliability
  // before any metric delta is allowed to be read as review quality.
  'judgeAgreement',
  // Quality rates not yet worth a comparison row. Every one of these is
  // published per run; promoting one is a matter of modelling it in
  // `ComparisonMetricsSchema` and giving it a row.
  'parseValidity',
  'severityWeightedPrecision',
  'severityWeightedRecall',
  'lineAccuracy',
  'linePlacementRate',
  'severityAccuracy',
  'actionableRate',
  'commentsPerKloc',
  'commentsPerDiffHunk',
  'incompleteCoverageRate',
  'contextMutationRate',
  'artifactOnlyRecall',
  'artifactOnlyPrecision',
  'productRecall',
  'nitRecall'
]

// The archived shape that broke `eval compare`: discovery totals written before
// `cappedByLimitCount` existed, in a report the producer contract now requires
// it in.
const archivedReport = {
  metricsVersion: '2026-08-01.discovery-telemetry',
  schemaVersion: '1.0',
  caseResults: [
    {
      caseId: 'case-a',
      discovery: {
        totals: { callCount: 3, rawFindingCount: 4 },
        tasks: [{ taskId: 'task-1', callCount: 3, rawFindingCount: 4 }]
      }
    }
  ],
  metrics: { recall: 0.5, precision: 0.5 }
}

describe('eval comparison view', () => {
  // The producer contract is correct to reject it: that report was not written
  // by this build. The comparison view exists because comparison must read it
  // anyway.
  test('the producer contract rejects a report missing a required field', () => {
    expect(() => EvalReportSchema.parse(archivedReport)).toThrow()
  })

  test('the comparison view reads it', () => {
    expect(() => parseEvalComparisonReport(archivedReport)).not.toThrow()
  })

  // The whole point of the view over a loosened producer contract.
  test('keeps an absent metric absent rather than defaulting it to zero', () => {
    const report = parseEvalComparisonReport(archivedReport)

    expect(report.metrics?.recall).toBe(0.5)
    expect(report.metrics?.falsePositiveCount).toBeUndefined()
    expect(report.metrics?.genuineFalsePositiveCount).toBeUndefined()
    expect(report.metricGroups).toBeUndefined()
  })

  // `null` (a rate over an empty denominator) and `undefined` (a rate the run
  // never recorded) are opposite statements and must survive parsing as such.
  test('distinguishes a measured-nothing rate from an unrecorded one', () => {
    const report = parseEvalComparisonReport({
      metricsVersion: 'x',
      metrics: { recallByDiffScope: { 'out-of-diff': null } }
    })

    expect(report.metrics?.recallByDiffScope?.['out-of-diff']).toBeNull()
    expect(report.metrics?.recallByDiffScope?.['in-diff']).toBeUndefined()
  })

  // A field a future engine build adds must not make an old tool refuse the
  // report, which is the mirror image of the defect being fixed.
  test('ignores a field the view does not model', () => {
    expect(() =>
      parseEvalComparisonReport({
        metricsVersion: 'x',
        somethingAddedLater: { nested: true }
      })
    ).not.toThrow()
  })

  // A report predating versioning gets the recorded sentinel, which the
  // scoring-rule history declares as "nothing is known", not a comparable id.
  test('defaults a missing metrics version to the pre-versioning sentinel', () => {
    expect(parseEvalComparisonReport({}).metricsVersion).toBe('pre-2026-07-26')
  })

  // The gate verdict as an archived report spelled it, before the outcome
  // became three-valued. That boolean IS the verdict the run reached, so
  // reading it is not a default -- it is the value that is there. Dropping it
  // from the view would render every report ever archived as `unknown`.
  test('reads the gate verdict an archived report recorded as a boolean', () => {
    const archived = parseEvalComparisonReport({
      metricsVersion: 'x',
      regressionGate: { passed: false, reasons: ['recall below threshold'] }
    })

    expect(archived.regressionGate?.passed).toBe(false)
    expect(archived.regressionGate?.outcome).toBeUndefined()
  })

  test('reads the three-valued gate outcome a current report records', () => {
    const current = parseEvalComparisonReport({
      metricsVersion: 'x',
      regressionGate: { outcome: 'not-evaluable' }
    })

    expect(current.regressionGate?.outcome).toBe('not-evaluable')
    expect(current.regressionGate?.passed).toBeUndefined()
  })

  // The read model is hand-maintained on purpose (see the module header), which
  // means a metric can be added to the producer and forgotten here. That failure
  // is invisible -- the metric renders as "unknown" in every comparison and
  // nothing complains -- so it is converted into a failing test.
  test('every producer metric is either compared or explicitly excluded', () => {
    const comparedKeys = new Set(Object.keys(ComparisonMetricsSchema.shape))
    const excludedKeys = new Set(METRICS_DELIBERATELY_NOT_COMPARED)
    const unaccounted = Object.keys(EvalMetricsSchema.shape).filter(
      (metric) => !comparedKeys.has(metric) && !excludedKeys.has(metric)
    )

    expect(unaccounted).toEqual([])
  })

  // The mirror failure: an entry left behind after the metric it names was
  // renamed or removed, which would quietly re-open the gap it was closing.
  test('nothing is compared or excluded that the producer no longer records', () => {
    const producerKeys = new Set(Object.keys(EvalMetricsSchema.shape))
    const stale = [
      ...Object.keys(ComparisonMetricsSchema.shape),
      ...METRICS_DELIBERATELY_NOT_COMPARED
    ].filter((metric) => !producerKeys.has(metric))

    expect(stale).toEqual([])
  })
})
