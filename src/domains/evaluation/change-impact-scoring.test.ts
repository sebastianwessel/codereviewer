import { describe, expect, test } from 'vitest'
import {
  corpusCaseFixture,
  impactReportFixture
} from './change-impact-fixture.js'
import {
  scoreChangeImpactCases,
  type ChangeImpactCaseInput
} from './change-impact-scoring.js'

const scoredCase = (input: {
  readonly id: string
  readonly split?: 'dev' | 'held-out'
  readonly expected: readonly {
    readonly path: string
    readonly reachability:
      | 'caller-of-changed-symbol'
      | 'callee-of-changed-code'
      | 'attribute-owner'
      | 'whole-repo-search'
  }[]
  readonly referenceFiles?: readonly string[]
  readonly findingFiles?: readonly string[]
  readonly adjudicationStatus?: 'disabled' | 'no-model' | 'completed'
}): ChangeImpactCaseInput => ({
  corpusCase: corpusCaseFixture({
    id: input.id,
    ...(input.split === undefined ? {} : { split: input.split }),
    expected: input.expected
  }),
  outcome: {
    status: 'scored',
    report: impactReportFixture({
      ...(input.referenceFiles === undefined
        ? {}
        : { referenceFiles: input.referenceFiles }),
      ...(input.findingFiles === undefined
        ? {}
        : { findingFiles: input.findingFiles }),
      ...(input.adjudicationStatus === undefined
        ? {}
        : { adjudicationStatus: input.adjudicationStatus })
    })
  }
})

describe('change-impact scoring: the deterministic baseline arm', () => {
  // Spec 22's removal criterion is stated against the reference list. Without a
  // separately reported arm 1 the measurement cannot answer the only question
  // that decides this capability's fate.
  test('scores the reference list separately from the adjudicated list', () => {
    const score = scoreChangeImpactCases([
      scoredCase({
        id: 'case-a',
        expected: [
          { path: 'src/dependent.py', reachability: 'caller-of-changed-symbol' }
        ],
        referenceFiles: ['src/dependent.py', 'src/unrelated.py'],
        // Adjudication dropped the proven dependent and kept the other file.
        findingFiles: ['src/unrelated.py']
      })
    ])

    expect(score.reference.directlyReachable.measured).toEqual({
      status: 'measured',
      matched: 1,
      total: 1,
      rate: 1
    })
    expect(score.adjudicated.directlyReachable.measured).toEqual({
      status: 'measured',
      matched: 0,
      total: 1,
      rate: 0
    })
  })

  test('reports what adjudication removed, and that removing a proven dependent was wrong', () => {
    const score = scoreChangeImpactCases([
      scoredCase({
        id: 'case-a',
        expected: [
          { path: 'src/dependent.py', reachability: 'caller-of-changed-symbol' }
        ],
        referenceFiles: [
          'src/dependent.py',
          'src/noise-one.py',
          'src/noise-two.py'
        ],
        findingFiles: ['src/noise-one.py']
      })
    ])

    expect(score.adjudicationDelta.status).toBe('measured')

    if (score.adjudicationDelta.status !== 'measured') {
      throw new Error('expected a measured delta')
    }

    // The model answered on this case, so its removals land in the tier that made
    // them.
    expect(score.adjudicationDelta.modelInvolved).toMatchObject({
      caseCount: 1,
      referenceFileCount: 3,
      adjudicatedFileCount: 1,
      removedFileCount: 2,
      removedProvenDependentCount: 1,
      // The other removal might have been noise or might have been a dependent
      // nobody listed. It is never credited as correct.
      removedUnknownCorrectnessCount: 1,
      retainedProvenDependentCount: 0,
      addedNotInReferenceListCount: 0
    })
    expect(score.adjudicationDelta.deterministicTierOnly.caseCount).toBe(0)
    expect(score.adjudicationDelta.modelInvolved).not.toHaveProperty(
      'removedCorrectCount'
    )
    // No pooled total exists to quote as "what adjudication removed".
    expect(score.adjudicationDelta).not.toHaveProperty('removedFileCount')
  })

  // The decision rule reads recall against the dependents the reference list
  // itself contains, because adjudication cannot report a file discovery never
  // found.
  test('scores the decision rule against the reference list, not the whole answer key', () => {
    const score = scoreChangeImpactCases([
      scoredCase({
        id: 'found-and-kept',
        expected: [{ path: 'src/a.py', reachability: 'caller-of-changed-symbol' }],
        referenceFiles: ['src/a.py'],
        findingFiles: ['src/a.py']
      }),
      scoredCase({
        id: 'never-discovered',
        expected: [{ path: 'src/b.py', reachability: 'whole-repo-search' }],
        referenceFiles: [],
        findingFiles: []
      })
    ])

    expect(score.adjudicatedRecallWithinReferenceList.measured).toEqual({
      status: 'measured',
      matched: 1,
      total: 1,
      rate: 1
    })
  })
})

// THE VOIDED RUN, REBUILT. Spec 22 §"First Adjudication Measurement — DIAGNOSED
// AND VOID": six exhaustively adjudicated cases put 15 reference files in and got
// 0 out, dropping 3 dependents upstream had to repair — and the model was called
// ZERO times in all six, because an empty contract delta routes every dependent
// down the deterministic `no-impact` branch. The scorer reported that as what
// ADJUDICATION removed, and it was one step from deleting the capability.
describe('change-impact scoring: a judge that never ran cannot read as a judge that rejected everything', () => {
  const sweptCase = (input: {
    readonly id: string
    readonly expected: readonly string[]
    readonly referenceFiles: readonly string[]
  }): ChangeImpactCaseInput => ({
    corpusCase: corpusCaseFixture({
      id: input.id,
      expected: input.expected.map((path) => ({
        path,
        reachability: 'caller-of-changed-symbol' as const
      }))
    }),
    outcome: {
      status: 'scored',
      report: impactReportFixture({
        referenceFiles: input.referenceFiles,
        // Nothing reported, nothing left unadjudicated: exhaustive, and empty.
        findingFiles: [],
        // The whole point: every pair was settled in code, and no call was spent.
        deterministicNoImpactPairCount: input.referenceFiles.length,
        adjudicationCallCount: 0
      })
    }
  })

  const votedRunShape = [
    sweptCase({
      id: 'swept-a',
      expected: ['src/dependent-a.py'],
      referenceFiles: ['src/dependent-a.py', 'src/noise-a.py']
    }),
    sweptCase({
      id: 'swept-b',
      expected: ['src/dependent-b.py'],
      referenceFiles: ['src/dependent-b.py', 'src/noise-b.py', 'src/noise-c.py']
    })
  ]

  test('attributes every removal of a zero-call case to the deterministic tier', () => {
    const score = scoreChangeImpactCases(votedRunShape)

    expect(score.adjudicationDelta.status).toBe('measured')

    if (score.adjudicationDelta.status !== 'measured') {
      throw new Error('expected a measured delta')
    }

    // Every removal is the deterministic tier's, and it says so.
    expect(score.adjudicationDelta.deterministicTierOnly).toMatchObject({
      caseCount: 2,
      modelCallCount: 0,
      referenceFileCount: 5,
      adjudicatedFileCount: 0,
      removedFileCount: 5,
      removedProvenDependentCount: 2,
      removedUnknownCorrectnessCount: 3
    })
    expect(score.adjudicationDelta.deterministicTierOnly.caseIds).toEqual([
      'swept-a',
      'swept-b'
    ])
    // And the model tier's group is EMPTY rather than a set of zeros standing in
    // for rejections it never made.
    expect(score.adjudicationDelta.modelInvolved).toMatchObject({
      caseCount: 0,
      modelCallCount: 0,
      removedFileCount: 0,
      removedProvenDependentCount: 0
    })
  })

  test('coverage says the model was never called, per case and in aggregate', () => {
    const score = scoreChangeImpactCases(votedRunShape)

    expect(score.coverage.adjudicationMeasuredCaseCount).toBe(2)
    expect(score.coverage.adjudicationExhaustiveCaseCount).toBe(2)
    expect(score.coverage.adjudicationCallCount).toBe(0)
    expect(score.coverage.noAdjudicationCallCaseCount).toBe(2)
    expect(score.coverage.modelVerdictCounts).toEqual({
      relies: 0,
      'does-not-rely': 0,
      undetermined: 0
    })
    expect(score.coverage.deterministicNoImpactPairCount).toBe(5)

    for (const caseScore of score.caseScores) {
      expect(caseScore.status).toBe('scored')

      if (caseScore.status !== 'scored') {
        continue
      }

      expect(caseScore.adjudicationCallCount).toBe(0)
    }
  })

  // A case that spent calls and one that spent none must never be summed.
  test('keeps a swept case and a judged case in separate groups', () => {
    const score = scoreChangeImpactCases([
      ...votedRunShape,
      scoredCase({
        id: 'judged',
        expected: [
          { path: 'src/dependent-c.py', reachability: 'caller-of-changed-symbol' }
        ],
        referenceFiles: ['src/dependent-c.py', 'src/noise-d.py'],
        findingFiles: ['src/dependent-c.py']
      })
    ])

    if (score.adjudicationDelta.status !== 'measured') {
      throw new Error('expected a measured delta')
    }

    expect(score.adjudicationDelta.deterministicTierOnly.caseCount).toBe(2)
    expect(score.adjudicationDelta.modelInvolved.caseCount).toBe(1)
    expect(
      score.adjudicationDelta.modelInvolved.modelCallCount
    ).toBeGreaterThan(0)
    // The proven dependent the judge kept belongs to the judge's group only.
    expect(
      score.adjudicationDelta.modelInvolved.retainedProvenDependentCount
    ).toBe(1)
    expect(
      score.adjudicationDelta.deterministicTierOnly.retainedProvenDependentCount
    ).toBe(0)
    expect(score.coverage.noAdjudicationCallCaseCount).toBe(2)
  })
})

describe('change-impact scoring: nothing is pooled', () => {
  test('splits recall by reachability class', () => {
    const score = scoreChangeImpactCases([
      scoredCase({
        id: 'direct',
        expected: [{ path: 'src/a.py', reachability: 'caller-of-changed-symbol' }],
        referenceFiles: ['src/a.py'],
        findingFiles: ['src/a.py']
      }),
      scoredCase({
        id: 'indirect',
        expected: [{ path: 'src/b.py', reachability: 'whole-repo-search' }],
        referenceFiles: [],
        findingFiles: []
      })
    ])

    expect(
      score.reference.byReachability['caller-of-changed-symbol'].measured
    ).toEqual({ status: 'measured', matched: 1, total: 1, rate: 1 })
    expect(score.reference.byReachability['whole-repo-search'].measured).toEqual(
      { status: 'measured', matched: 0, total: 1, rate: 0 }
    )
    expect(score.reference.directlyReachable.measured).toEqual({
      status: 'measured',
      matched: 1,
      total: 1,
      rate: 1
    })
    expect(score.reference.wholeRepoSearch.measured).toEqual({
      status: 'measured',
      matched: 0,
      total: 1,
      rate: 0
    })
  })

  test('splits recall by contamination split', () => {
    const score = scoreChangeImpactCases([
      scoredCase({
        id: 'dev-case',
        split: 'dev',
        expected: [{ path: 'src/a.py', reachability: 'caller-of-changed-symbol' }],
        referenceFiles: ['src/a.py']
      }),
      scoredCase({
        id: 'held-out-case',
        split: 'held-out',
        expected: [{ path: 'src/b.py', reachability: 'caller-of-changed-symbol' }],
        referenceFiles: []
      })
    ])

    expect(score.reference.bySplit.dev.measured).toEqual({
      status: 'measured',
      matched: 1,
      total: 1,
      rate: 1
    })
    expect(score.reference.bySplit['held-out'].measured).toEqual({
      status: 'measured',
      matched: 0,
      total: 1,
      rate: 0
    })
  })

  // A blended recall figure is the thing people quote. There must not be one.
  test('publishes no pooled recall figure anyone could quote', () => {
    const score = scoreChangeImpactCases([
      scoredCase({
        id: 'case-a',
        expected: [{ path: 'src/a.py', reachability: 'caller-of-changed-symbol' }],
        referenceFiles: ['src/a.py']
      })
    ])

    expect(score).not.toHaveProperty('recall')
    expect(score.reference).not.toHaveProperty('recall')
    expect(score.adjudicated).not.toHaveProperty('recall')
  })

  test('a dimension with no expectations is not measured rather than zero', () => {
    const score = scoreChangeImpactCases([
      scoredCase({
        id: 'dev-only',
        split: 'dev',
        expected: [{ path: 'src/a.py', reachability: 'caller-of-changed-symbol' }],
        referenceFiles: ['src/a.py']
      })
    ])

    expect(score.reference.bySplit['held-out'].measured.status).toBe(
      'not-measured'
    )
    expect(
      score.reference.byReachability['attribute-owner'].measured.status
    ).toBe('not-measured')
  })
})

describe('change-impact scoring: precision is a bracket, never a point', () => {
  // The corpus lists the dependents upstream had to repair, not every file each
  // change affected. An unmatched prediction is not thereby wrong.
  test('a prediction absent from the answer key does not become a measured false positive', () => {
    const score = scoreChangeImpactCases([
      scoredCase({
        id: 'case-a',
        expected: [{ path: 'src/a.py', reachability: 'caller-of-changed-symbol' }],
        referenceFiles: ['src/a.py', 'src/unlisted.py'],
        findingFiles: ['src/a.py', 'src/unlisted.py']
      })
    ])

    // The lower bound charges it as wrong, which is what a lower bound is for.
    expect(score.reference.precision.lower).toEqual({
      status: 'known',
      value: 0.5
    })
    // The upper bound is never claimed, so nobody can read 50% as "the" precision.
    expect(score.reference.precision.upper).toEqual({ status: 'not-measured' })
    expect(score.reference.precision.upperTrustworthy).toBe(false)
    expect(score.adjudicated.precision.upper).toEqual({ status: 'not-measured' })
  })

  test('an empty prediction set has an unknown lower bound rather than zero precision', () => {
    const score = scoreChangeImpactCases([
      scoredCase({
        id: 'case-a',
        expected: [{ path: 'src/a.py', reachability: 'caller-of-changed-symbol' }],
        referenceFiles: []
      })
    ])

    expect(score.reference.precision.lower).toEqual({ status: 'unknown' })
  })
})

describe('change-impact scoring: absence is never zero', () => {
  test('a case that did not hydrate is unmeasured, not a miss', () => {
    const score = scoreChangeImpactCases([
      {
        corpusCase: corpusCaseFixture({
          id: 'not-hydrated',
          expected: [
            { path: 'src/a.py', reachability: 'caller-of-changed-symbol' }
          ]
        }),
        outcome: {
          status: 'unmeasured',
          reason: 'not-hydrated',
          detail: 'no hydrated checkout'
        }
      }
    ])

    expect(score.coverage.scoredCaseCount).toBe(0)
    expect(score.coverage.unmeasuredByReason['not-hydrated']).toBe(1)
    expect(score.reference.directlyReachable.measured.status).toBe(
      'not-measured'
    )
    expect(score.reference.directlyReachable.unmeasuredExpectedCount).toBe(1)
    expect(score.coverage.scoredExpectedCount).toBe(0)
    expect(score.coverage.totalExpectedCount).toBe(1)
  })

  test('a stale checkout is unmeasured rather than scored against a changed answer key', () => {
    const score = scoreChangeImpactCases([
      {
        corpusCase: corpusCaseFixture({
          id: 'stale',
          expected: [
            { path: 'src/a.py', reachability: 'caller-of-changed-symbol' }
          ]
        }),
        outcome: {
          status: 'unmeasured',
          reason: 'stale-checkout',
          detail: 'the hydrated answer key differs from the manifest'
        }
      }
    ])

    expect(score.coverage.unmeasuredByReason['stale-checkout']).toBe(1)
    expect(score.reference.directlyReachable.measured.status).toBe(
      'not-measured'
    )
  })

  test('a disabled engine run is unmeasured rather than 0% recall', () => {
    const score = scoreChangeImpactCases([
      {
        corpusCase: corpusCaseFixture({
          id: 'disabled',
          expected: [
            { path: 'src/a.py', reachability: 'caller-of-changed-symbol' }
          ]
        }),
        outcome: {
          status: 'scored',
          report: impactReportFixture({
            status: 'disabled',
            adjudicationStatus: 'disabled'
          })
        }
      }
    ])

    expect(score.coverage.scoredCaseCount).toBe(0)
    expect(score.coverage.unmeasuredByReason['capability-disabled']).toBe(1)
    expect(score.reference.directlyReachable.measured.status).toBe(
      'not-measured'
    )
  })

  // The reference arm still ran. Only the adjudicated one is absent, and only it
  // must read as absent.
  test('an unadjudicated run measures the reference arm and leaves the adjudicated arm unknown', () => {
    const score = scoreChangeImpactCases([
      scoredCase({
        id: 'no-model',
        expected: [{ path: 'src/a.py', reachability: 'caller-of-changed-symbol' }],
        referenceFiles: ['src/a.py'],
        findingFiles: [],
        adjudicationStatus: 'no-model'
      })
    ])

    expect(score.reference.directlyReachable.measured).toEqual({
      status: 'measured',
      matched: 1,
      total: 1,
      rate: 1
    })
    expect(score.adjudicated.directlyReachable.measured.status).toBe(
      'not-measured'
    )
    expect(score.adjudicated.directlyReachable.unmeasuredExpectedCount).toBe(1)
    expect(score.adjudicationDelta.status).toBe('not-measured')
    expect(score.coverage.adjudicationMeasuredCaseCount).toBe(0)

    const [caseScore] = score.caseScores

    expect(caseScore?.status).toBe('scored')
    expect(
      caseScore?.status === 'scored' ? caseScore.adjudicatedFileCount : 'set'
    ).toBeUndefined()
    expect(
      caseScore?.status === 'scored'
        ? caseScore.expectations[0]?.inAdjudicatedList
        : 'set'
    ).toBeUndefined()
  })

  // Spec 22's known-not-reported list: "Absence from `impactFindings` is not a
  // statement that a dependent is unaffected." Two of the four situations that
  // produce it — a failed call and the `maxCalls` cap — happen inside a run that
  // completed, so a completed run is not automatically an exhaustive one.
  test('a dependent not reported by a partially adjudicated run is undetermined, not a miss', () => {
    const score = scoreChangeImpactCases([
      {
        corpusCase: corpusCaseFixture({
          id: 'capped',
          expected: [
            { path: 'src/a.py', reachability: 'caller-of-changed-symbol' }
          ]
        }),
        outcome: {
          status: 'scored',
          report: impactReportFixture({
            referenceFiles: ['src/a.py', 'src/noise.py'],
            findingFiles: ['src/noise.py'],
            unadjudicatedPairCount: 3,
            adjudicationCallsTruncated: true
          })
        }
      }
    ])

    expect(score.adjudicated.directlyReachable.measured.status).toBe(
      'not-measured'
    )
    expect(score.adjudicated.directlyReachable.unmeasuredExpectedCount).toBe(1)
    expect(score.coverage.adjudicationMeasuredCaseCount).toBe(1)
    expect(score.coverage.adjudicationExhaustiveCaseCount).toBe(0)
    expect(score.coverage.unadjudicatedPairCount).toBe(3)
    expect(score.coverage.adjudicationCallsTruncatedCaseCount).toBe(1)
    // "Removed" cannot be told from "never checked" in such a run.
    expect(score.adjudicationDelta.status).toBe('not-measured')
    expect(
      score.adjudicationDelta.status === 'not-measured'
        ? score.adjudicationDelta.reason
        : ''
    ).toContain('maxCalls')
  })

  // A hit is unambiguous whatever the run left unchecked.
  test('a dependent REPORTED by a partially adjudicated run still counts as found', () => {
    const score = scoreChangeImpactCases([
      {
        corpusCase: corpusCaseFixture({
          id: 'capped-but-found',
          expected: [
            { path: 'src/a.py', reachability: 'caller-of-changed-symbol' }
          ]
        }),
        outcome: {
          status: 'scored',
          report: impactReportFixture({
            referenceFiles: ['src/a.py'],
            findingFiles: ['src/a.py'],
            unadjudicatedPairCount: 2
          })
        }
      }
    ])

    expect(score.adjudicated.directlyReachable.measured).toEqual({
      status: 'measured',
      matched: 1,
      total: 1,
      rate: 1
    })
  })

  test('mixes measured and unmeasured cases without letting the unmeasured ones score', () => {
    const score = scoreChangeImpactCases([
      scoredCase({
        id: 'measured',
        expected: [{ path: 'src/a.py', reachability: 'caller-of-changed-symbol' }],
        referenceFiles: ['src/a.py']
      }),
      {
        corpusCase: corpusCaseFixture({
          id: 'missing',
          expected: [
            { path: 'src/b.py', reachability: 'caller-of-changed-symbol' }
          ]
        }),
        outcome: {
          status: 'unmeasured',
          reason: 'engine-error',
          detail: 'repository_error: could not read the checkout'
        }
      }
    ])

    expect(score.reference.directlyReachable.measured).toEqual({
      status: 'measured',
      matched: 1,
      total: 1,
      rate: 1
    })
    expect(score.reference.directlyReachable.unmeasuredExpectedCount).toBe(1)
    expect(score.coverage.unmeasuredByReason['engine-error']).toBe(1)
  })
})

describe('change-impact scoring: the destination file is the unit', () => {
  test('a test-file dependent counts, and both reference lists feed one arm', () => {
    const score = scoreChangeImpactCases([
      {
        corpusCase: corpusCaseFixture({
          id: 'test-dependent',
          expected: [
            { path: 'tests/test_thing.py', reachability: 'caller-of-changed-symbol' }
          ]
        }),
        outcome: {
          status: 'scored',
          report: impactReportFixture({
            referenceFiles: ['src/other.py'],
            referenceTestFiles: ['tests/test_thing.py'],
            findingFiles: ['tests/test_thing.py']
          })
        }
      }
    ])

    expect(score.reference.directlyReachable.measured).toMatchObject({
      matched: 1,
      total: 1
    })
    expect(score.reference.predictedFileCount).toBe(2)
  })

  test('several sites in one file are one prediction', () => {
    const report = impactReportFixture({ referenceFiles: ['src/a.py'] })
    const withTwoSites: typeof report = {
      ...report,
      impactedFiles: report.impactedFiles.map((file) => ({
        ...file,
        symbols: file.symbols.map((symbol) => ({
          ...symbol,
          sites: [
            { line: 11, text: 'value = changed_helper(row)' },
            { line: 42, text: 'other = changed_helper(row)' }
          ]
        }))
      }))
    }
    const score = scoreChangeImpactCases([
      {
        corpusCase: corpusCaseFixture({
          id: 'two-sites',
          expected: [
            { path: 'src/a.py', reachability: 'caller-of-changed-symbol' }
          ]
        }),
        outcome: { status: 'scored', report: withTwoSites }
      }
    ])

    expect(score.reference.predictedFileCount).toBe(1)
    expect(score.reference.precision.lower).toEqual({
      status: 'known',
      value: 1
    })
  })

  // The impact admission gate refuses a finding naming a dependent the run never
  // located. Counting it rather than assuming it keeps a broken gate visible.
  test('counts an adjudicated file the reference list never carried', () => {
    const score = scoreChangeImpactCases([
      scoredCase({
        id: 'ungated',
        expected: [{ path: 'src/a.py', reachability: 'caller-of-changed-symbol' }],
        referenceFiles: [],
        findingFiles: ['src/a.py']
      })
    ])

    if (score.adjudicationDelta.status !== 'measured') {
      throw new Error('expected a measured delta')
    }

    expect(
      score.adjudicationDelta.modelInvolved.addedNotInReferenceListCount
    ).toBe(1)
  })
})
