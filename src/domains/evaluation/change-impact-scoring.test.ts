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

    expect(score.adjudicationDelta).toMatchObject({
      status: 'measured',
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
    expect(score.adjudicationDelta).not.toHaveProperty('removedCorrectCount')
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

    expect(score.adjudicationDelta).toMatchObject({
      status: 'measured',
      addedNotInReferenceListCount: 1
    })
  })
})
