import { describe, expect, test } from 'vitest'
import { renderEvalComparison } from './eval-comparison-report-rendering.js'
import { parseEvalComparisonReport } from './eval-comparison-view.js'

// Reports are built as raw JSON and read through the comparison view, exactly
// as `eval compare` reads a file from disk. That is the point: the view is what
// makes an archived report readable at all, so a fixture that bypassed it would
// test nothing about the defect these cases cover.
const reportJson = (
  overrides: Readonly<Record<string, unknown>> = {}
): Record<string, unknown> => ({
  metricsVersion: '2026-08-03.plausibility-source-window',
  generatedAt: '2026-08-05T00:00:00.000Z',
  fixtureCount: 1,
  selection: {
    fixtureSource: 'slice-root',
    sliceRoot: 'eval/slices',
    caseFilters: [],
    selectedCaseIds: ['case-a']
  },
  provenance: {
    answerKeyDigest: 'digest',
    answerKeyDigestByCase: { 'case-a': 'digest-a' },
    configHash: 'config'
  },
  scoring: {
    judgeAgreement: 1,
    judgeTrustworthy: true,
    adjustedPrecisionTrustworthy: true,
    plausibilityJudged: true
  },
  regressionGate: { passed: true },
  caseResults: [
    {
      caseId: 'case-a',
      parseValid: true,
      providerErrored: false,
      unmatchedExpectedIndexes: [],
      falsePositiveFindingIds: [],
      noFindingZoneFalsePositiveIds: [],
      expectedFindings: [{ expectedIndex: 0 }, { expectedIndex: 1 }],
      matchedFindings: [{ expectedIndex: 0 }],
      contextLedger: [],
      agenticStages: []
    }
  ],
  metrics: {
    recall: 0.5,
    precision: 0.5,
    adjustedPrecision: 0.8,
    f1: 0.5,
    falsePositiveCount: 2,
    genuineFalsePositiveCount: 1,
    unlistedRealFindingCount: 1,
    refutationFalsePositiveCount: 3,
    costUsd: 1,
    costUnavailableCount: 0
  },
  metricGroups: [],
  ...overrides
})

const compare = (
  base: Record<string, unknown>,
  head: Record<string, unknown>
): string =>
  renderEvalComparison({
    base: parseEvalComparisonReport(base),
    head: parseEvalComparisonReport(head)
  })

describe('eval comparison report rendering module', () => {
  test('exports the focused comparison report renderer', () => {
    expect(typeof renderEvalComparison).toBe('function')
  })

  // DEFECT 1a. An engine change is exactly what adds a field to the report, and
  // the tool exists to compare across engine changes. Comparing the 2026-08-02
  // baseline against the 2026-08-05 re-baseline died on
  // `caseResults.0.discovery.totals.cappedByLimitCount: expected number,
  // received undefined` and 69 more.
  test('compares a report saved before a report-contract field existed', () => {
    const archived = reportJson({
      caseResults: [
        {
          caseId: 'case-a',
          parseValid: true,
          providerErrored: false,
          unmatchedExpectedIndexes: [],
          falsePositiveFindingIds: [],
          noFindingZoneFalsePositiveIds: [],
          expectedFindings: [{ expectedIndex: 0 }, { expectedIndex: 1 }],
          matchedFindings: [{ expectedIndex: 0 }],
          contextLedger: [],
          agenticStages: [],
          // The archived shape: discovery totals without `cappedByLimitCount`,
          // which the producer contract requires today.
          discovery: {
            totals: { callCount: 1, rawFindingCount: 1 },
            tasks: [{ taskId: 'task-1', callCount: 1, rawFindingCount: 1 }]
          }
        }
      ]
    })

    expect(() => compare(archived, reportJson())).not.toThrow()
  })

  // ABSENCE IS NOT ZERO. A counter a later build added is missing from an older
  // report, and reporting "0" there would claim a measurement nobody made --
  // this repository's documented recurring defect class.
  test('renders a metric absent from one report as unknown rather than zero', () => {
    const base = reportJson()
    const baseMetrics = { ...(base['metrics'] as Record<string, unknown>) }
    delete baseMetrics['refutationFalsePositiveCount']

    const comparison = compare({ ...base, metrics: baseMetrics }, reportJson())

    expect(comparison).toContain(
      '| Refutation false positives | unknown (not recorded) | 3 | unknown (not recorded) |'
    )
    expect(comparison).not.toContain('| Refutation false positives | 0 | 3 | +3 |')
  })

  // DEFECT 1b. The 2026-08-03 bump changes which findings are credited
  // unlisted-real for IDENTICAL review output, so it moves exactly
  // adjustedPrecision, unlistedRealFindingCount and genuineFalsePositiveCount --
  // and nothing else. Refusing the whole comparison made the honest partial
  // comparison impossible; refusing nothing would publish a delta measured
  // across a ruler change.
  test('refuses exactly the metrics a scoring-rule bump touched and compares the rest', () => {
    const comparison = compare(
      reportJson({ metricsVersion: '2026-08-01.discovery-telemetry' }),
      reportJson({
        metricsVersion: '2026-08-03.plausibility-source-window',
        metrics: {
          recall: 0.75,
          precision: 0.6,
          adjustedPrecision: 0.9,
          f1: 0.6,
          falsePositiveCount: 2,
          genuineFalsePositiveCount: 0,
          unlistedRealFindingCount: 2,
          refutationFalsePositiveCount: 3,
          costUsd: 1,
          costUnavailableCount: 0
        }
      })
    )

    expect(comparison).toContain(
      'These metrics are not comparable and their deltas are suppressed: adjustedPrecision, genuineFalsePositiveCount, unlistedRealFindingCount.'
    )
    // The three the bump touched carry no delta...
    expect(comparison).toContain(
      '| Genuine false positives | 1 | 0 | not comparable |'
    )
    expect(comparison).toContain(
      '| Unmatched but plausible | 1 | 2 | not comparable |'
    )
    expect(comparison).toContain(
      '| Precision (raw to adjusted bracket) | 50.0% to 80.0% | 60.0% to 90.0% | lower +10.0pp; upper not comparable |'
    )
    // ...and everything the bump cannot touch is still compared.
    expect(comparison).toContain('| Recall | 50.0% | 75.0% | +25.0pp |')
    expect(comparison).toContain('| False positives | 2 | 2 | 0 |')
    expect(comparison).toContain(
      '| Refutation false positives | 3 | 3 | 0 |'
    )
  })

  // An id the declared history does not know says nothing about what it
  // changed, so nothing may be compared. Guessing narrow is the failure mode
  // this whole mechanism exists to prevent.
  test('refuses every metric when a metrics version is not in the declared history', () => {
    const comparison = compare(
      reportJson({ metricsVersion: 'some-unreleased-build' }),
      reportJson()
    )

    expect(comparison).toContain('Warning: NO metric may be compared')
    expect(comparison).toContain('| Recall | 50.0% | 50.0% | not comparable |')
  })

  // The scenario this exists to catch: two reports that computed metrics under
  // the SAME rules but whose SHARED cases were scored against different
  // expectations -- what happened when an archived run reported 78.8% recall
  // against a key that had since changed underneath it, with nothing in the
  // artifact revealing it. This one stays fatal: no metric on either side means
  // what it says.
  test('refuses when a case both runs scored has different expectations', () => {
    expect(() =>
      compare(
        reportJson({
          provenance: { answerKeyDigestByCase: { 'case-a': 'digest-one' } }
        }),
        reportJson({
          provenance: { answerKeyDigestByCase: { 'case-a': 'digest-two' } }
        })
      )
    ).toThrow(/different expectations/u)
  })

  test('names the diverged cases rather than only reporting that something differs', () => {
    expect(() =>
      compare(
        reportJson({
          provenance: {
            answerKeyDigestByCase: { 'case-a': 'one', 'case-b': 'two' }
          }
        }),
        reportJson({
          provenance: {
            answerKeyDigestByCase: { 'case-a': 'one', 'case-b': 'changed' }
          }
        })
      )
    ).toThrow(/case-b/u)
  })

  // DEFECT 3. The paired finding-level test is the verdict for a recall
  // difference; run-level spread is context.
  test('reports a paired finding-level verdict as the primary recall result', () => {
    const head = reportJson({
      caseResults: [
        {
          caseId: 'case-a',
          parseValid: true,
          providerErrored: false,
          unmatchedExpectedIndexes: [],
          falsePositiveFindingIds: [],
          noFindingZoneFalsePositiveIds: [],
          expectedFindings: [{ expectedIndex: 0 }, { expectedIndex: 1 }],
          matchedFindings: [{ expectedIndex: 0 }, { expectedIndex: 1 }],
          contextLedger: [],
          agenticStages: []
        }
      ]
    })
    const comparison = compare(reportJson(), head)

    expect(comparison).toContain('## Paired Recall Verdict (primary)')
    expect(comparison).toContain('| Paired expectations | 2 |')
    expect(comparison).toContain('| Gained (head only) | 1 |')
    expect(comparison).toContain('| Lost (base only) | 0 |')
    expect(comparison).toContain('| McNemar p (two-sided) |')
    expect(comparison).toContain('Verdict: recall improved')
    // The paired section precedes the run-level deltas, which are context.
    expect(comparison.indexOf('## Paired Recall Verdict (primary)')).toBeLessThan(
      comparison.indexOf('## Metric Deltas')
    )
  })

  // A run that never recorded its per-expectation outcomes cannot be paired,
  // and must say so rather than scoring 0% recall against the other arm.
  test('withholds the paired verdict when a report does not record expectations', () => {
    const base = reportJson({
      caseResults: [
        {
          caseId: 'case-a',
          parseValid: true,
          providerErrored: false,
          unmatchedExpectedIndexes: [],
          falsePositiveFindingIds: [],
          noFindingZoneFalsePositiveIds: [],
          contextLedger: [],
          agenticStages: []
        }
      ]
    })
    const comparison = compare(base, reportJson())

    expect(comparison).toContain(
      'No paired verdict: base case case-a does not record its expected or matched findings.'
    )
    expect(comparison).not.toContain('| Paired expectations |')
  })
})
