import { describe, expect, test } from 'vitest'
import type { IntentFulfilmentReport } from '../../intent-fulfilment/index.js'
import type { IntentLineMapEntry } from './intent-corpus-hydration.js'
import type { IntentCorpusCase } from './intent-corpus.schema.js'
import {
  listPlacement,
  scoreIntentCases,
  SPEC_DENOMINATOR_NOT_MEASURABLE,
  type IntentCaseInput
} from './intent-eval-scoring.js'

// A three-clause excerpt, assembled so the body lines and the source lines
// DIFFER — the whole point of the map. Source lines 10, 11 and 20 are body lines
// 1, 2 and 4, with body line 3 the blank slice separator that belongs to no source
// line at all.
const lineMap: readonly IntentLineMapEntry[] = [
  { bodyLine: 1, sourceLine: 10 },
  { bodyLine: 2, sourceLine: 11 },
  { bodyLine: 4, sourceLine: 20 }
]

const corpusCase = (
  overrides: Partial<IntentCorpusCase> = {}
): IntentCorpusCase =>
  ({
    id: 'pw01-example',
    arm: 'prewritten',
    split: 'dev',
    mismatchOrigin: 'natural',
    source: 'repository-spec-slice',
    capturedAt: '2026-08-01',
    intent: {
      kind: 'document-slice',
      commit: 'a'.repeat(40),
      path: 'specs/20-discovery-posture.md',
      title: 'Spec 20',
      lineRanges: [[10, 11], [20, 20]]
    },
    change: { baseCommit: 'b'.repeat(40), headCommit: 'c'.repeat(40) },
    maxObligations: 40,
    humanObligationCount: 6,
    outstandingExpectations: [
      {
        id: 'out-1',
        statement: 'the three arms are never run',
        intentLineRanges: [[10, 10]],
        rationale: 'The clause names three arms and the change runs none.',
        provenance: 'Fixed human enumeration.'
      },
      {
        id: 'out-2',
        statement: 'cost is neither recorded nor reported',
        intentLineRanges: [[11, 11]],
        rationale: 'The clause requires cost to be recorded and reported.',
        provenance: 'Fixed human enumeration.'
      },
      {
        id: 'out-3',
        statement: 'the variance band is applied to nothing',
        intentLineRanges: [[20, 20]],
        rationale: 'The clause fixes a band nothing at head applies.',
        provenance: 'Fixed human enumeration.'
      }
    ],
    ...overrides
  }) as IntentCorpusCase

const obligation = (input: {
  readonly id: string
  readonly line: number
  readonly status: 'evidenced' | 'not-evidenced' | 'not-contradicted' | 'undetermined'
}): IntentFulfilmentReport['obligations'][number] => {
  const base = {
    id: input.id,
    source: { origin: 'inbox:spec/abc', line: input.line, text: 'a clause' },
    statement: 'a checkable statement'
  }

  return input.status === 'evidenced'
    ? {
        ...base,
        status: 'evidenced',
        evidence: [
          { path: 'src/a.ts', line: 3, side: 'added', text: 'const a = 1' }
        ]
      }
    : { ...base, status: input.status }
}

const report = (
  obligations: readonly IntentFulfilmentReport['obligations'][number][]
): IntentFulfilmentReport =>
  ({
    schemaVersion: '1.0',
    status: 'completed',
    generatedAt: '2026-08-12T00:00:00.000Z',
    scope: {
      baseRef: 'b',
      headRef: 'c',
      changedFileCount: 1,
      changedLineCount: 10,
      intentOrigins: ['inbox:spec/abc'],
      intentTruncated: false
    },
    summary: {
      intentFragmentCount: 1,
      obligationCount: obligations.length,
      evidencedCount: 0,
      notEvidencedStatusCount: 0,
      notContradictedCount: 0,
      undeterminedCount: 0,
      obligationsTruncated: false,
      uncitedObligationCount: 0,
      unverifiedEvidenceClaimCount: 0,
      notEvidencedCount: 0,
      extraScopeFileCount: 0
    },
    obligations: [...obligations],
    extraScope: [],
    warnings: []
  }) as IntentFulfilmentReport

const scoredCase = (
  obligations: readonly IntentFulfilmentReport['obligations'][number][],
  overrides: Partial<IntentCorpusCase> = {}
): IntentCaseInput => ({
  corpusCase: corpusCase(overrides),
  outcome: { status: 'scored', report: report(obligations), lineMap }
})

describe('intent scoring — the join', () => {
  // The join is the citation, resolved through the map. Body line 1 is source
  // line 10, which `out-1` anchors; body line 3 is the slice separator and belongs
  // to no source line, so an obligation citing it is unanchored and UNSCORED.
  test('joins an obligation to an expectation through the line map', () => {
    const score = scoreIntentCases([
      scoredCase([
        obligation({ id: 'obl_1', line: 1, status: 'not-evidenced' }),
        obligation({ id: 'obl_2', line: 3, status: 'evidenced' })
      ])
    ])
    const caseScore = score.caseScores[0]

    if (caseScore?.status !== 'scored') {
      throw new Error('expected a scored case')
    }

    expect(caseScore.anchoredObligationCount).toBe(1)
    expect(caseScore.expectations.map((row) => row.outcome)).toEqual([
      'reported-outstanding',
      'not-reported',
      'not-reported'
    ])
    expect(score.arms.prewritten.unanchoredObligationCount).toBe(1)
  })

  // An expectation nothing cites is a recall miss and NOT a false-satisfied claim:
  // the run asserted nothing about it, so nobody was invited to stop looking.
  test('an unreported expectation is a recall miss, not a satisfaction claim', () => {
    const score = scoreIntentCases([
      scoredCase([obligation({ id: 'obl_1', line: 1, status: 'not-evidenced' })])
    ])

    expect(score.arms.prewritten.outstandingRecall).toEqual({
      status: 'measured',
      matched: 1,
      total: 3,
      rate: 1 / 3
    })
    expect(score.arms.prewritten.falseSatisfied.claimCount).toBe(0)
  })

  // One obligation on the list is enough. Two obligations citing the same clause,
  // one cleared and one outstanding, still leave the row on the list a human reads.
  test('an expectation is reported outstanding when any citing obligation is on the list', () => {
    const score = scoreIntentCases([
      scoredCase([
        obligation({ id: 'obl_1', line: 1, status: 'evidenced' }),
        obligation({ id: 'obl_2', line: 1, status: 'undetermined' })
      ])
    ])

    expect(score.arms.prewritten.falseSatisfied.claimCount).toBe(0)
    expect(score.arms.prewritten.outstandingRecall).toEqual({
      status: 'measured',
      matched: 1,
      total: 3,
      rate: 1 / 3
    })
  })
})

describe('intent scoring — the false-satisfied metric', () => {
  // Hand-checked: three expectations. `out-1` is cleared by `evidenced`, `out-2`
  // is cleared by `not-contradicted`, `out-3` stays on the list. So two claims,
  // one of each kind; recall is 1/3; and the share over the outstanding
  // obligations the run REACHED is 2 of 3.
  test('counts a wrong evidenced and a wrong not-contradicted alike', () => {
    const score = scoreIntentCases([
      scoredCase([
        obligation({ id: 'obl_1', line: 1, status: 'evidenced' }),
        obligation({ id: 'obl_2', line: 2, status: 'not-contradicted' }),
        obligation({ id: 'obl_3', line: 4, status: 'not-evidenced' })
      ])
    ])
    const arm = score.arms.prewritten

    expect(arm.falseSatisfied.claimCount).toBe(2)
    expect(arm.falseSatisfied.viaEvidenced).toBe(1)
    expect(arm.falseSatisfied.viaNotContradicted).toBe(1)
    expect(arm.falseSatisfied.rateOverReached).toEqual({
      status: 'measured',
      matched: 2,
      total: 3,
      rate: 2 / 3
    })
    expect(arm.outstandingRecall).toEqual({
      status: 'measured',
      matched: 1,
      total: 3,
      rate: 1 / 3
    })
    // The same row is counted twice over, which is what spec 23 requires: it is
    // absent from recall AND present in the false-satisfied numerator.
    expect(arm.notContradictedClearingOutstandingCount).toBe(1)
  })

  // Spec 23's own denominator is every obligation reported `evidenced` or
  // `not-contradicted`, and this corpus cannot supply a truth for the ones no
  // expectation anchors. The rate is permanently not-measured, and it says why.
  test("spec 23's own denominator is reported as not measurable, never as a number", () => {
    const score = scoreIntentCases([
      scoredCase([obligation({ id: 'obl_1', line: 1, status: 'evidenced' })])
    ])

    expect(
      score.arms.prewritten.falseSatisfied.rateOverAllSatisfiedClaims
    ).toEqual({
      status: 'not-measured',
      reason: SPEC_DENOMINATOR_NOT_MEASURABLE
    })
  })
})

describe('intent scoring — coverage', () => {
  // A refusal is the engine DECLINING to answer because an input limit bound, and
  // spec 23 requires exactly that. Scoring it as a case with no obligations would
  // drag every rate down while looking like a result.
  test('a refused case leaves every rate and is reported separately', () => {
    const score = scoreIntentCases([
      scoredCase([obligation({ id: 'obl_1', line: 1, status: 'not-evidenced' })]),
      {
        corpusCase: corpusCase({ id: 'pw02-example' }),
        outcome: {
          status: 'refused',
          code: 'intent_too_many_obligations',
          detail: 'the extraction yielded at least 40 obligations'
        }
      }
    ])

    expect(score.coverage).toEqual({
      totalCaseCount: 2,
      scoredCaseCount: 1,
      refusedCaseCount: 1,
      unmeasuredCaseCount: 0,
      totalExpectationCount: 6,
      scoredExpectationCount: 3
    })
    expect(score.arms.prewritten.outstandingRecall).toEqual({
      status: 'measured',
      matched: 1,
      total: 3,
      rate: 1 / 3
    })
  })

  test('an unmeasured case leaves every rate too', () => {
    const score = scoreIntentCases([
      {
        corpusCase: corpusCase(),
        outcome: {
          status: 'unmeasured',
          reason: 'not-hydrated',
          detail: 'no checkout'
        }
      }
    ])

    expect(score.coverage.scoredCaseCount).toBe(0)
    expect(score.arms.prewritten.outstandingRecall.status).toBe('not-measured')
    expect(score.arms.prewritten.falseSatisfied.claimCount).toBe(0)
  })

  // The two arms are never pooled, and the post-hoc arm carries no expectation.
  test('the arms are scored apart', () => {
    const score = scoreIntentCases([
      scoredCase([obligation({ id: 'obl_1', line: 1, status: 'not-evidenced' })]),
      {
        corpusCase: corpusCase({
          id: 'ph01-example',
          arm: 'posthoc',
          intent: { kind: 'commit-message', commit: 'd'.repeat(40) },
          outstandingExpectations: []
        }),
        outcome: {
          status: 'scored',
          report: report([
            obligation({ id: 'obl_1', line: 1, status: 'evidenced' })
          ]),
          lineMap
        }
      }
    ])

    expect(score.arms.prewritten.expectationCount).toBe(3)
    expect(score.arms.posthoc.expectationCount).toBe(0)
    expect(score.arms.posthoc.outstandingRecall.status).toBe('not-measured')
  })
})

describe('intent scoring — the verdict table', () => {
  test('places each known verdict on or off the outstanding list', () => {
    const placements = (
      ['evidenced', 'not-evidenced', 'not-contradicted', 'undetermined'] as const
    ).map((status) =>
      listPlacement({
        caseId: 'pw01-example',
        obligation: obligation({ id: 'obl_1', line: 1, status })
      })
    )

    expect(placements).toEqual([
      'off-list',
      'on-list',
      'off-list',
      'on-list'
    ])
  })

  // The recorded incident: before 2026-08-06 both harness scorers ended their
  // status chain with no final branch, so `not-contradicted` was absorbed as
  // "satisfied" by fallthrough. A fifth verdict must be loud.
  test('throws on a verdict it has never been told about', () => {
    expect(() =>
      listPlacement({
        caseId: 'pw01-example',
        obligation: {
          id: 'obl_9',
          source: { origin: 'inbox:spec/abc', line: 1, text: 'a clause' },
          statement: 'a statement',
          status: 'contradicted'
        } as unknown as IntentFulfilmentReport['obligations'][number]
      })
    ).toThrow(/unrecognised reported status "contradicted"/u)
  })

  // An unknown verdict must fail even when it hides in a row the answer key never
  // anchors, because unanchored rows are silently unscored by design.
  test('throws on an unknown verdict hiding in an unanchored obligation', () => {
    expect(() =>
      scoreIntentCases([
        scoredCase([
          {
            id: 'obl_9',
            source: { origin: 'inbox:spec/abc', line: 3, text: 'separator' },
            statement: 'a statement',
            status: 'contradicted'
          } as unknown as IntentFulfilmentReport['obligations'][number]
        ])
      ])
    ).toThrow(/unrecognised reported status/u)
  })
})

describe('intent scoring — degenerate results are called out', () => {
  test('warns when no obligation lands on an answer-key clause', () => {
    const score = scoreIntentCases([
      scoredCase([obligation({ id: 'obl_1', line: 3, status: 'evidenced' })])
    ])

    expect(score.warnings.join(' ')).toMatch(/every rate in this arm is over an empty join/u)
  })

  test('warns when not-contradicted is the modal answer', () => {
    const score = scoreIntentCases([
      scoredCase([
        obligation({ id: 'obl_1', line: 1, status: 'not-contradicted' }),
        obligation({ id: 'obl_2', line: 2, status: 'not-contradicted' })
      ])
    ])

    expect(score.warnings.join(' ')).toMatch(/should not be the modal answer/u)
  })

  test('warns when the fourth verdict is unreachable', () => {
    const score = scoreIntentCases([
      scoredCase([obligation({ id: 'obl_1', line: 1, status: 'not-evidenced' })])
    ])

    expect(score.warnings.join(' ')).toMatch(
      /zero is a finding about the prompt rather than a clean result/u
    )
  })
})
