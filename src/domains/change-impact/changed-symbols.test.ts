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
      result.symbols.map((symbol) => [symbol.name, symbol.changeKind])
    ).toEqual([
      ['removedApi', 'deleted'],
      ['alsoRemoved', 'deleted']
    ])
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
