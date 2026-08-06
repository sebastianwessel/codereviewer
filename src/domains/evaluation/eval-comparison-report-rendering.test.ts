import { describe, expect, test } from 'vitest'
import { renderEvalComparison } from './eval-comparison-report-rendering.js'
import {
  parseEvalComparisonReport,
  type EvalComparisonRun
} from './eval-comparison-view.js'

// Reports are built as raw JSON and read through the comparison view, exactly
// as `eval compare` reads a file from disk. That is the point: the view is what
// makes an archived report readable at all, so a fixture that bypassed it would
// test nothing about the defect these cases cover.
// One expectation in each diff-scope population, because recall is adjudicated
// per population: a fixture with only one population could not show the
// separation at all.
const caseResult = (
  input: { readonly matched: readonly number[] } = { matched: [0] }
): Record<string, unknown> => ({
  caseId: 'case-a',
  parseValid: true,
  providerErrored: false,
  unmatchedExpectedIndexes: [],
  falsePositiveFindingIds: [],
  noFindingZoneFalsePositiveIds: [],
  expectedFindings: [
    { expectedIndex: 0, diffScope: 'in-diff' },
    { expectedIndex: 1, diffScope: 'out-of-diff' }
  ],
  matchedFindings: input.matched.map((expectedIndex) => ({ expectedIndex })),
  contextLedger: [],
  agenticStages: []
})

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
  caseResults: [caseResult()],
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

const arm = (
  reports: readonly Record<string, unknown>[],
  labelPrefix: string
): readonly EvalComparisonRun[] =>
  reports.map((report, index) => ({
    label: `${labelPrefix}-${index + 1}.json`,
    report: parseEvalComparisonReport(report)
  }))

const compare = (
  base: Record<string, unknown>,
  head: Record<string, unknown>
): string => compareArms([base], [head])

const compareArms = (
  base: readonly Record<string, unknown>[],
  head: readonly Record<string, unknown>[]
): string =>
  renderEvalComparison({
    base: arm(base, 'base'),
    head: arm(head, 'head')
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
          expectedFindings: [
            { expectedIndex: 0, diffScope: 'in-diff' },
            { expectedIndex: 1, diffScope: 'out-of-diff' }
          ],
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
    const comparison = compare(
      reportJson({ caseResults: [caseResult({ matched: [] })] }),
      reportJson()
    )

    expect(comparison).toContain('## Paired Recall Verdict (primary)')
    expect(comparison).toContain('### in-diff (headline)')
    expect(comparison).toContain('| Paired expectations | 1 |')
    expect(comparison).toContain('| Gained (head only) | 1 |')
    expect(comparison).toContain('| Lost (base only) | 0 |')
    // One discordant expectation is one coin flip: the exact test reports p = 1,
    // and the verdict says the difference is not readable rather than dressing a
    // single moved expectation up as a result.
    expect(comparison).toContain(
      'Verdict: recall improved but the paired test does NOT clear p < 0.05 (1 gained against 0 lost, p = 1.0000)'
    )
    // The paired section precedes the run-level deltas, which are context.
    expect(comparison.indexOf('## Paired Recall Verdict (primary)')).toBeLessThan(
      comparison.indexOf('## Metric Deltas')
    )
  })

  // THE DILUTION DEFECT, at the rendering boundary. The out-of-diff population
  // is a measured hard zero in every arm; blended it inflates the denominator
  // and makes the headline describe a population that cannot move.
  test('adjudicates each diff-scope population separately and says so', () => {
    const comparison = compare(
      reportJson({ caseResults: [caseResult({ matched: [] })] }),
      reportJson()
    )

    expect(comparison).toContain('### in-diff (headline)')
    expect(comparison).toContain('### out-of-diff')
    expect(comparison).toContain(
      'No verdict: all 1 paired expectations were missed by every run in BOTH arms.'
    )
    // The blended figure is present but demoted, and it is rendered last.
    expect(comparison).toContain('### Blended (every population at once)')
    expect(comparison).toContain('NOT the verdict.')
    expect(comparison.indexOf('### in-diff (headline)')).toBeLessThan(
      comparison.indexOf('### Blended (every population at once)')
    )
  })

  // A verdict a reader cannot check is a verdict they have to trust.
  test('names the exact test and its assumptions in the rendered output', () => {
    const comparison = compare(reportJson(), reportJson())

    expect(comparison).toContain('Test: exact-two-sided-sign-test')
    expect(comparison).toContain('Binomial(n, 0.5)')
    expect(comparison).toContain(
      'The unit is ONE expectation (`caseId#expectedIndex`), counted once per arm'
    )
  })

  // Several runs per arm is the design this project's own decision rule
  // requires, and one report against one report throws away most of the
  // evidence that was paid for.
  test('adjudicates a multi-run arm as one observation per expectation', () => {
    const missed = { caseResults: [caseResult({ matched: [] })] }
    const comparison = compareArms(
      [reportJson(missed), reportJson(missed), reportJson(missed)],
      [reportJson(), reportJson(), reportJson()]
    )

    expect(comparison).toContain('Base arm: 3 runs — base-1.json, base-2.json, base-3.json')
    expect(comparison).toContain('Head arm: 3 runs — head-1.json, head-2.json, head-3.json')
    // Three run pairs each moved the same expectation. That is ONE gained
    // expectation, not three.
    expect(comparison).toContain('| Gained (head only) | 1 |')
    expect(comparison).toContain('| Discordant pairs | 1 |')
  })

  // Run-level sections read one report per side. Averaging several would publish
  // numbers no run produced; reading one would present an arbitrary pick as a
  // result.
  test('omits the per-report context sections for multi-run arms and says why', () => {
    const comparison = compareArms(
      [reportJson(), reportJson()],
      [reportJson(), reportJson()]
    )

    expect(comparison).toContain('## Run-Level Context')
    expect(comparison).toContain(
      'Omitted: the base arm holds 2 run(s) and the head arm 2.'
    )
    expect(comparison).not.toContain('## Metric Deltas')
    expect(comparison).toContain('## Paired Recall Verdict (primary)')
  })

  test('refuses arms of different sizes rather than comparing what lines up', () => {
    expect(() =>
      compareArms([reportJson(), reportJson()], [reportJson()])
    ).toThrow(/arms of different sizes/u)
  })

  test('refuses an arm whose runs mix scoring rules', () => {
    expect(() =>
      compareArms(
        [reportJson(), reportJson({ metricsVersion: 'pre-2026-07-26' })],
        [reportJson(), reportJson()]
      )
    ).toThrow(/mixes scoring rules/u)
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
      'No paired verdict: base report base-1.json case case-a does not record its expected or matched findings.'
    )
    expect(comparison).not.toContain('| Paired expectations |')
  })
})
