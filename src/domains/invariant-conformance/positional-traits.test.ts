// Spec 24, "Positional Traits", against the real case that motivated it.
//
// `golang-jwt-zero-exp-parsed-as-absent-claim`: three sibling parsers in
// `map_claims.go` that all report `ErrInvalidType`, two of them on the way out of
// the declaration and one from four levels down inside a loop. The fixture is the
// upstream file at the defective commit, verbatim; nothing is simplified to make an
// assertion land.
//
// TWO THINGS ARE ASSERTED, AND THEY DISAGREE WITH EACH OTHER ON PURPOSE.
//
//   1. The requirement is met. The three parsers no longer hold one trait: the two
//      exit-path parsers hold `call:newError@surface/exit` and the nested one holds
//      `call:newError@nested/interior`. Without positional traits all three hold
//      `call:newError` and there is nothing to compare — which is exactly the
//      "Refined Diagnosis" the spec records.
//
//   2. The case still reports nothing, and the arithmetic that stops it is asserted
//      rather than described. Two peers hold the exit-path trait, and spec 24
//      requires at least three cited peers ("below that threshold there is no
//      pattern, only a coincidence"). The spec's own closing note on this case
//      predicted it: "this case carries only three peers including the changed
//      declaration, leaving two — below this spec's three-cited-peer floor. It
//      would have been rejected on that ground regardless."
//
// So positional traits are necessary for this case and not sufficient for it. The
// second assertion is the honest half: a test that reported a divergence here would
// have to have relaxed a MUST, and this one records where the remaining gap is so a
// later change is measured against the real starting point rather than a hoped-for
// one.

import { describe, expect, test } from 'vitest'
import {
  positionalTraitCase,
  positionalTraitCaseTraitKeys
} from '../../shared/testing/conformance-control-fixtures.js'
import { MINIMUM_CITED_PEERS } from './conformance-report.js'
import {
  declarationTraitKey,
  declarationTraitSubjectKey
} from '../declaration-analysis/declaration-shape.js'
import { collectDivergences } from './divergence.js'
import { derivePeerSets, type PeerDeclaration } from './peer-sets.js'

const sourceFile = positionalTraitCase.files[0]

if (sourceFile === undefined) {
  throw new Error('the positional-trait fixture carries no file')
}

const derived = derivePeerSets({
  files: [
    {
      path: sourceFile.path,
      content: sourceFile.content,
      hunks: [
        {
          oldStartLine: 1,
          oldLineCount: 1,
          newStartLine: 1,
          newLineCount: sourceFile.content.split('\n').length
        }
      ]
    }
  ],
  maxChangedDeclarations: 50,
  maxPeersPerDeclaration: 60
})

const peerSet = derived.peerSets[0]

if (peerSet === undefined) {
  throw new Error('the positional-trait fixture produced no peer set')
}

const memberNamed = (name: string): PeerDeclaration => {
  const member = peerSet.members.find((candidate) => candidate.name === name)

  if (member === undefined) {
    throw new Error(`the fixture has no declaration named ${name}`)
  }

  return member
}

const errorTraitKeysOf = (name: string): readonly string[] =>
  memberNamed(name)
    .traits.filter(
      (trait) => declarationTraitSubjectKey(trait) === 'call:newError'
    )
    .map(declarationTraitKey)

describe('golang-jwt sibling parsers, at declaration granularity', () => {
  test('all three parsers mention the same symbol, which is why presence alone saw nothing', () => {
    for (const name of ['parseNumericDate', 'parseString', 'parseClaimsString']) {
      expect(
        memberNamed(name).traits.map(declarationTraitSubjectKey)
      ).toContain('call:newError')
    }
  })

  // THE REQUIREMENT. Two declarations holding the same symbol at materially
  // different positions must no longer count as holding the same trait.
  test('positional traits split the exit-path parsers from the nested one', () => {
    expect(errorTraitKeysOf('parseNumericDate')).toEqual([
      positionalTraitCaseTraitKeys.parseNumericDate
    ])
    expect(errorTraitKeysOf('parseString')).toEqual([
      positionalTraitCaseTraitKeys.parseString
    ])
    expect(errorTraitKeysOf('parseClaimsString')).toEqual([
      positionalTraitCaseTraitKeys.parseClaimsString
    ])
    // Stated as the comparison the deterministic core performs, so this fails if
    // the keys ever coincide again for any reason.
    expect(errorTraitKeysOf('parseNumericDate')).toEqual(
      errorTraitKeysOf('parseString')
    )
    expect(errorTraitKeysOf('parseClaimsString')).not.toEqual(
      errorTraitKeysOf('parseString')
    )
  })

  test('the two exit-path holders are two, and the citation floor is three', () => {
    const exitPathHolders = peerSet.members.filter((member) =>
      member.traits
        .map(declarationTraitKey)
        .includes(positionalTraitCaseTraitKeys.parseNumericDate)
    )

    expect(exitPathHolders.map((member) => member.name)).toEqual([
      'parseNumericDate',
      'parseString'
    ])
    expect(exitPathHolders.length).toBeLessThan(MINIMUM_CITED_PEERS)
  })

  // And the peer denominator is the second, independent reason. Go puts every
  // method of a file at the same indentation column, so the six one-line accessors
  // are peers too: a pattern would need five of the eight peers, and the parsers
  // are three.
  test('the peer set is the whole file, so no two-holder pattern could be a majority', () => {
    expect(peerSet.members.map((member) => member.name)).toEqual([
      'GetExpirationTime',
      'GetNotBefore',
      'GetIssuedAt',
      'GetAudience',
      'GetIssuer',
      'GetSubject',
      'parseNumericDate',
      'parseClaimsString',
      'parseString'
    ])
  })

  test('reports nothing, and does not manufacture a finding to fill the report', () => {
    const result = collectDivergences({
      peerSets: derived.peerSets,
      maxDivergences: 50,
      maxPreExistingDivergences: 25
    })

    expect(result.changeAttributed.map((entry) => entry.statement)).toEqual([
      ...positionalTraitCase.expectedStatements
    ])
    expect(result.preExisting).toEqual([])
  })
})
