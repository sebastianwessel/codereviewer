import { describe, expect, test } from 'vitest'
import {
  extractSymbolBody,
  symbolBodyBounds,
  type SymbolBodyExtraction
} from './symbol-body.js'

const MAX_BYTES = 4 * 1024

// A realistic TypeScript module: the target callee has nested blocks, a nested
// arrow function, an object literal and a trailing sibling export that must not
// be swallowed.
const typescriptSource = [
  "import { readFile } from 'node:fs/promises'",
  '',
  'export const resolveBudget = (',
  '  requested: number,',
  '  limits: { readonly hard: number; readonly soft: number }',
  '): number => {',
  '  if (requested <= 0) {',
  '    return 0',
  '  }',
  '',
  '  const clamp = (value: number): number => {',
  '    return Math.min(value, limits.hard)',
  '  }',
  '',
  '  const table = {',
  '    soft: limits.soft,',
  '    hard: limits.hard',
  '  }',
  '',
  '  return clamp(Math.max(requested, table.soft))',
  '}',
  '',
  'export const unrelated = (): string => readFile.name',
  ''
].join('\n')

// A realistic Python module: decorated function, docstring containing braces,
// nested blocks, then a following top-level statement.
const pythonSource = [
  'import json',
  '',
  '',
  '@retry(times=3)',
  'def load_manifest(path, defaults=None):',
  '    """Load a manifest.',
  '',
  '    Returns a dict shaped like {"name": str, "files": list}.',
  '    """',
  '    if defaults is None:',
  '        defaults = {}',
  '',
  '    with open(path) as handle:',
  '        data = json.load(handle)',
  '',
  '    for key, value in defaults.items():',
  '        data.setdefault(key, value)',
  '',
  '    return data',
  '',
  '',
  'MANIFEST_CACHE = {}',
  ''
].join('\n')

// Java: opening brace on the line after the signature, plus a nested class-like
// block and a string containing a closing brace.
const javaSource = [
  'package com.example.review;',
  '',
  'public final class Budgets {',
  '  public static int resolve(int requested, int hard)',
  '  {',
  '    if (requested <= 0)',
  '    {',
  '      return 0;',
  '    }',
  '',
  '    String template = "limit reached }";',
  '    // a closing brace in a comment: }',
  '    return Math.min(requested, hard);',
  '  }',
  '',
  '  public static int floorValue(int value) { return Math.max(0, value); }',
  '}',
  ''
].join('\n')

describe('extractSymbolBody', () => {
  test('captures a complete brace-delimited body including nested blocks', () => {
    const extraction = extractSymbolBody({
      path: 'src/budget.ts',
      content: typescriptSource,
      name: 'resolveBudget',
      declarationLine: 3,
      maxBytes: MAX_BYTES
    })

    expect(extraction).toBeDefined()
    const body = extraction as SymbolBodyExtraction
    expect(body.startLine).toBe(3)
    // The body closes on line 21 ('}'), not at the first nested '}' on line 9.
    expect(body.endLine).toBe(21)
    expect(body.truncated).toBe(false)
    expect(body.content).toContain('11:   const clamp')
    expect(body.content).toContain('20:   return clamp')
    expect(body.content.split('\n').at(-1)).toBe('21: }')
    // The next sibling export is outside the body.
    expect(body.content).not.toContain('unrelated')
  })

  test('line-numbers the body as "<line>: <text>" starting at the declaration', () => {
    const extraction = extractSymbolBody({
      path: 'src/budget.ts',
      content: typescriptSource,
      name: 'resolveBudget',
      declarationLine: 3,
      maxBytes: MAX_BYTES
    })

    expect(extraction?.content.split('\n')[0]).toBe(
      '3: export const resolveBudget = ('
    )
    expect(extraction?.content).toMatch(/^\d+: /mu)
  })

  test('captures a Python body by indentation and stops at the next top-level statement', () => {
    const extraction = extractSymbolBody({
      path: 'tools/manifest.py',
      content: pythonSource,
      name: 'load_manifest',
      declarationLine: 5,
      maxBytes: MAX_BYTES
    })

    expect(extraction).toBeDefined()
    const body = extraction as SymbolBodyExtraction
    expect(body.startLine).toBe(5)
    // Last indented line is 'return data' (line 19); the blank lines and the
    // following module-level assignment are not part of the body.
    expect(body.endLine).toBe(19)
    expect(body.truncated).toBe(false)
    expect(body.content).toContain('19:     return data')
    expect(body.content).not.toContain('MANIFEST_CACHE')
    // The docstring's brace-bearing prose is inside the captured body and does
    // not terminate it.
    expect(body.content).toContain('files": list}')
  })

  test('handles an opening brace on the line after the declaration', () => {
    const extraction = extractSymbolBody({
      path: 'src/main/java/com/example/review/Budgets.java',
      content: javaSource,
      name: 'resolve',
      declarationLine: 4,
      maxBytes: MAX_BYTES
    })

    expect(extraction).toBeDefined()
    const body = extraction as SymbolBodyExtraction
    expect(body.startLine).toBe(4)
    // Closes at the method's own '}' on line 14, not the nested one on line 9.
    expect(body.endLine).toBe(14)
    expect(body.truncated).toBe(false)
    expect(body.content).toContain('5:   {')
    expect(body.content).not.toContain('floorValue')
  })

  test('a brace inside a string literal or comment neither ends nor extends the capture', () => {
    // Deliberately unbalanced: the comment carries a lone '}' and the strings
    // carry a lone '{' and a lone '}'. Counting them would close the body at
    // line 9 instead of line 11.
    const goSource = [
      'package review',
      '',
      'func FormatReport(count int) string {',
      '\tif count == 0 {',
      '\t\t// a stray closing brace in a comment: }',
      '\t\treturn "empty {"',
      '\t}',
      '',
      '\tprefix := "closing brace }"',
      '\treturn prefix',
      '}',
      '',
      'func Unrelated() string { return "" }',
      ''
    ].join('\n')

    const extraction = extractSymbolBody({
      path: 'internal/review/report.go',
      content: goSource,
      name: 'FormatReport',
      declarationLine: 3,
      maxBytes: MAX_BYTES
    })

    expect(extraction).toBeDefined()
    const body = extraction as SymbolBodyExtraction
    expect(body.endLine).toBe(11)
    expect(body.truncated).toBe(false)
    expect(body.content).toContain('9: \tprefix := "closing brace }"')
    expect(body.content).not.toContain('Unrelated')
  })

  test('an apostrophe or unterminated quote cannot swallow the rest of the file', () => {
    // The apostrophe in the comment and the '{' inside the string must both be
    // inert. A quote allowed to span lines would reach the "'}'" on line 8 and
    // mask the body's own closing brace on line 5.
    const javascriptSource = [
      'export function summarize(entries) {',
      "  // Ledger's prose: an apostrophe in a comment must not open a string.",
      '  const marker = "it\'s { unbalanced"',
      '  return `${marker}: ${entries.length}`',
      '}',
      '',
      'export function unrelated() {',
      "  return '}'",
      '}',
      ''
    ].join('\n')

    const extraction = extractSymbolBody({
      path: 'src/summarize.js',
      content: javascriptSource,
      name: 'summarize',
      declarationLine: 1,
      maxBytes: MAX_BYTES
    })

    expect(extraction).toBeDefined()
    const body = extraction as SymbolBodyExtraction
    expect(body.endLine).toBe(5)
    expect(body.truncated).toBe(false)
    // The template literal's `${...}` braces are masked too, so they neither
    // open nor close a block.
    expect(body.content).toContain('4:   return `${marker}')
    expect(body.content).not.toContain('unrelated')
  })

  test('captures a Ruby method by indentation up to its own `end`', () => {
    const rubySource = [
      'class Ledger',
      '  def total(entries)',
      '    entries.reduce(0) { |acc, entry| acc + entry.amount }',
      '  end',
      '',
      '  def unrelated',
      '    0',
      '  end',
      'end',
      ''
    ].join('\n')

    const extraction = extractSymbolBody({
      path: 'app/models/ledger.rb',
      content: rubySource,
      name: 'total',
      declarationLine: 2,
      maxBytes: MAX_BYTES
    })

    expect(extraction).toBeDefined()
    const body = extraction as SymbolBodyExtraction
    // The block braces on line 3 are a body statement, not the method's opener,
    // so the capture runs to the `end` at the declaration's own indentation.
    expect(body.endLine).toBe(4)
    expect(body.truncated).toBe(false)
    expect(body.content).not.toContain('unrelated')
  })

  test('a body that never closes stops at the line backstop and is truncated', () => {
    const filler = Array.from(
      { length: symbolBodyBounds.maxBodyLines + 50 },
      (_value, index) => `  step(${index})`
    )
    const runaway = ['function runaway() {', ...filler, '}', ''].join('\n')

    const extraction = extractSymbolBody({
      path: 'src/runaway.js',
      content: runaway,
      name: 'runaway',
      declarationLine: 1,
      maxBytes: 1024 * 1024
    })

    expect(extraction).toBeDefined()
    const body = extraction as SymbolBodyExtraction
    expect(body.truncated).toBe(true)
    expect(body.endLine).toBe(symbolBodyBounds.maxBodyLines)
    expect(body.content.split('\n')).toHaveLength(
      symbolBodyBounds.maxBodyLines
    )
  })

  test('the byte cap truncates the emitted content and reports it', () => {
    const capped = extractSymbolBody({
      path: 'src/budget.ts',
      content: typescriptSource,
      name: 'resolveBudget',
      declarationLine: 3,
      maxBytes: 64
    })

    expect(capped).toBeDefined()
    const body = capped as SymbolBodyExtraction
    expect(body.truncated).toBe(true)
    expect(Buffer.byteLength(body.content)).toBeLessThanOrEqual(64)
    // endLine describes what the content actually carries.
    expect(body.endLine).toBeLessThan(21)
    expect(body.endLine).toBeGreaterThanOrEqual(body.startLine)
    expect(body.content.startsWith('3: export const resolveBudget = (')).toBe(
      true
    )
  })

  test('a non-positive byte budget yields no extraction', () => {
    expect(
      extractSymbolBody({
        path: 'src/budget.ts',
        content: typescriptSource,
        name: 'resolveBudget',
        declarationLine: 3,
        maxBytes: 0
      })
    ).toBeUndefined()
  })

  test('an out-of-range declaration line yields no extraction', () => {
    for (const declarationLine of [0, -3, 10_000]) {
      expect(
        extractSymbolBody({
          path: 'src/budget.ts',
          content: typescriptSource,
          name: 'resolveBudget',
          declarationLine,
          maxBytes: MAX_BYTES
        })
      ).toBeUndefined()
    }
  })

  test('a declaration line that does not declare the name yields no extraction', () => {
    // A stale fact pointing one line off must drop the symbol rather than quote
    // an unrelated chunk.
    expect(
      extractSymbolBody({
        path: 'src/budget.ts',
        content: typescriptSource,
        name: 'resolveBudget',
        declarationLine: 4,
        maxBytes: MAX_BYTES
      })
    ).toBeUndefined()

    // A partial identifier match is not a declaration either.
    expect(
      extractSymbolBody({
        path: 'src/budget.ts',
        content: typescriptSource,
        name: 'resolve',
        declarationLine: 3,
        maxBytes: MAX_BYTES
      })
    ).toBeUndefined()
  })

  test('accepts a qualified name whose final segment declares the symbol', () => {
    const extraction = extractSymbolBody({
      path: 'src/main/java/com/example/review/Budgets.java',
      content: javaSource,
      name: 'Budgets.resolve',
      declarationLine: 4,
      maxBytes: MAX_BYTES
    })

    expect(extraction?.name).toBe('Budgets.resolve')
    expect(extraction?.endLine).toBe(14)
  })

  test('captures a Rust body whose signature carries lifetimes', () => {
    const rustSource = [
      'pub struct Cursor;',
      '',
      "pub fn first_token<'a>(source: &'a str, sep: &'a str) -> &'a str {",
      '    match source.find(sep) {',
      '        Some(index) => &source[..index],',
      '        None => source,',
      '    }',
      '}',
      '',
      'pub fn unrelated() -> usize { 0 }',
      ''
    ].join('\n')

    const extraction = extractSymbolBody({
      path: 'src/lexer.rs',
      content: rustSource,
      name: 'first_token',
      declarationLine: 3,
      maxBytes: MAX_BYTES
    })

    expect(extraction).toBeDefined()
    const body = extraction as SymbolBodyExtraction
    expect(body.endLine).toBe(8)
    expect(body.content).toContain('7:     }')
    expect(body.content).not.toContain('unrelated')
  })

  test('captures a PHP method with the brace on its own line', () => {
    const phpSource = [
      '<?php',
      '',
      'final class Ledger',
      '{',
      '    public function total(array $entries): int',
      '    {',
      '        $sum = 0;',
      '',
      '        foreach ($entries as $entry) {',
      '            $sum += $entry->amount; # running total',
      '        }',
      '',
      '        return $sum;',
      '    }',
      '',
      '    public function unrelated(): int',
      '    {',
      '        return 0;',
      '    }',
      '}',
      ''
    ].join('\n')

    const extraction = extractSymbolBody({
      path: 'src/Ledger.php',
      content: phpSource,
      name: 'total',
      declarationLine: 5,
      maxBytes: MAX_BYTES
    })

    expect(extraction?.endLine).toBe(14)
    expect(extraction?.truncated).toBe(false)
    expect(extraction?.content).not.toContain('unrelated')
  })

  test('is deterministic: identical input yields identical output', () => {
    const inputs = [
      {
        path: 'src/budget.ts',
        content: typescriptSource,
        name: 'resolveBudget',
        declarationLine: 3,
        maxBytes: MAX_BYTES
      },
      {
        path: 'tools/manifest.py',
        content: pythonSource,
        name: 'load_manifest',
        declarationLine: 5,
        maxBytes: 120
      }
    ] as const

    for (const input of inputs) {
      expect(extractSymbolBody(input)).toStrictEqual(extractSymbolBody(input))
    }
  })
})
