import { describe, expect, test } from 'vitest'
import type { Severity } from '../../shared/contracts/index.js'
import { calculateEvalMetrics, type EvalMetricCaseResult } from './metrics.js'

const caseResult = (
  overrides: Partial<EvalMetricCaseResult> = {}
): EvalMetricCaseResult => ({
  caseId: 'case-1',
  parseValid: true,
  providerErrored: false,
  providerIssueCount: 0,
  expectedFindingCount: 2,
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
  duplicateFindingCount: 0,
  artifactOnlyFindingCount: 0,
  artifactOnlyMatchedFindingCount: 0,
  artifactOnlyFalsePositiveCount: 0,
  trustedDeterministicFindingCount: 1,
  modelSuspicionCount: 1,
  proofPacketCount: 1,
  promotedProofCount: 1,
  actionablePromotedProofCount: 1,
  refutedProofCount: 0,
  weakOrDemotedProofCount: 0,
  staticDuplicateDemotionCount: 0,
  investigationToolReadCount: 2,
  tierCounts: {
    'runtime-critical': { expected: 1, matched: 1 },
    security: { expected: 0, matched: 0 },
    logic: { expected: 1, matched: 0 },
    nit: { expected: 0, matched: 0 }
  },
  judgedFindingCount: 1,
  noFindingZoneFalsePositiveCount: 1,
  changedLineCount: 200,
  diffHunkCount: 4,
  coverageIncomplete: true,
  contextLedgerEntryCount: 4,
  mutatedContextLedgerEntryCount: 1,
  costUsd: 0.25,
  inputTokens: 100,
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
      suspicionRecall: 0.5,
      proofRecall: 0.5,
      proofPromotionPrecision: 1,
      refutationFalseNegativeCount: 0,
      refutationFalsePositiveCount: 0,
      staticDuplicateDemotionCount: 0,
      investigationToolReadCount: 2,
      productRecall: 0.5,
      nitRecall: 1,
      suspicionStageCoverage: 1,
      judgeCoverage: 1,
      inputTokens: 100,
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
    // precisionByTier mirrors recallByTier (documented recall-parity).
    expect(metrics.precisionByTier).toEqual(metrics.recallByTier)
    // productRecall over runtime-critical + security + logic: 3 matched / 5 expected.
    expect(metrics.productRecall).toBe(0.6)
    expect(metrics.nitRecall).toBe(0.25)
  })

  test('measures suspicion-stage and judge coverage', () => {
    const metrics = calculateEvalMetrics([
      caseResult({ modelSuspicionCount: 0, judgedFindingCount: 0 }),
      caseResult({
        modelSuspicionCount: 2,
        judgedFindingCount: 3,
        actionablePromotedProofCount: 2
      }),
      caseResult({ providerErrored: true, modelSuspicionCount: 0 })
    ])

    // Provider-error case excluded from the suspicion-stage denominator: 1 of 2.
    expect(metrics.suspicionStageCoverage).toBe(0.5)
    // judged 0+3+1 over actionable-promoted 1+2+1 = 4/4.
    expect(metrics.judgeCoverage).toBe(1)
  })

  test('clamps judge coverage to 1 when judged candidates exceed actionable proofs', () => {
    // Regression: the judge runs on every proved survivor, and judge-rejected
    // candidates are not actionable-promoted, so aggregate judged can exceed
    // aggregate actionable-promoted. The raw ratio (>1) must clamp to 1 so it
    // does not fail EvalMetricsSchema and abort the whole run at report assembly.
    const metrics = calculateEvalMetrics([
      caseResult({ judgedFindingCount: 8, actionablePromotedProofCount: 1 }),
      caseResult({ judgedFindingCount: 5, actionablePromotedProofCount: 2 })
    ])

    expect(metrics.judgeCoverage).toBe(1)
  })

  test('never emits a rate outside [0,1] under adversarial case results', () => {
    // Drift guard: aggregating inconsistent/extreme per-case counts must not
    // produce a rate > 1 (or < 0). An out-of-range rate fails EvalMetricsSchema
    // and aborts the whole run at report assembly (the judgeCoverage>1 bug).
    // calculateEvalMetrics parses against EvalMetricsSchema internally, so a
    // successful return already proves schema validity; we also assert ranges.
    const metrics = calculateEvalMetrics([
      caseResult({
        expectedFindingCount: 1,
        matchedFindingCount: 9,
        admittedFindingCount: 0,
        actionablePromotedProofCount: 1,
        judgedFindingCount: 50,
        tierCounts: {
          'runtime-critical': { expected: 1, matched: 9 },
          security: { expected: 0, matched: 4 },
          logic: { expected: 2, matched: 9 },
          nit: { expected: 0, matched: 3 }
        }
      }),
      caseResult({
        providerErrored: true,
        modelSuspicionCount: 0,
        judgedFindingCount: 7,
        actionablePromotedProofCount: 0
      })
    ])

    const rateFields = [
      metrics.recall,
      metrics.precision,
      metrics.f1,
      metrics.productRecall,
      metrics.nitRecall,
      metrics.suspicionStageCoverage,
      metrics.judgeCoverage,
      metrics.proofPromotionPrecision,
      ...Object.values(metrics.recallByTier),
      ...Object.values(metrics.precisionByTier)
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
        modelSuspicionCount: 0,
        proofPacketCount: 0,
        promotedProofCount: 0,
        actionablePromotedProofCount: 0,
        refutedProofCount: 0,
        weakOrDemotedProofCount: 0,
        staticDuplicateDemotionCount: 0,
        investigationToolReadCount: 0,
        tierCounts: {
          'runtime-critical': { expected: 0, matched: 0 },
          security: { expected: 0, matched: 0 },
          logic: { expected: 0, matched: 0 },
          nit: { expected: 0, matched: 0 }
        },
        judgedFindingCount: 0,
        noFindingZoneFalsePositiveCount: 0,
        changedLineCount: 0,
        diffHunkCount: 0,
        coverageIncomplete: false,
        contextLedgerEntryCount: 0,
        mutatedContextLedgerEntryCount: 0,
        costUsd: 0,
        inputTokens: 0,
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

    expect(severities.map((severity) => calculateEvalMetrics.severityWeight(severity))).toEqual([
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

  test('calculates proof quality metrics from case-level proof counts', () => {
    const metrics = calculateEvalMetrics([
      caseResult({
        expectedFindingCount: 2,
        matchedFindingCount: 1,
        artifactOnlyMatchedFindingCount: 1,
        proofPacketCount: 2,
        promotedProofCount: 2,
        actionablePromotedProofCount: 1,
        weakOrDemotedProofCount: 1,
        staticDuplicateDemotionCount: 1,
        investigationToolReadCount: 3
      })
    ])

    expect(metrics).toMatchObject({
      suspicionRecall: 1,
      proofRecall: 1,
      proofPromotionPrecision: 1,
      refutationFalseNegativeCount: 1,
      refutationFalsePositiveCount: 0,
      staticDuplicateDemotionCount: 1,
      investigationToolReadCount: 3
    })
  })
})
