import { describe, expect, test } from 'vitest'
import { extractPolyglotSignals } from './polyglot-signal-extractor.js'

const languageSamplePaths = {
  python: 'src/app.py',
  go: 'cmd/app.go',
  rust: 'src/lib.rs',
  java: 'src/App.java',
  ruby: 'lib/app.rb'
} as const

const factNames = (
  language: keyof typeof languageSamplePaths,
  content: string,
  kind?: 'import' | 'declaration' | 'public-symbol' | 'module'
): readonly string[] =>
  extractPolyglotSignals(language, [
    {
      path: languageSamplePaths[language],
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

  // A Ruby definition is only a symbol other code can depend on when the file's
  // own structure puts it there. Inside a block or another method body it is a
  // STATEMENT: it does not exist until that body runs, and it attaches to whatever
  // `self` holds at that moment, so nothing outside can reference it by name.
  //
  // Reported as a `public-symbol` it was actively harmful rather than merely
  // useless. `def self.req` inside a test block seeded `req` as a changed public
  // symbol, and the blast radius came back as 22 unrelated `req` locals from all
  // over the codebase — a confident, entirely fictional dependent list, because a
  // throwaway block-local name is exactly the kind that is reused everywhere.
  //
  // A namespace body is not a runtime scope: `class`, `module` and `class << self`
  // are how a file states what it provides, so definitions inside them stay.
  test('drops Ruby definitions created by running a block or a method body', () => {
    const content = [
      'class Service',
      '  class << self',
      '    def singleton_helper',
      '      1',
      '    end',
      '  end',
      '',
      '  def public_thing',
      '    def rebound_at_runtime',
      '      2',
      '    end',
      '  end',
      'end',
      '',
      'Thing.configure do |c|',
      '  def self.req(headers)',
      '    headers',
      '  end',
      '',
      '  class Ephemeral',
      '  end',
      'end',
      '',
      '[1].each { def brace_scoped; end }'
    ].join('\n')

    expect(factNames('ruby', content, 'declaration')).toEqual([
      'Service',
      'singleton_helper',
      'public_thing'
    ])
    expect(factNames('ruby', content, 'public-symbol')).toEqual([
      'Service',
      'singleton_helper',
      'public_thing'
    ])
  })

  // A Rust file is not test code because it carries tests. The dominant unit-test
  // form puts them in an inline `#[cfg(test)] mod tests` inside the very file they
  // exercise, so path and content both describe production AND test at once and
  // only the declaration's position separates them.
  //
  // Getting this wrong at file granularity was expensive in both directions. Four
  // production files under `axum-extra/src/response/` were classified as tests
  // wholesale and dropped from conformance, production declarations included,
  // which shrank the peer denominator until sub-majority patterns read as
  // majorities. The file next to them was missed the other way: its tests are
  // `#[tokio::test]`, which no `#[test]` substring rule sees, so ten async test
  // functions were compared against production methods as their peers.
  //
  // `#[cfg(test)]` on the module is what fixes both at once: it covers whatever
  // attribute the declarations beneath it carry, so no attribute-macro spelling
  // has to be enumerated.
  test('drops Rust declarations the crate compiles only for its test build', () => {
    const content = [
      'pub fn production() -> u32 {',
      '    1',
      '}',
      '',
      '#[cfg(test)]',
      'mod tests {',
      '    use super::*;',
      '',
      '    #[test]',
      '    fn plain_test() {}',
      '',
      '    #[tokio::test]',
      '    async fn async_test() {}',
      '',
      '    // Carries no test attribute of its own, and is still test-side.',
      '    fn helper() -> u32 {',
      '        2',
      '    }',
      '',
      '    struct Fixture;',
      '',
      '    mod deeper {',
      '        fn nested_helper() {}',
      '    }',
      '}',
      '',
      '// A test function written outside a `cfg(test)` module is named by the',
      '// built-in attribute on the function itself.',
      '#[test]',
      'fn loose_test() {}',
      '',
      '#[cfg(not(test))]',
      'pub fn production_only() {}'
    ].join('\n')

    expect(factNames('rust', content, 'declaration')).toEqual([
      'production',
      'production_only'
    ])
    expect(factNames('rust', content, 'public-symbol')).toEqual([
      'production',
      'production_only'
    ])
  })

  // The suppression is about the production SURFACE — what the file declares — not
  // about everything written inside a test module. A `use` there is still an edge
  // this file has, and retrieval follows those edges to put a definition in front
  // of a reviewer who is reading the test.
  test('keeps Rust imports and the module itself inside a test build scope', () => {
    const content = [
      '#[cfg(test)]',
      'mod tests {',
      '    use crate::store::Store;',
      '}'
    ].join('\n')

    expect(factNames('rust', content, 'import')).toEqual(['Store'])
    expect(factNames('rust', content, 'module')).toEqual(['tests'])
  })

  // The guard above is about DEFINITIONS, not about position. A `require` runs
  // wherever it sits, and the file it pulls in is a real edge from this file even
  // when the call is nested inside a block.
  test('keeps Ruby requires nested inside a block', () => {
    expect(
      factNames(
        'ruby',
        ['Thing.configure do', '  require "rack/utils"', 'end'].join('\n'),
        'import'
      )
    ).toEqual(['utils'])
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
