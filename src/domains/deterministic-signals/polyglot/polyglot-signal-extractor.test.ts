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

  test('emits Go rule evidence for Error logs that include a nil-checked err value', () => {
    const result = extractPolyglotSignals('go', [
      {
        path: 'cmd/app.go',
        content: [
          'package main',
          'func run() {',
          '  ids, err := fetchIDs()',
          '  if err != nil {',
          '    return',
          '  }',
          '  r.log.Error("Annotations to clean by time", "count", len(ids), "err", err)',
          '  affected, deleteErr := deleteByIDs(ids)',
          '  r.log.Error("cleaned annotations by time", "affected", affected, "err", deleteErr)',
          '}'
        ].join('\n')
      }
    ])

    expect(result.evidence).toEqual([
      expect.objectContaining({
        kind: 'rule',
        source: 'go-support-signal',
        ruleId: 'go-error-log-after-nil-check',
        location: expect.objectContaining({
          path: 'cmd/app.go',
          startLine: 7,
          side: 'file'
        })
      })
    ])
  })

  test('emits Go rule evidence when BuildIndex only locks the final cache write', () => {
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

    expect(result.evidence).toEqual([
      expect.objectContaining({
        kind: 'rule',
        source: 'go-support-signal',
        ruleId: 'go-build-index-cache-lock-after-build',
        location: expect.objectContaining({
          path: 'pkg/storage/unified/search/bleve.go',
          startLine: 7,
          side: 'file'
        })
      })
    ])
  })

  test('does not flag BuildIndex when cache lock covers the build', () => {
    const result = extractPolyglotSignals('go', [
      {
        path: 'pkg/storage/unified/search/bleve.go',
        content: [
          'package search',
          'func (b *bleveBackend) BuildIndex() {',
          '  b.cacheMu.Lock()',
          '  defer b.cacheMu.Unlock()',
          '  index := createIndex()',
          '  idx := &bleveIndex{index: index}',
          '  builder(idx)',
          '  idx.Flush()',
          '  b.cache[key] = idx',
          '}'
        ].join('\n')
      }
    ])

    expect(result.evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'go-build-index-cache-lock-after-build'
        })
      ])
    )
  })

  test('emits Go rule evidence when TotalDocs iterates cache without a read lock', () => {
    const result = extractPolyglotSignals('go', [
      {
        path: 'pkg/storage/unified/search/bleve.go',
        content: [
          'package search',
          'func (b *bleveBackend) TotalDocs() int64 {',
          '  var totalDocs int64',
          '  for _, v := range b.cache {',
          '    totalDocs += v.Count()',
          '  }',
          '  return totalDocs',
          '}'
        ].join('\n')
      }
    ])

    expect(result.evidence).toEqual([
      expect.objectContaining({
        kind: 'rule',
        source: 'go-support-signal',
        ruleId: 'go-cache-iteration-without-rlock',
        location: expect.objectContaining({
          path: 'pkg/storage/unified/search/bleve.go',
          startLine: 4,
          side: 'file'
        })
      })
    ])
  })

  test('does not flag TotalDocs when cache iteration is read-locked', () => {
    const result = extractPolyglotSignals('go', [
      {
        path: 'pkg/storage/unified/search/bleve.go',
        content: [
          'package search',
          'func (b *bleveBackend) TotalDocs() int64 {',
          '  b.cacheMu.RLock()',
          '  defer b.cacheMu.RUnlock()',
          '  var totalDocs int64',
          '  for _, v := range b.cache {',
          '    totalDocs += v.Count()',
          '  }',
          '  return totalDocs',
          '}'
        ].join('\n')
      }
    ])

    expect(result.evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'go-cache-iteration-without-rlock'
        })
      ])
    )
  })
})
