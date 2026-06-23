import { describe, expect, test } from 'vitest'
import { extractPolyglotSignals } from './polyglot-signal-extractor.js'

const factNames = (
  language: 'python' | 'go' | 'rust' | 'java',
  content: string,
  kind?: 'import' | 'declaration' | 'public-symbol' | 'module'
): readonly string[] =>
  extractPolyglotSignals(language, [
    {
      path:
        language === 'python'
          ? 'src/app.py'
          : language === 'go'
            ? 'cmd/app.go'
            : language === 'rust'
              ? 'src/lib.rs'
              : 'src/App.java',
      content
    }
  ]).facts
    .filter((fact) => kind === undefined || fact.kind === kind)
    .map((fact) => fact.name)

describe('polyglot deterministic support signal extractor', () => {
  test.each([
    ['python', 'src/app.ts'],
    ['python', 'src/app.js'],
    ['go', 'src/app.ts'],
    ['go', 'src/app.js'],
    ['rust', 'src/app.ts'],
    ['rust', 'src/app.js'],
    ['java', 'src/app.ts'],
    ['java', 'src/app.js']
  ] as const)('rejects %s analysis for unowned path %s', (language, path) => {
    expect(() =>
      extractPolyglotSignals(language, [
        {
          path,
          content: 'export const value = ;'
        }
      ])
    ).toThrow(/Unsupported .* support signal path/u)
  })

  test('extracts multiline imports from AST nodes', () => {
    expect(
      factNames(
        'python',
        [
          'from package.sub import (',
          '    Alpha,',
          '    Beta as LocalBeta,',
          ')',
          'import os, sys as system'
        ].join('\n'),
        'import'
      )
    ).toEqual(expect.arrayContaining(['Alpha', 'LocalBeta', 'os', 'system']))

    expect(
      factNames(
        'go',
        ['package main', 'import (', '    "fmt"', '    alias "net/http"', ')'].join('\n'),
        'import'
      )
    ).toEqual(expect.arrayContaining(['fmt', 'alias']))

    expect(
      factNames(
        'rust',
        'use crate::{Alpha, beta::Gamma};',
        'import'
      )
    ).toEqual(expect.arrayContaining(['Alpha', 'Gamma']))
  })

  test('ignores fake facts inside comments and strings', () => {
    expect(
      factNames(
        'python',
        ['text = "class Fake: pass"', '# def commented(): pass', 'class Real:', '    pass'].join('\n')
      )
    ).not.toEqual(expect.arrayContaining(['Fake', 'commented']))

    expect(
      factNames(
        'go',
        ['package main', 'var text = "func Fake() {}"', '// func Commented() {}', 'func Real() {}'].join('\n')
      )
    ).not.toEqual(expect.arrayContaining(['Fake', 'Commented']))

    expect(
      factNames(
        'rust',
        ['let text = "pub fn fake() {}";', '// pub struct Commented;', 'pub struct Real;'].join('\n')
      )
    ).not.toEqual(expect.arrayContaining(['fake', 'Commented']))

    expect(
      factNames(
        'java',
        ['class Text { String text = "public class Fake {}"; }', '// public class Commented {}', 'public class Real {}'].join('\n')
      )
    ).not.toEqual(expect.arrayContaining(['Fake', 'Commented']))
  })

  test('captures nested declarations from AST traversal', () => {
    expect(
      factNames(
        'python',
        ['def outer():', '    def inner():', '        pass'].join('\n'),
        'declaration'
      )
    ).toEqual(expect.arrayContaining(['outer', 'inner']))

    expect(
      factNames(
        'java',
        ['public class Outer {', '    public static class Inner {}', '}'].join('\n'),
        'declaration'
      )
    ).toEqual(expect.arrayContaining(['Outer', 'Inner']))
  })

  test('emits diagnostics and no facts for syntax error nodes', () => {
    for (const [language, content] of [
      ['python', 'class :\n    pass'],
      ['go', 'package main\nfunc {'],
      ['rust', 'pub fn ( {}'],
      ['java', 'public class {']
    ] as const) {
      const result = extractPolyglotSignals(language, [
        {
          path:
            language === 'python'
              ? 'src/app.py'
              : language === 'go'
                ? 'cmd/app.go'
                : language === 'rust'
                  ? 'src/lib.rs'
                  : 'src/App.java',
          content
        }
      ])

      expect(result.facts).toEqual([])
      expect(result.evidence).toEqual([
        expect.objectContaining({
          kind: 'diagnostic',
          source: `${language}-support-signal`,
          redactionApplied: true
        })
      ])
    }
  })

  // The benchmark-fitted Go rule-evidence heuristics (nil-checked Error log,
  // BuildIndex cache lock, cache iteration without read lock) were removed
  // because they hardcoded benchmark-specific identifiers (eval-gaming). The
  // polyglot extractor now emits only generic facts and parse diagnostics, so
  // benchmark-shaped Go source must not produce any rule evidence.
  test('does not emit Go rule evidence for benchmark-shaped source', () => {
    const result = extractPolyglotSignals('go', [
      {
        path: 'pkg/storage/unified/search/bleve.go',
        content: [
          'package search',
          'func (b *bleveBackend) BuildIndex() {',
          '  index := createIndex()',
          '  idx := &bleveIndex{index: index}',
          '  builder(idx)',
          '  idx.Flush()',
          '  b.cacheMu.Lock()',
          '  b.cache[key] = idx',
          '  b.cacheMu.Unlock()',
          '}'
        ].join('\n')
      }
    ])

    expect(result.evidence).toEqual([])
  })
})
