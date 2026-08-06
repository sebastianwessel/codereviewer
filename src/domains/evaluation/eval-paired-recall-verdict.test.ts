import { describe, expect, test } from 'vitest'
import { parseEvalComparisonReport } from './eval-comparison-view.js'
import { metricComparability } from './eval-metrics-versions.js'
import { pairedRecallVerdict } from './eval-paired-recall-verdict.js'

const runWith = (
  matched: readonly number[],
  metricsVersion = '2026-08-03.plausibility-source-window'
): ReturnType<typeof parseEvalComparisonReport> =>
  parseEvalComparisonReport({
    metricsVersion,
    provenance: { answerKeyDigest: 'digest' },
    caseResults: [
      {
        caseId: 'case-a',
        expectedFindings: [0, 1, 2, 3].map((expectedIndex) => ({
          expectedIndex
        })),
        matchedFindings: matched.map((expectedIndex) => ({ expectedIndex }))
      }
    ]
  })

const verdictFor = (
  base: ReturnType<typeof parseEvalComparisonReport>,
  head: ReturnType<typeof parseEvalComparisonReport>
): ReturnType<typeof pairedRecallVerdict> =>
  pairedRecallVerdict({
    base,
    head,
    baseLabel: 'base',
    headLabel: 'head',
    comparability: metricComparability(base.metricsVersion, head.metricsVersion)
  })

describe('paired recall verdict', () => {
  test('pairs on the expectation and reports the discordant pairs', () => {
    const verdict = verdictFor(runWith([0]), runWith([0, 1, 2]))

    expect(verdict.status).toBe('available')

    if (verdict.status !== 'available') {
      return
    }

    expect(verdict.comparison.expectationCount).toBe(4)
    expect(verdict.comparison.gained).toEqual(['case-a#1', 'case-a#2'])
    expect(verdict.comparison.lost).toEqual([])
    expect(verdict.comparison.discordantCount).toBe(2)
    expect(verdict.direction).toBe('improved')
  })

  test('reports no difference when both arms matched the same expectations', () => {
    const verdict = verdictFor(runWith([0, 1]), runWith([0, 1]))

    expect(verdict.status === 'available' && verdict.direction).toBe('unchanged')
    expect(verdict.status === 'available' && verdict.significant).toBe(false)
  })

  // The paired test is what decides a recall difference, so it must still run
  // across a scoring-rule change that cannot touch recall. That is the entire
  // point of per-metric comparability.
  test('still runs across a bump that does not touch recall', () => {
    expect(
      verdictFor(
        runWith([0], '2026-08-01.discovery-telemetry'),
        runWith([0, 1], '2026-08-03.plausibility-source-window')
      ).status
    ).toBe('available')
  })

  test('withholds a verdict when the bump does touch recall', () => {
    const verdict = verdictFor(
      runWith([0], 'pre-2026-07-26'),
      runWith([0, 1], '2026-08-03.plausibility-source-window')
    )

    expect(verdict.status).toBe('unavailable')
    expect(verdict.status === 'unavailable' ? verdict.reason : '').toContain(
      'recall is not comparable'
    )
  })

  // A run that never recorded its per-expectation outcomes must not be read as
  // an arm that matched nothing.
  test('withholds a verdict when a run did not record its expectations', () => {
    const verdict = verdictFor(
      parseEvalComparisonReport({
        metricsVersion: '2026-08-03.plausibility-source-window',
        caseResults: [{ caseId: 'case-a' }]
      }),
      runWith([0, 1])
    )

    expect(verdict.status).toBe('unavailable')
    expect(verdict.status === 'unavailable' ? verdict.reason : '').toContain(
      'does not record its expected or matched findings'
    )
  })

  test('withholds a verdict when the runs share no expectation', () => {
    const other = parseEvalComparisonReport({
      metricsVersion: '2026-08-03.plausibility-source-window',
      caseResults: [
        {
          caseId: 'case-b',
          expectedFindings: [{ expectedIndex: 0 }],
          matchedFindings: []
        }
      ]
    })
    const verdict = verdictFor(runWith([0]), other)

    expect(verdict.status).toBe('unavailable')
    expect(verdict.status === 'unavailable' ? verdict.reason : '').toContain(
      'share no expectation'
    )
  })
})
