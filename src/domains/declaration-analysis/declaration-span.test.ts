import { describe, expect, test } from 'vitest'
import {
  blankNonCode,
  codeLinesOfSpan,
  declarationSpanAt,
  toSourceLines
} from './declaration-span.js'

describe('declaration span', () => {
  test('bounds a brace-language body by indentation and excludes the closing brace', () => {
    const lines = toSourceLines(
      [
        'export const handler = (request) => {',
        '  requireAuth(request)',
        '  return 1',
        '}',
        '',
        'export const other = () => 2'
      ].join('\n')
    )

    expect(declarationSpanAt(lines, 1)).toEqual({
      startLine: 1,
      endLine: 3,
      indentation: 0
    })
  })

  test('bounds an indentation-scoped body, and a blank line inside it does not end it', () => {
    const lines = toSourceLines(
      [
        'def handler(request):',
        '    require_auth(request)',
        '',
        '    return 1',
        '',
        'def other():',
        '    return 2'
      ].join('\n')
    )

    expect(declarationSpanAt(lines, 1)).toEqual({
      startLine: 1,
      endLine: 4,
      indentation: 0
    })
    expect(declarationSpanAt(lines, 6)?.endLine).toBe(7)
  })

  test('a nested declaration keeps its own deeper indentation', () => {
    const lines = toSourceLines(
      ['class A:', '    def m(self):', '        return 1'].join('\n')
    )

    expect(declarationSpanAt(lines, 1)).toEqual({
      startLine: 1,
      endLine: 3,
      indentation: 0
    })
    expect(declarationSpanAt(lines, 2)).toEqual({
      startLine: 2,
      endLine: 3,
      indentation: 4
    })
  })

  test('a one-line declaration spans exactly its header line', () => {
    const lines = toSourceLines('export const value = 1\nexport const next = 2')

    expect(declarationSpanAt(lines, 1)?.endLine).toBe(1)
  })

  test('a line beyond the file has no span', () => {
    expect(declarationSpanAt(toSourceLines('a\n'), 99)).toBeUndefined()
  })
})

describe('non-code blanking', () => {
  test('blanks line comments in both comment styles without moving columns', () => {
    expect(blankNonCode('call(x) // then requireAuth(x)').text).toBe(
      'call(x)                       '
    )
    expect(blankNonCode('call(x) # then require_auth(x)').text).toBe(
      'call(x)                       '
    )
  })

  test('blanks string contents but keeps the delimiters', () => {
    const blanked = blankNonCode('log("call requireAuth(x) first")').text

    expect(blanked).toBe(`log("${' '.repeat(25)}")`)
    // Column positions are preserved, which is what lets a caller reason about a
    // blanked line and the original interchangeably.
    expect(blanked).toHaveLength('log("call requireAuth(x) first")'.length)
  })

  test('an escaped quote does not close a string', () => {
    expect(blankNonCode('log("a\\"b(") + call()').text).toBe(
      `log("${' '.repeat(5)}") + call()`
    )
  })

  test('reports an unterminated block comment so the caller can carry the state', () => {
    const opened = blankNonCode('/* requireAuth(x)')

    expect(opened.insideBlockComment).toBe(true)
    expect(opened.text.trim()).toBe('')
  })

  test('a multi-line comment inside a body contributes nothing to the code lines', () => {
    const lines = toSourceLines(
      [
        'function f() {',
        '  /* peers here',
        '     call requireAuth(x) */',
        '  doWork()',
        '}'
      ].join('\n')
    )
    const code = codeLinesOfSpan(lines, {
      startLine: 1,
      endLine: 4,
      indentation: 0
    })

    expect(code.map((line) => line.trim())).toEqual([
      'function f() {',
      '',
      '',
      'doWork()'
    ])
  })
})
