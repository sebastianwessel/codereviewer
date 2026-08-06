import { describe, expect, test } from 'vitest'
import type { Severity } from '../../shared/contracts/index.js'
import {
  calculateEvalMetrics,
  emptyDiffScopeCounts,
  emptySecurityContextDepthCounts,
  emptySecurityMechanismCounts,
  severityWeight,
  type EvalMetricCaseResult
} from './metrics.js'
import { emptySecurityFindingMechanismCounts } from './security-mechanism-attribution.js'

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
  linePlacementCheckCount: 1,
  accurateLinePlacementCount: 1,
  matchedSeverityCheckCount: 1,
  accurateSeverityMatchCount: 1,
  actionableFindingCount: 2,
  falsePositiveCount: 2,
  unlistedRealFindingCount: 0,
  duplicateFindingCount: 0,
  artifactOnlyFindingCount: 0,
  artifactOnlyMatchedFindingCount: 0,
  artifactOnlyFalsePositiveCount: 0,
  provedRefutationCount: 0,
  rejectedFindingCount: 0,
  rejectionReasonCounts: {},
  rejectionSeverityCounts: {},
  rejectionReasonBySeverityCounts: {},
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
  securityMechanismCounts: emptySecurityMechanismCounts(),
  securityFindingMechanismCounts: emptySecurityFindingMechanismCounts(),
  securityContextDepthCounts: emptySecurityContextDepthCounts(),
  diffScopeCounts: emptyDiffScopeCounts(),
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
      refutationFalseNegativeCount: 0,
      refutationFalsePositiveCount: 0,
      productRecall: 0.5,
      nitRecall: 1,
      inputTokens: 100,
      cachedInputTokens: 40,
      outputTokens: 50,
      usageUnavailableCount: 0,
      costUnavailableCount: 0,
      costUsd: 0.25,
      durationMs: 1200,
      durationUnavailableCount: 0
    })
  })

  // The run's headline cost is a decision input in capability-withdrawal rules.
  // A case whose cost was never measured must not be able to lower it while the
  // report still presents the total as exact.
  test('excludes an unmeasured case from the cost and duration totals and counts it', () => {
    const metrics = calculateEvalMetrics([
      caseResult({ costUsd: 0.25, durationMs: 1200 }),
      caseResult({ costUsd: null, durationMs: null })
    ])

    expect(metrics.costUsd).toBe(0.25)
    expect(metrics.costUnavailableCount).toBe(1)
    expect(metrics.durationMs).toBe(1200)
    expect(metrics.durationUnavailableCount).toBe(1)
  })

  // The same rule for token usage. One count covers all three totals because a
  // review report surfaces them together or not at all.
  test('excludes an unmeasured case from the token totals and counts it', () => {
    const metrics = calculateEvalMetrics([
      caseResult({ inputTokens: 100, cachedInputTokens: 40, outputTokens: 50 }),
      caseResult({
        inputTokens: null,
        cachedInputTokens: null,
        outputTokens: null
      })
    ])

    expect(metrics.inputTokens).toBe(100)
    expect(metrics.cachedInputTokens).toBe(40)
    expect(metrics.outputTokens).toBe(50)
    expect(metrics.usageUnavailableCount).toBe(1)
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

  test('reports recall separately for the in-diff and out-of-diff populations', () => {
    const metrics = calculateEvalMetrics([
      caseResult({
        expectedFindingCount: 6,
        matchedFindingCount: 3,
        diffScopeCounts: {
          'in-diff': { expected: 4, matched: 3 },
          'out-of-diff': { expected: 2, matched: 0 },
          undetermined: { expected: 0, matched: 0 }
        }
      })
    ])

    // The blended figure is the one that depends on the population mix; the
    // split is what makes it interpretable, so both must be present.
    expect(metrics.recall).toBe(0.5)
    expect(metrics.recallByDiffScope['in-diff']).toBe(0.75)
    expect(metrics.recallByDiffScope['out-of-diff']).toBe(0)
    expect(metrics.diffScopeCounts).toEqual({
      'in-diff': { expected: 4, matched: 3 },
      'out-of-diff': { expected: 2, matched: 0 },
      undetermined: { expected: 0, matched: 0 }
    })
  })

  test('reports an unmeasured diff-scope population as null, not as zero recall', () => {
    // A fully missed population and an absent one must never render alike: the
    // engine's measured out-of-diff recall is a real 0 over a real denominator.
    const metrics = calculateEvalMetrics([
      caseResult({
        expectedFindingCount: 2,
        matchedFindingCount: 0,
        diffScopeCounts: {
          'in-diff': { expected: 0, matched: 0 },
          'out-of-diff': { expected: 2, matched: 0 },
          undetermined: { expected: 0, matched: 0 }
        }
      })
    ])

    expect(metrics.recallByDiffScope['in-diff']).toBeNull()
    expect(metrics.diffScopeCounts['in-diff']).toEqual({
      expected: 0,
      matched: 0
    })
    expect(metrics.recallByDiffScope['out-of-diff']).toBe(0)
    expect(metrics.diffScopeCounts['out-of-diff']).toEqual({
      expected: 2,
      matched: 0
    })
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
        linePlacementCheckCount: 0,
        accurateLinePlacementCount: 0,
        matchedSeverityCheckCount: 0,
        accurateSeverityMatchCount: 0,
        actionableFindingCount: 0,
        falsePositiveCount: 0,
        duplicateFindingCount: 0,
        artifactOnlyFindingCount: 0,
        artifactOnlyMatchedFindingCount: 0,
        artifactOnlyFalsePositiveCount: 0,
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
    // The empty denominator must travel with the rate. Without it a reader
    // cannot tell an undefined rate from a measured failure, and the neutral
    // 1 these rates fall back to would read as a perfect score.
    expect(metrics.lineCheckCount).toBe(0)
    expect(metrics.severityCheckCount).toBe(0)
  })

  test('computes security recall per mechanism, per context depth, and the obvious/hard split', () => {
    // Five security findings, consistently labelled across the two records:
    //   authorization/local     matched
    //   authorization/local     matched
    //   authorization/cross-file NOT matched
    //   injection/cross-file    NOT matched
    //   injection/cross-file    NOT matched
    const mechanismCounts = emptySecurityMechanismCounts()
    mechanismCounts.authorization = { expected: 3, matched: 2 }
    mechanismCounts.injection = { expected: 2, matched: 0 }
    const contextDepthCounts = emptySecurityContextDepthCounts()
    contextDepthCounts.local = { expected: 2, matched: 2 }
    contextDepthCounts['cross-file'] = { expected: 3, matched: 0 }

    const metrics = calculateEvalMetrics([
      caseResult({
        securityMechanismCounts: mechanismCounts,
        securityContextDepthCounts: contextDepthCounts
      })
    ])

    // Per mechanism: matched / expected, with the denominators surfaced.
    expect(metrics.securityRecallByMechanism.authorization).toBe(0.666667)
    expect(metrics.securityMechanismCounts.authorization).toEqual({
      expected: 3,
      matched: 2
    })
    expect(metrics.securityRecallByMechanism.injection).toBe(0)
    expect(metrics.securityMechanismCounts.injection).toEqual({
      expected: 2,
      matched: 0
    })
    // A mechanism with no expected finding: divide-by-zero -> 0 with count 0, not
    // a misleading 100%.
    expect(metrics.securityRecallByMechanism.ssrf).toBe(0)
    expect(metrics.securityMechanismCounts.ssrf).toEqual({
      expected: 0,
      matched: 0
    })

    // Per context depth.
    expect(metrics.securityRecallByContextDepth.local).toBe(1)
    expect(metrics.securityRecallByContextDepth['cross-file']).toBe(0)
    expect(
      metrics.securityRecallByContextDepth['analyzer-path-dependent']
    ).toBe(0)
    expect(
      metrics.securityContextDepthCounts['analyzer-path-dependent']
    ).toEqual({ expected: 0, matched: 0 })

    // Obvious = local (2/2), hard = everything else (0/3). The counts are the
    // expected denominators so a small sample is not over-read.
    expect(metrics.securityObviousRecall).toBe(1)
    expect(metrics.securityObviousCount).toBe(2)
    expect(metrics.securityHardRecall).toBe(0)
    expect(metrics.securityHardCount).toBe(3)
  })

  test('reports zero security recall with zero counts when no security finding was expected', () => {
    const metrics = calculateEvalMetrics([caseResult()])

    expect(metrics.securityObviousRecall).toBe(0)
    expect(metrics.securityHardRecall).toBe(0)
    expect(metrics.securityObviousCount).toBe(0)
    expect(metrics.securityHardCount).toBe(0)
    expect(
      Object.values(metrics.securityRecallByMechanism).every(
        (rate) => rate === 0
      )
    ).toBe(true)
    expect(
      Object.values(metrics.securityMechanismCounts).every(
        (counts) => counts.expected === 0 && counts.matched === 0
      )
    ).toBe(true)
  })

  test('aggregates security mechanism denominators across cases', () => {
    const first = emptySecurityMechanismCounts()
    first.authorization = { expected: 2, matched: 1 }
    const second = emptySecurityMechanismCounts()
    second.authorization = { expected: 1, matched: 1 }

    const metrics = calculateEvalMetrics([
      caseResult({ securityMechanismCounts: first }),
      caseResult({ securityMechanismCounts: second })
    ])

    // (1 + 1) matched / (2 + 1) expected = 2/3.
    expect(metrics.securityRecallByMechanism.authorization).toBe(0.666667)
    expect(metrics.securityMechanismCounts.authorization).toEqual({
      expected: 3,
      matched: 2
    })
  })

  test('publishes per-mechanism adjusted precision once every security false positive is attributed', () => {
    const findingCounts = emptySecurityFindingMechanismCounts()
    findingCounts.authorization = { matched: 3, genuineFalsePositive: 1 }
    findingCounts.injection = { matched: 0, genuineFalsePositive: 2 }

    const metrics = calculateEvalMetrics([
      caseResult({ securityFindingMechanismCounts: findingCounts })
    ])

    expect(metrics.securityAdjustedPrecisionByMechanism.authorization).toBe(0.75)
    expect(metrics.securityAdjustedPrecisionByMechanism.injection).toBe(0)
    // No admitted finding, so nothing was measured: null, never a vacuous 100%.
    expect(metrics.securityAdjustedPrecisionByMechanism.ssrf).toBeNull()
    expect(metrics.securityFindingMechanismCounts.authorization).toEqual({
      matched: 3,
      genuineFalsePositive: 1
    })
    expect(metrics.securityMechanismAttributionCounts).toEqual({
      expectation: 3,
      cwe: 3,
      unknown: 0
    })
  })

  test('withholds every per-mechanism precision while a genuine security false positive is unattributed', () => {
    // One false positive nobody could label could belong to any mechanism, so it
    // bounds all of them. Publishing authorization at 100% here would report a
    // precision no evidence supports.
    const findingCounts = emptySecurityFindingMechanismCounts()
    findingCounts.authorization = { matched: 4, genuineFalsePositive: 0 }
    findingCounts.unknown = { matched: 0, genuineFalsePositive: 1 }

    const metrics = calculateEvalMetrics([
      caseResult({ securityFindingMechanismCounts: findingCounts })
    ])

    expect(metrics.securityAdjustedPrecisionByMechanism.authorization).toBeNull()
    expect(metrics.securityFindingMechanismCounts.authorization.matched).toBe(4)
    expect(metrics.securityMechanismAttributionCounts.unknown).toBe(1)
  })

  test('aggregates per-mechanism precision counts across cases', () => {
    const first = emptySecurityFindingMechanismCounts()
    first.xss = { matched: 1, genuineFalsePositive: 1 }
    const second = emptySecurityFindingMechanismCounts()
    second.xss = { matched: 1, genuineFalsePositive: 0 }

    const metrics = calculateEvalMetrics([
      caseResult({ securityFindingMechanismCounts: first }),
      caseResult({ securityFindingMechanismCounts: second })
    ])

    expect(metrics.securityFindingMechanismCounts.xss).toEqual({
      matched: 2,
      genuineFalsePositive: 1
    })
    expect(metrics.securityAdjustedPrecisionByMechanism.xss).toBe(0.666667)
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

  // The floor hypothesis could not be settled from any archived run because
  // rejections were never persisted: "did the gate discard a low-severity
  // candidate before anyone could see it?" had no stored answer in either
  // direction.
  test('tallies what the admission gate discarded, by reason', () => {
    const metrics = calculateEvalMetrics([
      caseResult({
        rejectedFindingCount: 3,
        rejectionReasonCounts: { 'below-threshold': 2, duplicate: 1 }
      }),
      caseResult({
        rejectedFindingCount: 1,
        rejectionReasonCounts: { 'below-threshold': 1 }
      })
    ])

    expect(metrics.rejectionReasonCounts).toEqual({
      'below-threshold': 3,
      duplicate: 1
    })
  })

  // Companion tally to the one above: without a per-severity breakdown, "is the
  // model over-calling severity" is confounded by the admission floor deleting
  // every model-origin `low` candidate before anyone downstream can observe
  // it. `unknown` covers a rejection whose candidate severity could not be
  // recovered (currently: refutation-stage rejections).
  test('tallies what the admission gate discarded, by severity and by reason x severity', () => {
    const metrics = calculateEvalMetrics([
      caseResult({
        rejectedFindingCount: 3,
        rejectionSeverityCounts: { high: 2, low: 1 },
        rejectionReasonBySeverityCounts: {
          'below-threshold': { low: 1 },
          duplicate: { high: 2 }
        }
      }),
      caseResult({
        rejectedFindingCount: 1,
        rejectionSeverityCounts: { unknown: 1 },
        rejectionReasonBySeverityCounts: {
          refuted: { unknown: 1 }
        }
      })
    ])

    expect(metrics.rejectionSeverityCounts).toEqual({
      high: 2,
      low: 1,
      unknown: 1
    })
    expect(metrics.rejectionReasonBySeverityCounts).toEqual({
      'below-threshold': { low: 1 },
      duplicate: { high: 2 },
      refuted: { unknown: 1 }
    })
  })

  test('counts a proved candidate as a refuter false positive only when it was not a real defect', () => {
    const metrics = calculateEvalMetrics([
      caseResult({
        matchedFindingCount: 1,
        provedRefutationCount: 3,
        falsePositiveCount: 2,
        unlistedRealFindingCount: 0
      })
    ])

    // Both unmatched findings were judged spurious, so both are refuter errors.
    expect(metrics.refutationFalsePositiveCount).toBe(2)
  })

  // The regression this metric was built on: it used to count every proved
  // finding that missed the answer key, which charged the refuter for the genuine
  // defects the fixture never listed and made it numerically identical to
  // unlistedRealFindingCount on a clean run.
  test('never charges the refuter for defects the answer key simply omitted', () => {
    const metrics = calculateEvalMetrics([
      caseResult({
        matchedFindingCount: 1,
        provedRefutationCount: 3,
        falsePositiveCount: 2,
        unlistedRealFindingCount: 2
      })
    ])

    expect(metrics.unlistedRealFindingCount).toBe(2)
    expect(metrics.refutationFalsePositiveCount).toBe(0)
  })

  test('bounds refuter false positives by the proved refutations', () => {
    // A trusted deterministic finding is refutation-exempt, so a spurious one
    // must not be charged to a refuter that never adjudicated it.
    const metrics = calculateEvalMetrics([
      caseResult({
        matchedFindingCount: 0,
        provedRefutationCount: 1,
        falsePositiveCount: 3,
        unlistedRealFindingCount: 0
      })
    ])

    expect(metrics.refutationFalsePositiveCount).toBe(1)
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
