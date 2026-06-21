import { describe, expect, test } from 'vitest'
import { analyzePolyglotFiles } from './polyglot-analyzer.js'

const factNames = (
  language: 'python' | 'go' | 'rust' | 'java',
  content: string,
  kind?: 'import' | 'declaration' | 'public-symbol' | 'module'
): readonly string[] =>
  analyzePolyglotFiles(language, [
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

describe('polyglot language analyzer', () => {
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
      analyzePolyglotFiles(language, [
        {
          path,
          content: 'export const value = ;'
        }
      ])
    ).toThrow(/Unsupported .* analyzer path/u)
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
      const result = analyzePolyglotFiles(language, [
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
          source: `${language}-analyzer`,
          redactionApplied: true
        })
      ])
    }
  })
})
