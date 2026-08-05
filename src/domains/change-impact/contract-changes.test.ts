// What a reviewer is actually told about a changed symbol.
//
// These drive the real chain — declaration spans from `collectChangedSymbols`,
// hunks and diff lines parsed from one unified diff, delta from
// `describeContractDelta` — rather than hand-built line sets, because the whole
// risk in this wiring is ATTRIBUTION: which changed line belongs to which symbol.
// A test that supplied the line sets directly would assert the part that was never
// in doubt.
//
// The diffs below are written the way intake fetches them (`--unified=0`, no
// context lines), so the anchoring rules under test are the ones production runs.

import { describe, expect, test } from 'vitest'
import { parseGitDiffMaps } from '../repository-intake/index.js'
import { collectChangedSymbols } from './changed-symbols.js'
import { changedSymbolKey, collectContractChanges } from './contract-changes.js'
import { impactedSymbolKey } from './impact-report.js'

const PATH = 'src/store.ts'

// Returns the contract changes per symbol NAME, for a head-side file and the diff
// that produced it.
const contractChangesFor = (
  headContent: string,
  rawDiff: string
): ReadonlyMap<string, readonly string[]> => {
  const [diffMap] = parseGitDiffMaps(rawDiff)
  const changed = collectChangedSymbols({
    files: [
      {
        path: PATH,
        content: headContent,
        changeKind: 'modified',
        hunks: diffMap?.hunks ?? []
      }
    ],
    maxChangedSymbols: 50
  })
  const changes = collectContractChanges({
    changedSymbols: changed.symbols,
    rawDiff
  })

  // Reduced to the STATEMENTS a reader sees. The structured dimension beside them
  // is what adjudication branches on and is asserted in `adjudication.test.ts`;
  // every case below is about which lines were attributed to which symbol, which
  // is the same question under either shape.
  return new Map(
    changed.symbols.map((symbol) => [
      symbol.name,
      (changes.get(changedSymbolKey(symbol)) ?? []).map(
        (change) => change.statement
      )
    ])
  )
}

const diffHeader = [
  `diff --git a/${PATH} b/${PATH}`,
  `--- a/${PATH}`,
  `+++ b/${PATH}`
].join('\n')

describe('the symbol key', () => {
  test('agrees with the key the report joins on', () => {
    // REGRESSION. These two spellings of one identity were formatted
    // independently — one joined on a separator, the other on a space — so every
    // contract delta silently missed its lookup on the way into adjudication.
    // Nothing threw; the report simply said a symbol changed nothing observable.
    // The failure mode is invisible by construction, so it is pinned here.
    const symbol = {
      path: 'src/store.ts',
      name: 'fetchUser',
      kind: 'export' as const,
      language: 'typescript' as const,
      line: 4,
      spanEndLine: 9,
      changeKind: 'modified' as const
    }

    expect(changedSymbolKey(symbol)).toBe(
      impactedSymbolKey({
        name: symbol.name,
        definitionPath: symbol.path,
        definitionLine: symbol.line
      })
    )
    // And it separates the three parts unambiguously: a path ending in the name
    // of another symbol must not collide with that symbol.
    expect(
      changedSymbolKey({ ...symbol, path: 'src/a', name: 'b' })
    ).not.toBe(changedSymbolKey({ ...symbol, path: 'src', name: 'a b' }))
  })
})

describe('contract changes for a changed symbol', () => {
  test('a body that gained a null return says so', () => {
    // The case spec 22 names as the difference between a reference list and a
    // report: "may now return nil where it previously could not" is what tells a
    // reader which of the dependents to open.
    const head = [
      'export const findUser = (id: string) => {',
      "  if (id === '') {",
      '    return null',
      '  }',
      '  return lookup(id)',
      '}',
      '',
      "export const listUsers = () => lookup('*')",
      ''
    ].join('\n')
    const changes = contractChangesFor(
      head,
      [
        diffHeader,
        '@@ -1,0 +2,3 @@',
        "+  if (id === '') {",
        '+    return null',
        '+  }',
        ''
      ].join('\n')
    )

    expect(changes.get('findUser')).toContain(
      'may now yield an absent value (null/nil/None) where it previously did not'
    )
  })

  test('a reformatting-only change reports nothing at all', () => {
    // The field has to be empty far more often than not. A delta that fires on
    // rewrapping a line would put a contract claim on every whitespace commit,
    // and a reader who is wrong once about that stops reading the field.
    const head = [
      'export const total = (values: number[]) =>',
      '  values.reduce((carry, value) => carry + value, 0)',
      ''
    ].join('\n')
    const changes = contractChangesFor(
      head,
      [
        diffHeader,
        '@@ -1,1 +1,2 @@',
        '-export const total = (values: number[]) => values.reduce((carry, value) => carry + value, 0)',
        '+export const total = (values: number[]) =>',
        '+  values.reduce((carry, value) => carry + value, 0)',
        ''
      ].join('\n')
    )

    expect(changes.get('total')).toEqual([])
  })

  test('a body that already threw and still throws is not reported as newly failing', () => {
    // The asymmetry rule, end to end. It only holds if the removed line is
    // anchored inside the same span as the addition that replaced it; anchor the
    // removal anywhere else and this change reads as a function that started
    // throwing, which is a false alarm on an edit that changed a message.
    const head = [
      'export const parseId = (raw: string) => {',
      '  if (!raw) {',
      "    throw new Error('missing id')",
      '  }',
      '  return Number(raw)',
      '}',
      ''
    ].join('\n')
    const changes = contractChangesFor(
      head,
      [
        diffHeader,
        '@@ -3,1 +3,1 @@',
        "-    throw new Error('id required')",
        "+    throw new Error('missing id')",
        ''
      ].join('\n')
    )

    expect(changes.get('parseId')).not.toContain(
      'may now fail where it previously did not'
    )
    expect(changes.get('parseId')).toEqual([])
  })

  test('a change confined to one symbol is not attributed to its neighbour', () => {
    // Attribution is the whole risk in this wiring. A contract claim printed
    // against the wrong symbol sends a reviewer to the wrong dependents, and it is
    // worse than no claim because it is specific and confident.
    //
    // BOTH symbols here are changed and therefore both are seeded, so the empty
    // list on `second` is evidence about attribution rather than about seeding: it
    // is the span, not the absence of a diff hunk, that keeps `first`'s removed
    // `throw` away from it.
    const head = [
      'export const first = (id: string) => {',
      '  return lookup(id)',
      '}',
      '',
      'export const second = (id: string) => {',
      '  return fetch(id)',
      '}',
      ''
    ].join('\n')
    const changes = contractChangesFor(
      head,
      [
        diffHeader,
        '@@ -2,1 +2,1 @@',
        "-  throw new Error('nope')",
        '+  return lookup(id)',
        '@@ -6,1 +6,1 @@',
        '-  return fetch(other)',
        '+  return fetch(id)',
        ''
      ].join('\n')
    )

    expect(changes.get('first')).toContain(
      'no longer signals failure the way it previously did'
    )
    expect(changes.get('second')).toEqual([])
  })

  test('a pure deletion is attributed to the symbol it was deleted from', () => {
    // A deletion with no replacement is the one shape with no addition to
    // co-locate against. Git reports it as `+<line>,0`, naming the head line it
    // sits AFTER, and that anchor has to land inside the symbol that lost the
    // code — the same position `collectChangedSymbols` already treats as touched,
    // so a symbol can never be seeded by a hunk whose lines it is then denied.
    const head = [
      'export const first = (id: string) => {',
      '  return lookup(id)',
      '}',
      ''
    ].join('\n')
    const changes = contractChangesFor(
      head,
      [
        diffHeader,
        '@@ -3,1 +3,0 @@',
        "-  throw new Error('nope')",
        ''
      ].join('\n')
    )

    expect(changes.get('first')).toEqual([
      'no longer signals failure the way it previously did'
    ])
  })

  test('a symbol from a deleted or added file gets no delta', () => {
    // Neither has two sides to compare. The deletion of a file is already stated
    // by `changeKind` in the strongest terms the report has, and every symbol of a
    // NEW file would otherwise be described relative to a contract that never
    // existed — vacuous text on every symbol of every new file.
    const rawDiff = [
      diffHeader,
      '@@ -1,1 +1,1 @@',
      '-export const findUser = () => null',
      '+export const findUser = (id: string) => id',
      ''
    ].join('\n')
    const symbols = collectChangedSymbols({
      files: [
        {
          path: PATH,
          content: 'export const findUser = (id: string) => id\n',
          changeKind: 'new',
          hunks: parseGitDiffMaps(rawDiff)[0]?.hunks ?? []
        }
      ],
      maxChangedSymbols: 50
    }).symbols

    expect(symbols.map((symbol) => symbol.name)).toEqual(['findUser'])
    expect(collectContractChanges({ changedSymbols: symbols, rawDiff }).size).toBe(
      0
    )
  })

  test('no diff text means no contract claim rather than an invented one', () => {
    // Intake returns an empty diff when it had none to fetch — an explicit file
    // list, for example. Nothing was compared, so nothing may be asserted.
    const symbols = collectChangedSymbols({
      files: [
        {
          path: PATH,
          content: 'export const findUser = (id: string) => id\n',
          changeKind: 'modified',
          hunks: [{ oldStartLine: 1, oldLineCount: 1, newStartLine: 1, newLineCount: 1 }]
        }
      ],
      maxChangedSymbols: 50
    }).symbols

    expect(symbols.length).toBe(1)
    expect(
      collectContractChanges({ changedSymbols: symbols, rawDiff: '' }).size
    ).toBe(0)
  })
})
