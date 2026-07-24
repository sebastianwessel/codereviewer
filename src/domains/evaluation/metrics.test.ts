import { describe, expect, test } from 'vitest'
import type { Severity } from '../../shared/contracts/index.js'
import {
  calculateEvalMetrics,
  severityWeight,
  type EvalMetricCaseResult
} from './metrics.js'

const caseResult = (
  overrides: Partial<EvalMetricCaseResult> = {}
): EvalMetricCaseResult => ({
  caseId: 'case-1',
  parseValid: true,
  providerErrored: false,
  providerIssueCount: 0,
  expectedFindingCount: 2,
  inconclusiveMatchCount: 0,
  admittedFindingCount: 3,
  matchedFindingCount: 1,
  expectedSeverityWeights: [4, 2],
  matchedExpectedSeverityWeights: [4],
  falsePositiveSeverityWeights: [1, 3],
  matchedLineCheckCount: 1,
  accurateLineMatchCount: 1,
  matchedSeverityCheckCount: 1,
  accurateSeverityMatchCount: 1,
  actionableFindingCount: 2,
  falsePositiveCount: 2,
  unlistedRealFindingCount: 0,
  duplicateFindingCount: 0,
  artifactOnlyFindingCount: 0,
  artifactOnlyMatchedFindingCount: 0,
  artifactOnlyFalsePositiveCount: 0,
  trustedDeterministicFindingCount: 1,
  provedRefutationCount: 0,
  rejectedFindingCount: 0,
  fixJudgmentAgreementCount: 0,
  fixJudgedLabeledCount: 0,
  fixFalsePositiveDetectedCount: 0,
  fixGroundTruthFalsePositiveCount: 0,
  fixProducedForRealCount: 0,
  fixRealFindingCount: 0,
  fixApplyFailedCount: 0,
  fixApplyAttemptedCount: 0,
  tierCounts: {
    'runtime-critical': { expected: 1, matched: 1 },
    security: { expected: 0, matched: 0 },
    logic: { expected: 1, matched: 0 },
    nit: { expected: 0, matched: 0 }
  },
  noFindingZoneFalsePositiveCount: 1,
  changedLineCount: 200,
  diffHunkCount: 4,
  coverageIncomplete: true,
  contextLedgerEntryCount: 4,
  mutatedContextLedgerEntryCount: 1,
  costUsd: 0.25,
  inputTokens: 100,
  cachedInputTokens: 40,
  outputTokens: 50,
  costUnavailable: false,
  durationMs: 1200,
  warnings: ['coverage-incomplete'],
  failingFindingIds: ['find_noise1'],
  ...overrides
})

describe('eval metrics', () => {
  test('calculates deterministic precision, recall, weighted metrics, and noise rates', () => {
    expect(calculateEvalMetrics([caseResult()])).toMatchObject({
      parseValidity: 1,
      recall: 0.5,
      precision: 0.333333,
      f1: 0.4,
      severityWeightedRecall: 0.666667,
      severityWeightedPrecision: 0.5,
      severityWeightedF1: 0.571429,
      lineAccuracy: 1,
      severityAccuracy: 1,
      falsePositiveCount: 2,
      noFindingZoneFalsePositiveCount: 1,
      actionableRate: 0.666667,
      commentsPerKloc: 15,
      commentsPerDiffHunk: 0.75,
      incompleteCoverageRate: 1,
      contextMutationRate: 0.25,
      providerErrorRate: 0,
      providerIssueRate: 0,
      providerIssueCount: 0,
      duplicateFindingCount: 0,
      artifactOnlyRecall: 0,
      artifactOnlyPrecision: 1,
      artifactOnlyFindingCount: 0,
      artifactOnlyMatchedFindingCount: 0,
      artifactOnlyFalsePositiveCount: 0,
      trustedDeterministicFindingCount: 1,
      refutationFalseNegativeCount: 0,
      refutationFalsePositiveCount: 0,
      productRecall: 0.5,
      nitRecall: 1,
      inputTokens: 100,
      cachedInputTokens: 40,
      outputTokens: 50,
      costUnavailableCount: 0,
      costUsd: 0.25,
      durationMs: 1200
    })
  })

  test('reports per-tier recall and the headline product recall', () => {
    const metrics = calculateEvalMetrics([
      caseResult({
        tierCounts: {
          'runtime-critical': { expected: 2, matched: 1 },
          security: { expected: 2, matched: 2 },
          logic: { expected: 1, matched: 0 },
          nit: { expected: 4, matched: 1 }
        }
      })
    ])

    expect(metrics.recallByTier).toEqual({
      'runtime-critical': 0.5,
      security: 1,
      logic: 0,
      nit: 0.25
    })
    // productRecall over runtime-critical + security + logic: 3 matched / 5 expected.
    expect(metrics.productRecall).toBe(0.6)
    expect(metrics.nitRecall).toBe(0.25)
  })

  test('never emits a rate outside [0,1] under adversarial case results', () => {
    // Drift guard: aggregating inconsistent/extreme per-case counts must not
    // produce a rate > 1 (or < 0). An out-of-range rate fails EvalMetricsSchema
    // and aborts the whole run at report assembly.
    // calculateEvalMetrics parses against EvalMetricsSchema internally, so a
    // successful return already proves schema validity; we also assert ranges.
    const metrics = calculateEvalMetrics([
      caseResult({
        expectedFindingCount: 1,
        matchedFindingCount: 9,
        admittedFindingCount: 0,
        tierCounts: {
          'runtime-critical': { expected: 1, matched: 9 },
          security: { expected: 0, matched: 4 },
          logic: { expected: 2, matched: 9 },
          nit: { expected: 0, matched: 3 }
        }
      }),
      caseResult({
        providerErrored: true
      })
    ])

    const rateFields = [
      metrics.recall,
      metrics.precision,
      metrics.f1,
      metrics.productRecall,
      metrics.nitRecall,
      ...Object.values(metrics.recallByTier)
    ]

    for (const rate of rateFields) {
      expect(rate).toBeGreaterThanOrEqual(0)
      expect(rate).toBeLessThanOrEqual(1)
    }
  })

  test('handles divide-by-zero cases without NaN or infinity', () => {
    const metrics = calculateEvalMetrics([
      caseResult({
        expectedFindingCount: 0,
        admittedFindingCount: 0,
        matchedFindingCount: 0,
        expectedSeverityWeights: [],
        matchedExpectedSeverityWeights: [],
        falsePositiveSeverityWeights: [],
        matchedLineCheckCount: 0,
        accurateLineMatchCount: 0,
        matchedSeverityCheckCount: 0,
        accurateSeverityMatchCount: 0,
        actionableFindingCount: 0,
        falsePositiveCount: 0,
        duplicateFindingCount: 0,
        artifactOnlyFindingCount: 0,
        artifactOnlyMatchedFindingCount: 0,
        artifactOnlyFalsePositiveCount: 0,
        trustedDeterministicFindingCount: 0,
        provedRefutationCount: 0,
        rejectedFindingCount: 0,
        tierCounts: {
          'runtime-critical': { expected: 0, matched: 0 },
          security: { expected: 0, matched: 0 },
          logic: { expected: 0, matched: 0 },
          nit: { expected: 0, matched: 0 }
        },
        noFindingZoneFalsePositiveCount: 0,
        changedLineCount: 0,
        diffHunkCount: 0,
        coverageIncomplete: false,
        contextLedgerEntryCount: 0,
        mutatedContextLedgerEntryCount: 0,
        costUsd: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        costUnavailable: false,
        durationMs: 0,
        warnings: [],
        failingFindingIds: []
      })
    ])

    const scalarMetricValues = Object.values(metrics).filter(
      (value): value is number => typeof value === 'number'
    )
    expect(scalarMetricValues.every((value) => Number.isFinite(value))).toBe(true)
    expect(
      Object.values(metrics.recallByTier).every((value) =>
        Number.isFinite(value)
      )
    ).toBe(true)
    expect(metrics.recall).toBe(1)
    expect(metrics.precision).toBe(1)
    expect(metrics.commentsPerKloc).toBe(0)
  })

  test('exports one centralized severity weighting helper', () => {
    const severities: readonly Severity[] = [
      'critical',
      'high',
      'medium',
      'low',
      'info'
    ]

    expect(severities.map((severity) => severityWeight(severity))).toEqual([
      5,
      4,
      3,
      2,
      1
    ])
  })

  test('counts recovered provider retries as provider issues', () => {
    const metrics = calculateEvalMetrics([
      caseResult({
        providerIssueCount: 1,
        warnings: ['eval-provider-retry:provider_timeout']
      }),
      caseResult()
    ])

    expect(metrics.providerErrorRate).toBe(0)
    expect(metrics.providerIssueRate).toBe(0.5)
    expect(metrics.providerIssueCount).toBe(1)
  })

  test('derives refutation false negatives from rejected findings, bounded by unmatched expected', () => {
    const metrics = calculateEvalMetrics([
      caseResult({
        expectedFindingCount: 2,
        matchedFindingCount: 1,
        rejectedFindingCount: 3
      })
    ])

    // Unmatched expected = 2 - 1 = 1 bounds the 3 rejected findings.
    expect(metrics.refutationFalseNegativeCount).toBe(1)
  })

  test('derives refutation false positives from proved refutations whose findings never matched', () => {
    const metrics = calculateEvalMetrics([
      caseResult({
        matchedFindingCount: 1,
        provedRefutationCount: 3
      })
    ])

    // 3 proved refutations, only 1 matched: 2 unmatched proved refutations.
    expect(metrics.refutationFalsePositiveCount).toBe(2)
  })

  test('reports zero for every fix-lane metric when the lane never ran', () => {
    // Divide-by-zero guard: all fix denominators are 0, so each rate is 0 (not
    // the 1 recall/precision use for "nothing expected"), and counts are 0.
    const metrics = calculateEvalMetrics([caseResult()])

    expect(metrics).toMatchObject({
      fixJudgmentAccuracy: 0,
      fixFalsePositiveDetectionRate: 0,
      fixProduceRate: 0,
      fixApplyFailureRate: 0,
      fixJudgedFindingCount: 0,
      fixGroundTruthFalsePositiveCount: 0,
      fixRealFindingCount: 0,
      fixAttemptedCount: 0
    })
  })

  test('computes fix-lane accuracy over mixed real and false-positive judgments', () => {
    // Case A: two judged-and-labeled findings, one agreeing (real->real) and one
    // disagreeing (a false positive the lane called real). One GT false positive
    // was caught. One real finding got an apply-checked fix; one apply attempt
    // failed.
    const metrics = calculateEvalMetrics([
      caseResult({
        fixJudgmentAgreementCount: 1,
        fixJudgedLabeledCount: 2,
        fixFalsePositiveDetectedCount: 1,
        fixGroundTruthFalsePositiveCount: 2,
        fixProducedForRealCount: 1,
        fixRealFindingCount: 2,
        fixApplyFailedCount: 1,
        fixApplyAttemptedCount: 2
      }),
      // Case B: one perfectly-judged real finding with a produced fix, no failures.
      caseResult({
        fixJudgmentAgreementCount: 1,
        fixJudgedLabeledCount: 1,
        fixFalsePositiveDetectedCount: 0,
        fixGroundTruthFalsePositiveCount: 0,
        fixProducedForRealCount: 1,
        fixRealFindingCount: 1,
        fixApplyFailedCount: 0,
        fixApplyAttemptedCount: 1
      })
    ])

    // Judgment accuracy: (1 + 1) agreements / (2 + 1) judged-labeled = 2/3.
    expect(metrics.fixJudgmentAccuracy).toBe(0.666667)
    expect(metrics.fixJudgedFindingCount).toBe(3)
    // False-positive detection: 1 caught / 2 ground-truth false positives = 0.5.
    expect(metrics.fixFalsePositiveDetectionRate).toBe(0.5)
    expect(metrics.fixGroundTruthFalsePositiveCount).toBe(2)
    // Produce rate: (1 + 1) produced / (2 + 1) real findings = 2/3.
    expect(metrics.fixProduceRate).toBe(0.666667)
    expect(metrics.fixRealFindingCount).toBe(3)
    // Apply failure: 1 failed / (2 + 1) attempted = 1/3.
    expect(metrics.fixApplyFailureRate).toBe(0.333333)
    expect(metrics.fixAttemptedCount).toBe(3)
  })
})
