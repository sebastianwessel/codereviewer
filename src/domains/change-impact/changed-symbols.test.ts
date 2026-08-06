import { describe, expect, test } from 'vitest'
import { supportedSignalLanguages } from '../deterministic-signals/index.js'
import {
  collectChangedSymbols,
  type ChangedSymbolSourceFile
} from './changed-symbols.js'

// One hunk covering the whole file, so a per-language case exercises symbol
// extraction rather than hunk intersection (which has its own cases below).
const wholeFileHunk = (lineCount: number) => [
  {
    oldStartLine: 1,
    oldLineCount: lineCount,
    newStartLine: 1,
    newLineCount: lineCount
  }
]

const modifiedFile = (
  path: string,
  lines: readonly string[]
): ChangedSymbolSourceFile => ({
  path,
  content: lines.join('\n'),
  changeKind: 'modified',
  hunks: wholeFileHunk(lines.length)
})

const collect = (files: readonly ChangedSymbolSourceFile[]) =>
  collectChangedSymbols({ files, maxChangedSymbols: 100 })

// Every language `deterministic-signals` declares support for, with a real
// source snippet each. The cases are keyed off `supportedSignalLanguages` and a
// completeness assertion below fails if that list ever grows without a case
// here, so this cannot silently fall behind the extractors.
const languageCases: ReadonlyArray<{
  readonly language: string
  readonly file: ChangedSymbolSourceFile
  readonly expected: ReadonlyArray<readonly [string, string]>
}> = [
  {
    language: 'typescript',
    file: modifiedFile('src/service.ts', [
      'import { helper } from "./helper.js"',
      'export const fetchUser = (id: string) => helper(id)',
      'export interface UserRecord { id: string }',
      'const privateThing = 1'
    ]),
    expected: [
      ['fetchUser', 'export'],
      ['UserRecord', 'export']
    ]
  },
  {
    language: 'javascript',
    file: modifiedFile('src/service.js', [
      'export function fetchUser(id) { return id }',
      'const privateThing = 1'
    ]),
    expected: [['fetchUser', 'export']]
  },
  {
    language: 'python',
    file: modifiedFile('src/service.py', [
      'def fetch_user(user_id):',
      '    return user_id',
      '',
      'def _private_helper():',
      '    return 1'
    ]),
    expected: [
      ['fetch_user', 'public-symbol'],
      ['_private_helper', 'declaration']
    ]
  },
  {
    language: 'go',
    file: modifiedFile('src/service.go', [
      'package service',
      '',
      'func FetchUser(id string) string {',
      '\treturn id',
      '}',
      '',
      'func privateHelper() int {',
      '\treturn 1',
      '}'
    ]),
    expected: [
      ['FetchUser', 'public-symbol'],
      ['privateHelper', 'declaration']
    ]
  },
  {
    language: 'rust',
    file: modifiedFile('src/service.rs', [
      'pub fn fetch_user(id: u32) -> u32 {',
      '    id',
      '}',
      '',
      'fn private_helper() -> u32 {',
      '    1',
      '}'
    ]),
    expected: [
      ['fetch_user', 'public-symbol'],
      ['private_helper', 'declaration']
    ]
  },
  {
    language: 'java',
    file: modifiedFile('src/Service.java', [
      'package service;',
      '',
      'public class Service {',
      '    int helper() { return 1; }',
      '}'
    ]),
    expected: [['Service', 'public-symbol']]
  },
  {
    language: 'ruby',
    file: modifiedFile('src/service.rb', [
      'class Service',
      '  def fetch_user(id)',
      '    id',
      '  end',
      'end'
    ]),
    expected: [
      ['Service', 'public-symbol'],
      ['fetch_user', 'public-symbol']
    ]
  }
]

describe('changed symbols', () => {
  test('a change inside a body seeds the symbol that owns it', () => {
    // THE case this capability exists for, and the one it used to miss entirely.
    // Editing a function's body leaves its signature untouched, so no hunk ever
    // reaches the declaration line. Under the old declaration-line-only rule that
    // seeded nothing, and the blast radius came back empty — on exactly the change
    // that puts dependents at risk. Measured on three real corpus cases (fastify,
    // rack, typeorm): every changed line sat inside a body, and all three reported
    // zero changed symbols.
    const lines = [
      'def alpha',        // 1
      '  untouched',      // 2
      'end',              // 3
      '',                 // 4
      'def beta',         // 5
      '  changed_here',   // 6
      'end'               // 7
    ]
    const result = collectChangedSymbols({
      files: [
        {
          path: 'lib/x.rb',
          content: lines.join('\n'),
          changeKind: 'modified',
          // Line 6 only: inside `beta`'s body, touching no declaration line.
          hunks: [
            { oldStartLine: 6, oldLineCount: 1, newStartLine: 6, newLineCount: 1 }
          ]
        }
      ],
      maxChangedSymbols: 100
    })

    expect(result.symbols.map((symbol) => symbol.name)).toEqual(['beta'])
  })

  test('a symbol declared after the change is not attributed to it', () => {
    // The span must end where the next declaration begins, or a change high in the
    // file would seed every symbol below it and the blast radius would become the
    // whole module.
    const lines = [
      'def alpha',        // 1
      '  changed_here',   // 2
      'end',              // 3
      '',                 // 4
      'def beta',         // 5
      '  untouched',      // 6
      'end'               // 7
    ]
    const result = collectChangedSymbols({
      files: [
        {
          path: 'lib/x.rb',
          content: lines.join('\n'),
          changeKind: 'modified',
          hunks: [
            { oldStartLine: 2, oldLineCount: 1, newStartLine: 2, newLineCount: 1 }
          ]
        }
      ],
      maxChangedSymbols: 100
    })

    expect(result.symbols.map((symbol) => symbol.name)).toEqual(['alpha'])
  })

  // The three tests below are one defect seen from three sides: the span used to
  // be GUESSED from the next declaration line rather than read from the parse.
  // They are written against Python because its blocks close by indentation, so a
  // wrong end line is not masked by a closing token, but nothing in them is
  // Python-specific — the span now comes from the AST node for every language.
  test('a member owns its own body, and the type owns the lines no member covers', () => {
    // The guessed span ended a type at its FIRST member, so a class-level line
    // below that member — here the attribute on line 4 — was attributed to the
    // method above it instead of to the class. Both statements below are about the
    // same file and the same parse: a body line names the member, a class-body line
    // names the class.
    const lines = [
      'class Shipment:', //         1
      '    def prepare(self):', //   2
      '        return 1', //         3
      '    carrier = "default"', //  4
      '    def deliver(self):', //   5
      '        return 2' //          6
    ]
    const seededBy = (start: number, count: number) =>
      collectChangedSymbols({
        files: [
          {
            path: 'src/shipping.py',
            content: lines.join('\n'),
            changeKind: 'modified',
            hunks: [
              {
                oldStartLine: start,
                oldLineCount: count,
                newStartLine: start,
                newLineCount: count
              }
            ]
          }
        ],
        maxChangedSymbols: 100
      }).symbols.map((symbol) => [
        symbol.name,
        symbol.line,
        symbol.spanEndLine
      ])

    expect(seededBy(3, 1)).toEqual([['prepare', 2, 3]])
    expect(seededBy(4, 1)).toEqual([['Shipment', 1, 6]])
    // One hunk covering both a class-level line and a member's body names both,
    // because the member does not account for every line the hunk touched.
    expect(seededBy(3, 2)).toEqual([
      ['Shipment', 1, 6],
      ['prepare', 2, 3]
    ])
  })

  test('a line between two members belongs to the type, not to the member above it', () => {
    // The guessed span ran the earlier member all the way to the next declaration,
    // so a class-body line between two methods was reported as a contract change to
    // the method above it. That is a confident FALSE statement about a named
    // symbol, not a missing one.
    const lines = [
      'class Shipment:', //         1
      '    def prepare(self):', //   2
      '        return 1', //         3
      '    carrier = "default"', //  4
      '    def deliver(self):', //   5
      '        return 2' //          6
    ]
    const result = collectChangedSymbols({
      files: [
        {
          path: 'src/shipping.py',
          content: lines.join('\n'),
          changeKind: 'modified',
          hunks: [
            { oldStartLine: 4, oldLineCount: 1, newStartLine: 4, newLineCount: 1 }
          ]
        }
      ],
      maxChangedSymbols: 100
    })

    expect(new Set(result.symbols.map((symbol) => symbol.name))).toEqual(
      new Set(['Shipment'])
    )
  })

  test('a change below the last member is not attributed to that member', () => {
    // The mirror of the case above: the guessed span ran the LAST member of a type
    // past the type's own end, so a module-level edit underneath the class was
    // reported as a change to `deliver`.
    const lines = [
      'class Shipment:', //          1
      '    def deliver(self):', //    2
      '        return 2', //          3
      '', //                          4
      'DEFAULT_CARRIER = "post"' //   5
    ]
    const result = collectChangedSymbols({
      files: [
        {
          path: 'src/shipping.py',
          content: lines.join('\n'),
          changeKind: 'modified',
          hunks: [
            { oldStartLine: 5, oldLineCount: 1, newStartLine: 5, newLineCount: 1 }
          ]
        }
      ],
      maxChangedSymbols: 100
    })

    expect(result.symbols.map((symbol) => symbol.name)).toEqual([])
  })

  test('covers every language the signal extractors support', () => {
    expect(
      [...languageCases.map((languageCase) => languageCase.language)].sort()
    ).toEqual([...supportedSignalLanguages].sort())
  })

  for (const languageCase of languageCases) {
    test(`seeds changed symbols from ${languageCase.language} source`, () => {
      const result = collect([languageCase.file])

      expect(
        result.symbols.map((symbol) => [symbol.name, symbol.kind])
      ).toEqual(languageCase.expected.map((entry) => [...entry]))
      expect(
        result.symbols.every(
          (symbol) => symbol.language === languageCase.language
        )
      ).toBe(true)
    })
  }

  // The intersection with the diff is the point: an untouched symbol in a
  // changed file must not be seeded, or the "bounded, diff-seeded" requirement
  // is meaningless.
  test('seeds only symbols whose declaration line falls inside a hunk', () => {
    const result = collect([
      {
        path: 'src/service.ts',
        content: [
          'export const untouched = 1',
          'export const alsoUntouched = 2',
          'export const touched = 3'
        ].join('\n'),
        changeKind: 'modified',
        hunks: [
          { oldStartLine: 3, oldLineCount: 1, newStartLine: 3, newLineCount: 1 }
        ]
      }
    ])

    expect(result.symbols.map((symbol) => symbol.name)).toEqual(['touched'])
  })

  // A pure-deletion hunk reports `newLineCount: 0`; treating it as covering
  // nothing would make every removal inside a file invisible.
  test('a pure-deletion hunk anchors on the line it sits after', () => {
    const result = collect([
      {
        path: 'src/service.ts',
        content: ['export const kept = 1', 'export const other = 2'].join('\n'),
        changeKind: 'modified',
        hunks: [
          { oldStartLine: 2, oldLineCount: 1, newStartLine: 1, newLineCount: 0 }
        ]
      }
    ])

    expect(result.symbols.map((symbol) => symbol.name)).toEqual(['kept'])
  })

  // The maximal contract change. Without it, the capability ships blind to its
  // strongest case (spec 22).
  test('every symbol of a deleted file is changed, with no hunks consulted', () => {
    const result = collect([
      {
        path: 'src/gone.ts',
        content: [
          'export const removedApi = 1',
          'export const alsoRemoved = 2'
        ].join('\n'),
        changeKind: 'deleted',
        hunks: []
      }
    ])

    expect(
      result.symbols.map((symbol) => [
        symbol.name,
        symbol.changeKind,
        symbol.removalPairing
      ])
    ).toEqual([
      // Nothing in this change adds either name back, so the removal is the
      // confident one — and it says so, rather than leaving the reader to assume
      // the question was asked.
      ['removedApi', 'deleted', { match: 'none' }],
      ['alsoRemoved', 'deleted', { match: 'none' }]
    ])
  })

  // Spec 22: "Removals must be paired with additions before reporting". A pure
  // rename or move of a file makes every symbol it declared look deleted — the
  // most severe category this report has — while the symbol is present, under the
  // same name, at a new address.
  test('a symbol whose declaration reappears in an added file is a move, not a deletion', () => {
    const result = collect([
      {
        path: 'src/old/api.ts',
        content: 'export const legacyApi = () => 1',
        changeKind: 'deleted',
        hunks: []
      },
      modifiedFile('src/new/api.ts', ['export const legacyApi = () => 1'])
    ])

    expect(
      result.symbols.map((symbol) => [symbol.name, symbol.changeKind])
    ).toEqual([
      // Path order, so the added declaration sorts above the removed one.
      ['legacyApi', 'modified'],
      ['legacyApi', 'moved']
    ])
    expect(result.symbols[1]?.removalPairing).toEqual({
      match: 'same-name',
      declaration: { name: 'legacyApi', path: 'src/new/api.ts', line: 1 }
    })
  })

  test('pairing runs before the seed cap, so a bound cannot turn a move into a deletion', () => {
    const files: readonly ChangedSymbolSourceFile[] = [
      {
        path: 'src/a-gone.ts',
        content: 'export const relocated = 1',
        changeKind: 'deleted',
        hunks: []
      },
      // Sorts last, so a cap of 1 drops it from the report entirely.
      modifiedFile('src/z-new.ts', ['export const relocated = 1'])
    ]
    const bounded = collectChangedSymbols({ files, maxChangedSymbols: 1 })

    expect(bounded.truncated).toBe(true)
    expect(bounded.symbols.map((symbol) => symbol.changeKind)).toEqual(['moved'])
  })

  test('a removal nobody could verify is not reported as a verified one', () => {
    const result = collectChangedSymbols({
      files: [
        {
          path: 'src/gone.ts',
          content: 'export const removedApi = 1',
          changeKind: 'deleted',
          hunks: []
        }
      ],
      maxChangedSymbols: 100,
      additionsIncompleteReason: '2 changed file(s) could not be read.'
    })

    // The recurring defect class this codebase names: a missing input must not
    // produce the confident answer. Finding no replacement among declarations that
    // were never read is absence of evidence, not evidence of absence.
    expect(result.symbols[0]?.removalPairing).toEqual({
      match: 'inconclusive',
      reason: '2 changed file(s) could not be read.'
    })
    expect(result.symbols[0]?.changeKind).toBe('deleted')
  })

  test('a symbol that was not removed carries no removal pairing', () => {
    const result = collect([modifiedFile('src/a.ts', ['export const kept = 1'])])

    expect(result.symbols[0]?.removalPairing).toBeUndefined()
  })

  test('a symbol reported under several fact kinds collapses to its most visible kind', () => {
    // A Go exported function produces both `declaration` and `public-symbol` at
    // the same line; reporting it twice would double-count the seed.
    const result = collect([
      modifiedFile('src/service.go', [
        'package service',
        '',
        'func FetchUser() int { return 1 }'
      ])
    ])

    expect(result.symbols).toEqual([
      expect.objectContaining({ name: 'FetchUser', kind: 'public-symbol' })
    ])
  })

  test('drops names that cannot be searched for as identifiers', () => {
    const result = collect([
      modifiedFile('src/index.ts', [
        'export * from "./service.js"',
        'export const usable = 1'
      ])
    ])

    // The wildcard re-export records the name `*`, which would match every
    // asterisk in the repository if it were seeded.
    expect(result.symbols.map((symbol) => symbol.name)).toEqual(['usable'])
  })

  test('ignores files in a language the extractors do not support', () => {
    const result = collect([
      modifiedFile('README.md', ['# Title', 'export const notCode = 1'])
    ])

    expect(result.symbols).toEqual([])
  })

  test('sorts deterministically and reports when the seed cap truncated it', () => {
    const files = [
      modifiedFile('src/b.ts', ['export const second = 1']),
      modifiedFile('src/a.ts', [
        'export const alpha = 1',
        'export const beta = 2'
      ])
    ]

    expect(
      collect(files).symbols.map((symbol) => `${symbol.path}:${symbol.line}`)
    ).toEqual(['src/a.ts:1', 'src/a.ts:2', 'src/b.ts:1'])

    const bounded = collectChangedSymbols({ files, maxChangedSymbols: 2 })

    expect(bounded.symbols).toHaveLength(2)
    expect(bounded.truncated).toBe(true)
    expect(collect(files).truncated).toBe(false)
  })

  test('normalizes liberal path input so facts and files still pair up', () => {
    const result = collect([
      {
        path: './src\\service.ts',
        content: 'export const value = 1',
        changeKind: 'modified',
        hunks: wholeFileHunk(1)
      }
    ])

    expect(result.symbols.map((symbol) => symbol.path)).toEqual([
      'src/service.ts'
    ])
  })
})
