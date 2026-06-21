import { describe, expect, test } from 'vitest'
import type { Severity } from '../../shared/contracts/index.js'
import { calculateEvalMetrics, type EvalMetricCaseResult } from './metrics.js'

const caseResult = (
  overrides: Partial<EvalMetricCaseResult> = {}
): EvalMetricCaseResult => ({
  caseId: 'case-1',
  parseValid: true,
  providerErrored: false,
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
  noFindingZoneFalsePositiveCount: 1,
  changedLineCount: 200,
  diffHunkCount: 4,
  coverageIncomplete: true,
  contextLedgerEntryCount: 4,
  mutatedContextLedgerEntryCount: 1,
  costUsd: 0.25,
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
      costUsd: 0.25,
      durationMs: 1200
    })
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
        noFindingZoneFalsePositiveCount: 0,
        changedLineCount: 0,
        diffHunkCount: 0,
        coverageIncomplete: false,
        contextLedgerEntryCount: 0,
        mutatedContextLedgerEntryCount: 0,
        costUsd: 0,
        durationMs: 0,
        warnings: [],
        failingFindingIds: []
      })
    ])

    expect(Object.values(metrics).every((value) => Number.isFinite(value))).toBe(
      true
    )
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
})
