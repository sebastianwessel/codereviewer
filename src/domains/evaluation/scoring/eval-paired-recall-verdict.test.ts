import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  parseEvalComparisonReport,
  type EvalComparisonRun
} from '../report/eval-comparison-view.js'
import { metricComparability } from '../report/versions/eval-metrics-versions.js'
import {
  pairedRecallVerdict,
  type PairedPopulationVerdict,
  type PairedRecallVerdict
} from './eval-paired-recall-verdict.js'

type Expectation = {
  readonly expectedIndex: number
  readonly diffScope?: string
}

const METRICS_VERSION = '2026-08-03.plausibility-source-window'

const runWith = (
  input: {
    readonly expected: readonly Expectation[]
    readonly matched: readonly number[]
    readonly metricsVersion?: string
    readonly caseId?: string
    readonly label?: string
  }
): EvalComparisonRun => ({
  label: input.label ?? 'report.json',
  report: parseEvalComparisonReport({
    metricsVersion: input.metricsVersion ?? METRICS_VERSION,
    provenance: { answerKeyDigest: 'digest' },
    caseResults: [
      {
        caseId: input.caseId ?? 'case-a',
        expectedFindings: input.expected,
        matchedFindings: input.matched.map((expectedIndex) => ({
          expectedIndex
        }))
      }
    ]
  })
})

// Four expectations, two in each population, so a defect that blends them is
// visible as a diluted denominator rather than only as different prose.
const splitExpectations: readonly Expectation[] = [
  { expectedIndex: 0, diffScope: 'in-diff' },
  { expectedIndex: 1, diffScope: 'in-diff' },
  { expectedIndex: 2, diffScope: 'out-of-diff' },
  { expectedIndex: 3, diffScope: 'out-of-diff' }
]

const verdictFor = (
  base: readonly EvalComparisonRun[],
  head: readonly EvalComparisonRun[]
): PairedRecallVerdict =>
  pairedRecallVerdict({
    base,
    head,
    comparability: metricComparability(
      base[0]?.report.metricsVersion ?? METRICS_VERSION,
      head[0]?.report.metricsVersion ?? METRICS_VERSION
    )
  })

const populationNamed = (
  verdict: PairedRecallVerdict,
  id: string
): PairedPopulationVerdict => {
  if (verdict.status !== 'available') {
    throw new Error(`verdict unavailable: ${verdict.reason}`)
  }

  const population = verdict.populations.find((entry) => entry.id === id)

  if (population === undefined) {
    throw new Error(
      `no population ${id}; got ${verdict.populations.map((entry) => entry.id).join(', ')}`
    )
  }

  return population
}

describe('paired recall verdict', () => {
  test('pairs on the expectation and reports the discordant pairs', () => {
    const expected: readonly Expectation[] = [0, 1, 2, 3].map(
      (expectedIndex) => ({ expectedIndex, diffScope: 'in-diff' })
    )
    const verdict = verdictFor(
      [runWith({ expected, matched: [0] })],
      [runWith({ expected, matched: [0, 1, 2] })]
    )
    const inDiff = populationNamed(verdict, 'in-diff')

    expect(inDiff.comparison.expectationCount).toBe(4)
    expect(inDiff.comparison.gained).toEqual(['case-a#1', 'case-a#2'])
    expect(inDiff.comparison.lost).toEqual([])
    expect(inDiff.comparison.discordantCount).toBe(2)
    expect(inDiff.direction).toBe('improved')
    expect(inDiff.headline).toBe(true)
  })

  test('reports no difference when both arms matched the same expectations', () => {
    const verdict = verdictFor(
      [runWith({ expected: splitExpectations, matched: [0] })],
      [runWith({ expected: splitExpectations, matched: [0] })]
    )
    const inDiff = populationNamed(verdict, 'in-diff')

    expect(inDiff.direction).toBe('unchanged')
    expect(inDiff.significant).toBe(false)
    expect(inDiff.finding).toBe('no-discordant-pairs')
  })

  // THE DILUTION DEFECT. Out-of-diff expectations are a measured hard zero in
  // every arm of every run because the reviewer is diff-scoped. They are ties in
  // every pairing, so they carry no information -- but blended they inflate the
  // denominator, make the reported recall the figure spec 06 already calls
  // uninterpretable, and make the verdict's prose describe a population that
  // cannot move.
  test('reports a hard-zero scope as such instead of diluting the other scope', () => {
    const verdict = verdictFor(
      [runWith({ expected: splitExpectations, matched: [] })],
      [runWith({ expected: splitExpectations, matched: [0, 1] })]
    )
    const inDiff = populationNamed(verdict, 'in-diff')
    const outOfDiff = populationNamed(verdict, 'out-of-diff')

    // The population that moved is adjudicated over ITS OWN two expectations.
    expect(inDiff.comparison.expectationCount).toBe(2)
    expect(inDiff.comparison.gained).toHaveLength(2)
    expect(inDiff.comparison.headRecall).toBe(1)
    expect(inDiff.finding).toBe('tested')

    // The population that cannot move says so, and reports no test rather than a
    // p-value over nothing.
    expect(outOfDiff.comparison.expectationCount).toBe(2)
    expect(outOfDiff.comparison.discordantCount).toBe(0)
    expect(outOfDiff.comparison.neverFound).toBe(2)
    expect(outOfDiff.finding).toBe('hard-zero-in-both-arms')
    expect(outOfDiff.comparison.pValue).toBeUndefined()

    // The blended figure is still reported, and it is the diluted one: half the
    // head recall of the population that actually moved.
    if (verdict.status !== 'available') {
      throw new Error('expected an available verdict')
    }

    expect(verdict.blended.comparison.expectationCount).toBe(4)
    expect(verdict.blended.comparison.headRecall).toBe(0.5)
    expect(verdict.blended.headline).toBe(false)
  })

  // An expectation is ONE observation per arm however many runs the arm holds.
  // Summing per-pair discordant counts across three run pairs would report three
  // times the evidence that exists.
  test('pools a multi-run arm into one observation per expectation', () => {
    const expected: readonly Expectation[] = [
      { expectedIndex: 0, diffScope: 'in-diff' },
      { expectedIndex: 1, diffScope: 'in-diff' }
    ]
    const verdict = verdictFor(
      [
        runWith({ expected, matched: [0], label: 'base-1' }),
        runWith({ expected, matched: [0], label: 'base-2' }),
        runWith({ expected, matched: [0], label: 'base-3' })
      ],
      [
        runWith({ expected, matched: [0, 1], label: 'head-1' }),
        runWith({ expected, matched: [0, 1], label: 'head-2' }),
        runWith({ expected, matched: [0, 1], label: 'head-3' })
      ]
    )
    const inDiff = populationNamed(verdict, 'in-diff')

    // Three run pairs each moved `case-a#1`. That is ONE gained expectation, not
    // three, and the discordant count is 1, not 3.
    expect(inDiff.comparison.gained).toEqual(['case-a#1'])
    expect(inDiff.comparison.discordantCount).toBe(1)
    expect(inDiff.comparison.expectationCount).toBe(2)

    if (verdict.status !== 'available') {
      throw new Error('expected an available verdict')
    }

    expect(verdict.base.runCount).toBe(3)
    expect(verdict.head.runCount).toBe(3)
  })

  // An arm's value for an expectation is the FRACTION of its runs that found it,
  // so a flaky expectation is neither a hit nor a miss.
  test('reads a partially found expectation as a fraction of the arm’s runs', () => {
    const expected: readonly Expectation[] = [
      { expectedIndex: 0, diffScope: 'in-diff' }
    ]
    const verdict = verdictFor(
      [
        runWith({ expected, matched: [], label: 'base-1' }),
        runWith({ expected, matched: [], label: 'base-2' })
      ],
      [
        runWith({ expected, matched: [0], label: 'head-1' }),
        runWith({ expected, matched: [], label: 'head-2' })
      ]
    )
    const inDiff = populationNamed(verdict, 'in-diff')

    expect(inDiff.comparison.headRecall).toBe(0.5)
    expect(inDiff.comparison.gained).toEqual(['case-a#0'])
    // Not "found by every run in both arms" and not "missed by every run in both
    // arms": a half-hit is neither.
    expect(inDiff.comparison.alwaysFound).toBe(0)
    expect(inDiff.comparison.neverFound).toBe(0)
  })

  test('refuses arms of different sizes rather than comparing what lines up', () => {
    const expected: readonly Expectation[] = [
      { expectedIndex: 0, diffScope: 'in-diff' }
    ]

    expect(() =>
      verdictFor(
        [
          runWith({ expected, matched: [0], label: 'base-1' }),
          runWith({ expected, matched: [0], label: 'base-2' })
        ],
        [runWith({ expected, matched: [0], label: 'head-1' })]
      )
    ).toThrow(/arms of different sizes/u)
  })

  test('refuses to pool an arm whose runs were scored against different answer keys', () => {
    const expected: readonly Expectation[] = [
      { expectedIndex: 0, diffScope: 'in-diff' }
    ]
    const otherKey = runWith({ expected, matched: [0], label: 'base-2' })
    const rekeyed: EvalComparisonRun = {
      label: otherKey.label,
      report: parseEvalComparisonReport({
        metricsVersion: METRICS_VERSION,
        provenance: { answerKeyDigest: 'a-different-key' },
        caseResults: [
          {
            caseId: 'case-a',
            expectedFindings: expected,
            matchedFindings: [{ expectedIndex: 0 }]
          }
        ]
      })
    }

    expect(() =>
      verdictFor(
        [runWith({ expected, matched: [0], label: 'base-1' }), rekeyed],
        [
          runWith({ expected, matched: [0], label: 'head-1' }),
          runWith({ expected, matched: [0], label: 'head-2' })
        ]
      )
    ).toThrow(/different answer keys/u)
  })

  // Absence is not a miss. A run that never scored an expectation the rest of
  // its arm scored has no outcome for it, and dividing its hits by the arm's run
  // count would silently read that absence as a failure to find it.
  test('refuses an arm whose runs did not all score the same expectations', () => {
    expect(() =>
      verdictFor(
        [
          runWith({
            expected: [
              { expectedIndex: 0, diffScope: 'in-diff' },
              { expectedIndex: 1, diffScope: 'in-diff' }
            ],
            matched: [0],
            label: 'base-1'
          }),
          runWith({
            expected: [{ expectedIndex: 0, diffScope: 'in-diff' }],
            matched: [0],
            label: 'base-2'
          })
        ],
        [
          runWith({
            expected: [
              { expectedIndex: 0, diffScope: 'in-diff' },
              { expectedIndex: 1, diffScope: 'in-diff' }
            ],
            matched: [0],
            label: 'head-1'
          }),
          runWith({
            expected: [
              { expectedIndex: 0, diffScope: 'in-diff' },
              { expectedIndex: 1, diffScope: 'in-diff' }
            ],
            matched: [0],
            label: 'head-2'
          })
        ]
      )
    ).toThrow(/did not all score the same expectations/u)
  })

  // A report written before the diff-scope field existed cannot answer which
  // population its expectations belong to. Folding them into in-diff would
  // attribute them to a population nobody measured them in.
  test('adjudicates expectations with no recorded diff scope on their own', () => {
    const expected: readonly Expectation[] = [
      { expectedIndex: 0, diffScope: 'in-diff' },
      { expectedIndex: 1 }
    ]
    const verdict = verdictFor(
      [runWith({ expected, matched: [] })],
      [runWith({ expected, matched: [0, 1] })]
    )

    expect(populationNamed(verdict, 'in-diff').comparison.expectationCount).toBe(1)
    expect(
      populationNamed(verdict, 'scope-not-recorded').comparison.expectationCount
    ).toBe(1)
  })

  test('adjudicates expectations the two arms scoped differently on their own', () => {
    const verdict = verdictFor(
      [
        runWith({
          expected: [{ expectedIndex: 0, diffScope: 'in-diff' }],
          matched: []
        })
      ],
      [
        runWith({
          expected: [{ expectedIndex: 0, diffScope: 'out-of-diff' }],
          matched: [0]
        })
      ]
    )

    expect(
      populationNamed(verdict, 'scope-divergent').comparison.expectationCount
    ).toBe(1)
    expect(populationNamed(verdict, 'in-diff').finding).toBe('no-expectations')
    expect(populationNamed(verdict, 'out-of-diff').finding).toBe(
      'no-expectations'
    )
  })

  // Both named populations are always reported. Omitting an empty one lets a
  // reader assume it was covered.
  test('reports a population with no expectations rather than omitting it', () => {
    const expected: readonly Expectation[] = [
      { expectedIndex: 0, diffScope: 'in-diff' }
    ]
    const verdict = verdictFor(
      [runWith({ expected, matched: [] })],
      [runWith({ expected, matched: [0] })]
    )
    const outOfDiff = populationNamed(verdict, 'out-of-diff')

    expect(outOfDiff.comparison.expectationCount).toBe(0)
    expect(outOfDiff.finding).toBe('no-expectations')
    expect(outOfDiff.comparison.pValue).toBeUndefined()
  })

  // The paired test is what decides a recall difference, so it must still run
  // across a scoring-rule change that cannot touch recall. That is the entire
  // point of per-metric comparability.
  test('still runs across a bump that does not touch recall', () => {
    const expected: readonly Expectation[] = [
      { expectedIndex: 0, diffScope: 'in-diff' },
      { expectedIndex: 1, diffScope: 'in-diff' }
    ]

    expect(
      verdictFor(
        [
          runWith({
            expected,
            matched: [0],
            metricsVersion: '2026-08-01.discovery-telemetry'
          })
        ],
        [runWith({ expected, matched: [0, 1] })]
      ).status
    ).toBe('available')
  })

  test('withholds a verdict when the bump does touch recall', () => {
    const expected: readonly Expectation[] = [
      { expectedIndex: 0, diffScope: 'in-diff' }
    ]
    const verdict = verdictFor(
      [runWith({ expected, matched: [], metricsVersion: 'pre-2026-07-26' })],
      [runWith({ expected, matched: [0] })]
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
      [
        {
          label: 'archived.json',
          report: parseEvalComparisonReport({
            metricsVersion: METRICS_VERSION,
            caseResults: [{ caseId: 'case-a' }]
          })
        }
      ],
      [
        runWith({
          expected: [{ expectedIndex: 0, diffScope: 'in-diff' }],
          matched: [0]
        })
      ]
    )

    expect(verdict.status).toBe('unavailable')
    expect(verdict.status === 'unavailable' ? verdict.reason : '').toContain(
      'base report archived.json case case-a does not record its expected or matched findings'
    )
  })

  test('withholds a verdict when the arms share no expectation', () => {
    const verdict = verdictFor(
      [
        runWith({
          expected: [{ expectedIndex: 0, diffScope: 'in-diff' }],
          matched: [0]
        })
      ],
      [
        runWith({
          caseId: 'case-b',
          expected: [{ expectedIndex: 0, diffScope: 'in-diff' }],
          matched: []
        })
      ]
    )

    expect(verdict.status).toBe('unavailable')
    expect(verdict.status === 'unavailable' ? verdict.reason : '').toContain(
      'share no expectation'
    )
  })
})

// THE DEFECT, ON THE DATA THAT EXPOSED IT. Reduced from the six archived reports
// of the 2026-08-02 (`6781a26`) and 2026-08-05 (`db78900`) sweeps under
// `.codereviewer/eval/`, keeping only what the paired verdict reads: each case's
// expectation indexes with their recorded diff scope, and which of them the run
// matched. The reduction changes no outcome and no scope label.
describe('paired recall verdict on the archived sweeps', () => {
  const loadArms = async (): Promise<{
    readonly base: readonly EvalComparisonRun[]
    readonly head: readonly EvalComparisonRun[]
  }> => {
    const raw = JSON.parse(
      await readFile(
        fileURLToPath(
          new URL(
            './__fixtures__/archived-sweeps-2026-08-02-vs-2026-08-05.json',
            import.meta.url
          )
        ),
        'utf8'
      )
    ) as Record<'base' | 'head', readonly { readonly label: string }[]>

    const arm = (
      key: 'base' | 'head'
    ): readonly EvalComparisonRun[] =>
      raw[key].map((run) => ({
        label: run.label,
        report: parseEvalComparisonReport(run)
      }))

    return { base: arm('base'), head: arm('head') }
  }

  test('reproduces 12 gained, 3 lost and p = 0.0352 on the in-diff population', async () => {
    const { base, head } = await loadArms()
    const verdict = verdictFor(base, head)
    const inDiff = populationNamed(verdict, 'in-diff')

    expect(inDiff.comparison.expectationCount).toBe(60)
    expect(inDiff.comparison.gained).toHaveLength(12)
    expect(inDiff.comparison.lost).toHaveLength(3)
    expect(inDiff.comparison.concordant).toBe(45)
    expect(inDiff.comparison.pValue?.toFixed(4)).toBe('0.0352')
    expect(inDiff.comparison.pValueMethod).toBe('exact-two-sided-sign-test')
    expect(inDiff.significant).toBe(true)
    expect(inDiff.direction).toBe('improved')
  })

  test('reports the out-of-diff population as a hard zero in both arms', async () => {
    const { base, head } = await loadArms()
    const outOfDiff = populationNamed(verdictFor(base, head), 'out-of-diff')

    expect(outOfDiff.comparison.expectationCount).toBe(27)
    expect(outOfDiff.comparison.neverFound).toBe(27)
    expect(outOfDiff.comparison.discordantCount).toBe(0)
    expect(outOfDiff.finding).toBe('hard-zero-in-both-arms')
    expect(outOfDiff.comparison.pValue).toBeUndefined()
  })

  // What the blended framing did: the same data, adjudicated over all 87
  // expectations, does not clear the threshold the in-diff population clears.
  test('shows the blended figure is the diluted one and is not the headline', async () => {
    const { base, head } = await loadArms()
    const verdict = verdictFor(base, head)

    if (verdict.status !== 'available') {
      throw new Error('expected an available verdict')
    }

    expect(verdict.blended.comparison.expectationCount).toBe(87)
    expect(verdict.blended.headline).toBe(false)
    expect(
      verdict.populations.filter((population) => population.headline)
    ).toHaveLength(1)
    expect(
      verdict.populations.find((population) => population.headline)?.id
    ).toBe('in-diff')
  })
})
