// The pairing predicate, asserted at its edges: what it pairs, what it refuses to
// pair, and what it says when it could not look. Reporting a rename or a move as
// a deletion applies the most severe category this report has to a refactoring,
// and a false pairing does the inverse — it hides a real removal — so both
// directions are covered here.

import { describe, expect, test } from 'vitest'
import { indexAddedDeclarations } from './removal-pairing.js'

const added = (name: string, path: string, line = 1) => ({
  name,
  path,
  line,
  language: 'typescript' as const
})

const removed = (name: string, path: string) => ({
  name,
  path,
  language: 'typescript' as const
})

describe('removal pairing', () => {
  test('pairs a removal with a same-named declaration the change adds', () => {
    const index = indexAddedDeclarations({
      declarations: [added('legacyApi', 'src/api.ts', 12)]
    })

    expect(index.pair(removed('legacyApi', 'src/legacy.ts'))).toEqual({
      match: 'same-name',
      declaration: { name: 'legacyApi', path: 'src/api.ts', line: 12 }
    })
  })

  test('reports a removal when nothing the change adds carries the name', () => {
    const index = indexAddedDeclarations({
      declarations: [added('somethingElse', 'src/api.ts')]
    })

    // The confident outcome, and the one that earns the severe reading: every
    // added declaration was searched and none of them is this symbol.
    expect(index.pair(removed('legacyApi', 'src/legacy.ts'))).toEqual({
      match: 'none'
    })
  })

  test('a renamed symbol is still reported as a removal', () => {
    const index = indexAddedDeclarations({
      declarations: [added('loadUser', 'src/store.ts', 4)]
    })

    // The documented limit of the smallest sound predicate. The name IS the
    // evidence, and a rename changes it; pairing on body similarity instead would
    // pair two unrelated symbols that share boilerplate, and a false pairing hides
    // a real deletion — the one error this must not make.
    expect(index.pair(removed('fetchUser', 'src/store.ts'))).toEqual({
      match: 'none'
    })
  })

  test('does not pair across languages', () => {
    const index = indexAddedDeclarations({
      declarations: [
        { name: 'handler', path: 'src/handler.py', line: 3, language: 'python' }
      ]
    })

    // A same-named symbol in another language is a coincidence, not a relocation.
    expect(index.pair(removed('handler', 'src/handler.ts'))).toEqual({
      match: 'none'
    })
  })

  test('does not pair a declaration with its own removed file', () => {
    const index = indexAddedDeclarations({
      declarations: [added('value', 'src/thing.ts', 5)]
    })

    expect(index.pair(removed('value', 'src/thing.ts'))).toEqual({
      match: 'none'
    })
  })

  test('pairs deterministically when several added files declare the name', () => {
    const index = indexAddedDeclarations({
      declarations: [
        added('shared', 'src/z.ts', 1),
        added('shared', 'src/a.ts', 9),
        added('shared', 'src/a.ts', 2)
      ]
    })

    expect(index.pair(removed('shared', 'src/old.ts'))).toEqual({
      match: 'same-name',
      declaration: { name: 'shared', path: 'src/a.ts', line: 2 }
    })
  })

  // The failure mode this codebase has a name for: a missing input producing the
  // confident answer instead of an error.
  test('says the search was inconclusive rather than confidently reporting a removal', () => {
    const index = indexAddedDeclarations({
      declarations: [added('somethingElse', 'src/api.ts')],
      incompleteReason: '2 changed file(s) could not be read.'
    })

    expect(index.pair(removed('legacyApi', 'src/legacy.ts'))).toEqual({
      match: 'inconclusive',
      reason: '2 changed file(s) could not be read.'
    })
  })

  test('an incomplete candidate set still pairs the matches it did see', () => {
    const index = indexAddedDeclarations({
      declarations: [added('legacyApi', 'src/api.ts', 12)],
      incompleteReason: '2 changed file(s) could not be read.'
    })

    // Incompleteness weakens the NEGATIVE only. A declaration that was seen is
    // still evidence, whatever else was missed.
    expect(index.pair(removed('legacyApi', 'src/legacy.ts'))).toEqual({
      match: 'same-name',
      declaration: { name: 'legacyApi', path: 'src/api.ts', line: 12 }
    })
  })
})
