// Spec 22 design step 3, asserted where the decisions are made.
//
// The two properties under test are the ones the design rests on:
//
//   THE DETERMINISTIC TIER DOES NOT CALL A MODEL. Spec 22: of ~40 contract
//   categories about 24 have a deterministic reliance predicate and "beat a grep
//   with no model involved". A judge that throws on every call is passed in
//   throughout the first describe block, so a single call would fail the test.
//
//   NOTHING UNADJUDICATED BECOMES A FINDING. Published rates put an untriaged
//   reference list near 90% irrelevant, and reporting the residue as a maybe would
//   restate exactly that noise while looking like triage.

import { describe, expect, test } from 'vitest'
import {
  adjudicateDeterministically,
  collectAdjudicationPairs,
  runAdjudication
} from './adjudication.js'
import type { ContractChange } from './contract-delta.js'
import {
  impactedSymbolKey,
  type ChangedSymbolReport,
  type ImpactedFile
} from './impact-report.js'
import type {
  RelianceJudgement,
  RelianceJudgementInput,
  RelianceJudgementRunner
} from './reliance-judgement.js'

const symbol = (
  overrides: Partial<ChangedSymbolReport> & { readonly name: string }
): ChangedSymbolReport => ({
  kind: 'export',
  language: 'typescript',
  definitionPath: 'src/store.ts',
  definitionLine: 4,
  changeKind: 'modified',
  contractChanges: [],
  referencesInDefinitionFile: 0,
  referencesInNonSourceFiles: 0,
  referencesTruncated: false,
  ...overrides
})

const fileFor = (
  path: string,
  changed: ChangedSymbolReport,
  lines: readonly number[] = [7]
): ImpactedFile => ({
  path,
  symbols: [
    {
      name: changed.name,
      definitionPath: changed.definitionPath,
      definitionLine: changed.definitionLine,
      sites: lines.map((line) => ({ line, text: `${changed.name}()` }))
    }
  ]
})

const absenceChange: ContractChange = {
  dimension: 'absence',
  direction: 'added',
  statement:
    'may now yield an absent value (null/nil/None) where it previously did not',
  consequence: 'a use here that assumes a value is present fails when it is absent'
}

const changesFor = (
  changed: ChangedSymbolReport,
  changes: readonly ContractChange[]
): ReadonlyMap<string, readonly ContractChange[]> =>
  new Map([
    [
      impactedSymbolKey({
        name: changed.name,
        definitionPath: changed.definitionPath,
        definitionLine: changed.definitionLine
      }),
      changes
    ]
  ])

// A judge that must never be reached. Every deterministic case below passes it in,
// so "this category needs no model" is enforced rather than asserted in prose.
const forbiddenJudge: RelianceJudgementRunner = async () => {
  throw new Error('the deterministic tier must not call a model')
}

const scriptedJudge = (
  answer: RelianceJudgement,
  seen?: RelianceJudgementInput[]
): RelianceJudgementRunner =>
  async (input) => {
    seen?.push(input)

    return answer
  }

describe('deterministic adjudication', () => {
  test('a removal nothing re-declares breaks on build, with no model involved', async () => {
    const removed = symbol({
      name: 'legacyApi',
      definitionPath: 'src/legacy.ts',
      definitionLine: 1,
      changeKind: 'deleted',
      removalPairing: { match: 'none' }
    })
    const outcome = await runAdjudication({
      pairs: collectAdjudicationPairs({
        impactedFiles: [fileFor('src/caller.ts', removed, [3, 9])],
        impactedTestFiles: [],
        changedSymbols: [removed]
      }),
      contractChanges: new Map(),
      judge: forbiddenJudge,
      maxCalls: 10
    })

    expect(outcome.candidates).toEqual([
      {
        path: 'src/caller.ts',
        destination: 'production',
        compatibilityClass: 'breaks-on-build',
        reliances: [
          {
            symbolName: 'legacyApi',
            definitionPath: 'src/legacy.ts',
            definitionLine: 1,
            // The finding is about the FILE and anchors on its first located
            // site; the complete site list stays in `impactedFiles`. Anchoring
            // per site would be the per-site report spec 22 removed on measured
            // grounds.
            line: 3,
            contractElement:
              'the declaration of legacyApi, which this change removes',
            consequence:
              'this file references a name the change no longer declares, so the reference does not resolve',
            adjudicatedBy: 'deterministic'
          }
        ]
      }
    ])
    expect(outcome.unadjudicatedPairCount).toBe(0)
  })

  test('an unverifiable removal is may-break, not a confident build break', () => {
    // The repository's recorded recurring defect class: a missing input producing
    // a plausible confident answer. "We searched and found no replacement" and "we
    // could not search" are different statements and must not share a class.
    const verdict = adjudicateDeterministically({
      symbol: symbol({
        name: 'legacyApi',
        changeKind: 'deleted',
        removalPairing: { match: 'inconclusive', reason: '2 files unread.' }
      }),
      changes: []
    })

    expect(verdict).toEqual({
      outcome: 'relies',
      compatibilityClass: 'may-break',
      contractElement:
        'the declaration of legacyApi, which this change removes',
      consequence:
        'this file references a name the change removes; whether the change re-declares it elsewhere could not be determined, so check before concluding either way'
    })
  })

  test('a move is may-break and names where the declaration went', () => {
    const verdict = adjudicateDeterministically({
      symbol: symbol({
        name: 'fetchUser',
        changeKind: 'moved',
        removalPairing: {
          match: 'same-name',
          declaration: { name: 'fetchUser', path: 'src/users.ts', line: 12 }
        }
      }),
      changes: []
    })

    expect(verdict).toEqual({
      outcome: 'relies',
      compatibilityClass: 'may-break',
      contractElement:
        'the declaration of fetchUser, which this change relocates to src/users.ts:12',
      consequence:
        'the name still resolves at its new location; a reference bound to the old location does not'
    })
  })

  test('a dependent of a symbol with no detected contract change is no-impact and is not reported', async () => {
    const unchangedContract = symbol({ name: 'fetchUser' })
    const outcome = await runAdjudication({
      pairs: collectAdjudicationPairs({
        impactedFiles: [fileFor('src/caller.ts', unchangedContract)],
        impactedTestFiles: [],
        changedSymbols: [unchangedContract]
      }),
      contractChanges: new Map(),
      judge: forbiddenJudge,
      maxCalls: 10
    })

    // The whole precision lever: the file stays in the reference list, and it
    // produces no finding, because nothing was shown to reach a caller.
    expect(outcome.candidates).toEqual([])
    expect(outcome.deterministicNoImpactPairCount).toBe(1)
    expect(outcome.unadjudicatedPairCount).toBe(0)
  })

  test('a dependent of a newly added symbol is no-impact', async () => {
    const added = symbol({ name: 'fetchUser', changeKind: 'new' })
    const outcome = await runAdjudication({
      pairs: collectAdjudicationPairs({
        impactedFiles: [fileFor('src/caller.ts', added)],
        impactedTestFiles: [],
        changedSymbols: [added]
      }),
      // Present, and still ignored: a symbol that did not exist before the change
      // has no prior contract for anything to have relied on.
      contractChanges: changesFor(added, [absenceChange]),
      judge: forbiddenJudge,
      maxCalls: 10
    })

    expect(outcome.candidates).toEqual([])
    expect(outcome.deterministicNoImpactPairCount).toBe(1)
  })

  // THE VOIDED RUN'S SHAPE, at the level it originated. Spec 22's first
  // adjudication measurement removed every dependent it was given and was read as
  // a judge that rejected everything; the judge had been called zero times, and
  // nothing in the counts said so. A deterministic sweep must be countable AS a
  // deterministic sweep.
  test('a run the deterministic tier settles alone reports zero calls and no verdicts', async () => {
    const unchangedContract = symbol({ name: 'fetchUser' })
    const outcome = await runAdjudication({
      pairs: collectAdjudicationPairs({
        impactedFiles: [
          fileFor('src/a.ts', unchangedContract),
          fileFor('src/b.ts', unchangedContract)
        ],
        impactedTestFiles: [fileFor('src/a.test.ts', unchangedContract)],
        changedSymbols: [unchangedContract]
      }),
      // The empty delta the voided run produced: every dependent goes down the
      // deterministic `no-impact` branch and no call is spent.
      contractChanges: new Map(),
      judge: forbiddenJudge,
      maxCalls: 60
    })

    expect(outcome.deterministicNoImpactPairCount).toBe(3)
    expect(outcome.modelCallCount).toBe(0)
    expect(outcome.modelVerdictCounts).toEqual({
      relies: 0,
      'does-not-rely': 0,
      undetermined: 0
    })
    // The counter that used to pool the two tiers is gone, so there is nothing
    // left to read a silent sweep out of.
    expect(outcome).not.toHaveProperty('noImpactPairCount')
  })
})

describe('model adjudication of the residue', () => {
  const changed = symbol({ name: 'fetchUser' })

  test('sends only the residue, and reports a reliance the model located', async () => {
    const seen: RelianceJudgementInput[] = []
    const outcome = await runAdjudication({
      pairs: collectAdjudicationPairs({
        impactedFiles: [fileFor('src/caller.ts', changed, [7, 19])],
        impactedTestFiles: [],
        changedSymbols: [changed]
      }),
      contractChanges: changesFor(changed, [absenceChange]),
      judge: scriptedJudge({ status: 'relies', line: 19 }, seen),
      maxCalls: 10
    })

    // One call, for one (dependent file, changed symbol) pair — not one per site.
    expect(seen).toEqual([
      {
        changedSymbol: {
          name: 'fetchUser',
          contractChanges: [absenceChange.statement]
        },
        dependent: {
          path: 'src/caller.ts',
          sites: [
            { line: 7, text: 'fetchUser()' },
            { line: 19, text: 'fetchUser()' }
          ]
        }
      }
    ])
    expect(outcome.candidates).toEqual([
      {
        path: 'src/caller.ts',
        destination: 'production',
        // The declaration still exists under the same name, so no build can see
        // this. What moved is behaviour, and this dependent was shown to use it.
        compatibilityClass: 'breaks-at-runtime',
        reliances: [
          {
            symbolName: 'fetchUser',
            definitionPath: 'src/store.ts',
            definitionLine: 4,
            line: 19,
            contractElement: `fetchUser ${absenceChange.statement}`,
            // Composed in code from the dimension. The judging call has no field
            // to write prose into, which is the measured mitigation this domain
            // inherits: asking a judgement to justify itself takes spurious
            // rejection from 26-36% to 73-88%.
            consequence: absenceChange.consequence,
            adjudicatedBy: 'model'
          }
        ]
      }
    ])
  })

  test('a does-not-rely answer is counted against the MODEL tier, not the deterministic one', async () => {
    const outcome = await runAdjudication({
      pairs: collectAdjudicationPairs({
        impactedFiles: [fileFor('src/caller.ts', changed)],
        impactedTestFiles: [],
        changedSymbols: [changed]
      }),
      contractChanges: changesFor(changed, [absenceChange]),
      judge: scriptedJudge({ status: 'does-not-rely' }),
      maxCalls: 10
    })

    expect(outcome.candidates).toEqual([])
    // The rejection the model actually made, told apart from a pair code settled:
    // one means "the model looked and said no", the other means it never ran.
    expect(outcome.modelVerdictCounts['does-not-rely']).toBe(1)
    expect(outcome.deterministicNoImpactPairCount).toBe(0)
    expect(outcome.modelCallCount).toBe(1)
    expect(outcome.unadjudicatedPairCount).toBe(0)
  })

  // The distribution is the cheapest bug signature this layer has, and reading it
  // used to require a bespoke replay probe.
  test('reports the verdict distribution, including the answers reported nowhere', async () => {
    const answers: readonly RelianceJudgement[] = [
      { status: 'relies', line: 7 },
      { status: 'does-not-rely' },
      // Cited a line nobody located: downgraded to undetermined by verification.
      { status: 'relies', line: 4000 }
    ]
    let call = 0
    const outcome = await runAdjudication({
      pairs: collectAdjudicationPairs({
        impactedFiles: [
          fileFor('src/a.ts', changed),
          fileFor('src/b.ts', changed),
          fileFor('src/c.ts', changed)
        ],
        impactedTestFiles: [],
        changedSymbols: [changed]
      }),
      contractChanges: changesFor(changed, [absenceChange]),
      judge: async () => {
        const answer = answers[call]
        call += 1

        return answer ?? { status: 'undetermined' }
      },
      maxCalls: 10
    })

    expect(outcome.modelCallCount).toBe(3)
    expect(outcome.modelVerdictCounts).toEqual({
      relies: 1,
      'does-not-rely': 1,
      undetermined: 1
    })
    expect(outcome.failedCallCount).toBe(0)
  })

  test('a failed call costs one pair and nothing else', async () => {
    const outcome = await runAdjudication({
      pairs: collectAdjudicationPairs({
        impactedFiles: [
          fileFor('src/caller.ts', changed),
          fileFor('src/other.ts', changed)
        ],
        impactedTestFiles: [],
        changedSymbols: [changed]
      }),
      contractChanges: changesFor(changed, [absenceChange]),
      judge: async (input) => {
        if (input.dependent.path === 'src/caller.ts') {
          throw new Error('provider exploded')
        }

        return { status: 'relies', line: 7 }
      },
      maxCalls: 10
    })

    // Spec 22: failure MUST be recoverable. The finest-grained form of that — the
    // run continues, the second dependent is still adjudicated, and the failed one
    // becomes a count rather than a claim in either direction.
    expect(outcome.failedCallCount).toBe(1)
    expect(outcome.unadjudicatedPairCount).toBe(1)
    // Both calls were spent; only one returned a verdict.
    expect(outcome.modelCallCount).toBe(2)
    expect(outcome.modelVerdictCounts).toEqual({
      relies: 1,
      'does-not-rely': 0,
      undetermined: 0
    })
    expect(outcome.candidates.map((candidate) => candidate.path)).toEqual([
      'src/other.ts'
    ])
  })

  test('with no judge the residue is counted, never reported as a maybe', async () => {
    const outcome = await runAdjudication({
      pairs: collectAdjudicationPairs({
        impactedFiles: [fileFor('src/caller.ts', changed)],
        impactedTestFiles: [],
        changedSymbols: [changed]
      }),
      contractChanges: changesFor(changed, [absenceChange]),
      maxCalls: 10
    })

    expect(outcome.candidates).toEqual([])
    expect(outcome.unadjudicatedPairCount).toBe(1)
    expect(outcome.deterministicNoImpactPairCount).toBe(0)
    // No judge means no call, and the distribution says so rather than reading as
    // three rejections that never happened.
    expect(outcome.modelCallCount).toBe(0)
    expect(outcome.modelVerdictCounts).toEqual({
      relies: 0,
      'does-not-rely': 0,
      undetermined: 0
    })
  })

  test('a cited line the search never located is discarded rather than reported', async () => {
    const outcome = await runAdjudication({
      pairs: collectAdjudicationPairs({
        impactedFiles: [fileFor('src/caller.ts', changed, [7])],
        impactedTestFiles: [],
        changedSymbols: [changed]
      }),
      contractChanges: changesFor(changed, [absenceChange]),
      judge: scriptedJudge({ status: 'relies', line: 400 }),
      maxCalls: 10
    })

    // A finding must carry a line a reader can open. Downgraded to unadjudicated
    // rather than to does-not-rely: only the address was unusable.
    expect(outcome.candidates).toEqual([])
    expect(outcome.unadjudicatedPairCount).toBe(1)
  })

  test('the call cap bounds the residue and says so', async () => {
    let calls = 0
    const outcome = await runAdjudication({
      pairs: collectAdjudicationPairs({
        impactedFiles: [
          fileFor('src/a.ts', changed),
          fileFor('src/b.ts', changed)
        ],
        impactedTestFiles: [fileFor('src/a.test.ts', changed)],
        changedSymbols: [changed]
      }),
      contractChanges: changesFor(changed, [absenceChange]),
      judge: async () => {
        calls += 1

        return { status: 'relies', line: 7 }
      },
      maxCalls: 1
    })

    expect(calls).toBe(1)
    expect(outcome.callsTruncated).toBe(true)
    expect(outcome.unadjudicatedPairCount).toBe(2)
    // Production is spent first, so a bounded run buys the dependents that break
    // in production rather than the ones that break in CI.
    expect(outcome.candidates.map((candidate) => candidate.path)).toEqual([
      'src/a.ts'
    ])
  })
})

describe('grouping', () => {
  test('one finding per dependent file, at the strongest class it reaches', async () => {
    const removed = symbol({
      name: 'legacyApi',
      definitionPath: 'src/legacy.ts',
      definitionLine: 1,
      changeKind: 'deleted',
      removalPairing: { match: 'none' }
    })
    const moved = symbol({
      name: 'fetchUser',
      changeKind: 'moved',
      removalPairing: {
        match: 'same-name',
        declaration: { name: 'fetchUser', path: 'src/users.ts', line: 12 }
      }
    })
    const outcome = await runAdjudication({
      pairs: collectAdjudicationPairs({
        impactedFiles: [
          {
            path: 'src/caller.ts',
            symbols: [
              ...fileFor('src/caller.ts', removed, [2]).symbols,
              ...fileFor('src/caller.ts', moved, [5]).symbols
            ]
          }
        ],
        impactedTestFiles: [],
        changedSymbols: [removed, moved]
      }),
      contractChanges: new Map(),
      judge: forbiddenJudge,
      maxCalls: 10
    })

    expect(outcome.candidates).toHaveLength(1)
    // `may-break` beside `breaks-on-build` must not soften the file: reporting the
    // weaker of the two would understate what a reader is about to open.
    expect(outcome.candidates[0]?.compatibilityClass).toBe('breaks-on-build')
    expect(outcome.candidates[0]?.reliances.map((r) => r.symbolName)).toEqual([
      'legacyApi',
      'fetchUser'
    ])
  })

  test('a test dependent is adjudicated and kept in its own bucket', async () => {
    const removed = symbol({
      name: 'legacyApi',
      changeKind: 'deleted',
      removalPairing: { match: 'none' }
    })
    const outcome = await runAdjudication({
      pairs: collectAdjudicationPairs({
        impactedFiles: [],
        impactedTestFiles: [fileFor('src/caller.test.ts', removed)],
        changedSymbols: [removed]
      }),
      contractChanges: new Map(),
      judge: forbiddenJudge,
      maxCalls: 10
    })

    // A test that calls a removed symbol genuinely breaks, so dropping it would
    // lose signal; it breaks in CI rather than in production, so it is labelled.
    expect(outcome.candidates[0]?.destination).toBe('test')
    expect(outcome.candidates[0]?.compatibilityClass).toBe('breaks-on-build')
  })
})
