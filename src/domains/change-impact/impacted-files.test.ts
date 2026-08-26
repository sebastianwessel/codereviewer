// Spec 22's file-granularity requirement, asserted where it is implemented.
//
// The requirement is not cosmetic: the published result the spec cites scores the
// IDENTICAL predictions at file granularity rather than at method granularity and
// more than doubles precision. What has to hold is that regrouping loses nothing —
// no site, no symbol, no ranking — and that the two ends stay joinable.

import { describe, expect, test } from 'vitest'
import type { ChangedSymbol } from './changed-symbols.js'
import { changedSymbolKey } from './contract-changes.js'
import type { SymbolDependents } from './dependent-discovery.js'
import { groupImpactedFiles } from './impacted-files.js'

const symbol = (
  name: string,
  path = 'src/store.ts',
  line = 1
): ChangedSymbol => ({
  path,
  name,
  kind: 'export',
  language: 'typescript',
  line,
  spanEndLine: line,
  changeKind: 'modified'
})

const dependents = (
  input: Partial<SymbolDependents> & { readonly symbol: ChangedSymbol }
): SymbolDependents => ({
  references: [],
  testReferences: [],
  referencesInDefinitionFile: 0,
  referencesInNonSourceFiles: 0,
  referencesTruncated: false,
  referenceSearchTruncated: false,
  ...input
})

const site = (path: string, line: number, text = 'call()') => ({
  path,
  line,
  text
})

describe('impacted files', () => {
  test('groups the sites of one symbol by the file they landed in', () => {
    const scheme = symbol('scheme')
    const grouped = groupImpactedFiles({
      dependents: [
        dependents({
          symbol: scheme,
          references: [
            site('src/a.ts', 40),
            site('src/b.ts', 8),
            site('src/a.ts', 3)
          ]
        })
      ]
    })

    expect(
      grouped.impactedFiles.map((file) => [
        file.path,
        file.symbols.flatMap((entry) => entry.sites.map((s) => s.line))
      ])
    ).toEqual([
      // Sites read in line order inside a file, because that is the order a
      // reader works down the file they opened.
      ['src/a.ts', [3, 40]],
      ['src/b.ts', [8]]
    ])
  })

  test('names every changed symbol that reaches a file on that file', () => {
    const alpha = symbol('alpha', 'src/alpha.ts')
    const beta = symbol('beta', 'src/beta.ts')
    const grouped = groupImpactedFiles({
      dependents: [
        dependents({ symbol: alpha, references: [site('src/caller.ts', 2)] }),
        dependents({ symbol: beta, references: [site('src/caller.ts', 5)] })
      ]
    })

    expect(grouped.impactedFiles).toHaveLength(1)
    expect(
      grouped.impactedFiles[0]?.symbols.map((entry) => [
        entry.name,
        entry.definitionPath,
        entry.definitionLine
      ])
    ).toEqual([
      ['alpha', 'src/alpha.ts', 1],
      ['beta', 'src/beta.ts', 1]
    ])
  })

  test('keeps two same-named symbols distinct inside one destination', () => {
    const first = symbol('handler', 'src/a.ts', 1)
    const second = symbol('handler', 'src/b.ts', 7)
    const grouped = groupImpactedFiles({
      dependents: [
        dependents({ symbol: first, references: [site('src/caller.ts', 2)] }),
        dependents({ symbol: second, references: [site('src/caller.ts', 3)] })
      ]
    })

    // Collapsing them on name alone would attribute one symbol's sites to the
    // other, and the reader would open the wrong definition.
    expect(grouped.impactedFiles[0]?.symbols).toHaveLength(2)
  })

  test('a file this change also touched is listed first', () => {
    const touched = symbol('z', 'src/zzz-touched.ts', 2)
    const grouped = groupImpactedFiles({
      dependents: [
        dependents({
          symbol: symbol('fetchUser'),
          references: [site('src/aaa-untouched.ts', 2)]
        }),
        dependents({
          symbol: touched,
          references: [site('src/zzz-touched.ts', 4)]
        })
      ]
    })

    // Discovery ranks sites so that files this change also touched come first;
    // regrouping must carry that through, not re-sort it away. Both sides moving
    // together is where a contract mismatch is most likely to have been introduced
    // and least likely to have been noticed.
    expect(grouped.impactedFiles.map((file) => file.path)).toEqual([
      'src/zzz-touched.ts',
      'src/aaa-untouched.ts'
    ])
  })

  test('test destinations never enter the production list', () => {
    const fetchUser = symbol('fetchUser')
    const grouped = groupImpactedFiles({
      dependents: [
        dependents({
          symbol: fetchUser,
          references: [site('src/caller.ts', 2)],
          testReferences: [site('src/caller.test.ts', 7)]
        })
      ]
    })

    expect(grouped.impactedFiles.map((file) => file.path)).toEqual([
      'src/caller.ts'
    ])
    expect(grouped.impactedTestFiles.map((file) => file.path)).toEqual([
      'src/caller.test.ts'
    ])
  })

  test('carries the symbol table through, including a symbol nothing references', () => {
    const alone = symbol('alone', 'src/alone.ts', 4)
    const grouped = groupImpactedFiles({
      dependents: [
        dependents({
          symbol: alone,
          referencesInDefinitionFile: 2,
          referencesInNonSourceFiles: 3,
          referencesTruncated: true,
          referenceSearchTruncated: false
        })
      ],
      // Structured in, STATEMENT out: adjudication branches on the dimension, and
      // the report publishes only the sentence a reader needs.
      contractChanges: new Map([
        [
          changedSymbolKey(alone),
          [
            {
              dimension: 'failure' as const,
              direction: 'added' as const,
              statement: 'may now fail where it previously did not',
              consequence:
                'a use here that does not handle a failure propagates it to this file and its own callers'
            }
          ]
        ]
      ])
    })

    // A symbol with no dependent has no file entry, so dropping it here would turn
    // "nothing was found to use this" into silence.
    expect(grouped.impactedFiles).toEqual([])
    expect(grouped.changedSymbols).toEqual([
      {
        name: 'alone',
        kind: 'export',
        language: 'typescript',
        definitionPath: 'src/alone.ts',
        definitionLine: 4,
        changeKind: 'modified',
        contractChanges: ['may now fail where it previously did not'],
        referencesInDefinitionFile: 2,
        referencesInNonSourceFiles: 3,
        referencesTruncated: true,
        referenceSearchTruncated: false
      }
    ])
  })

  test('carries a removal pairing onto the symbol table', () => {
    const grouped = groupImpactedFiles({
      dependents: [
        dependents({
          symbol: {
            ...symbol('legacyApi', 'src/legacy.ts'),
            changeKind: 'moved',
            removalPairing: {
              match: 'same-name',
              declaration: { name: 'legacyApi', path: 'src/api.ts', line: 12 }
            }
          }
        })
      ]
    })

    expect(grouped.changedSymbols[0]?.changeKind).toBe('moved')
    expect(grouped.changedSymbols[0]?.removalPairing).toEqual({
      match: 'same-name',
      declaration: { name: 'legacyApi', path: 'src/api.ts', line: 12 }
    })
  })

  test('a symbol absent from the contract-change map reports no contract change', () => {
    const grouped = groupImpactedFiles({
      dependents: [dependents({ symbol: symbol('quiet') })],
      contractChanges: new Map()
    })

    // Absent and empty are the same statement, and neither means "safe".
    expect(grouped.changedSymbols[0]?.contractChanges).toEqual([])
  })
})
