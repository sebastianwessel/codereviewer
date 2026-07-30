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

  test('carries a multi-line signature into the body instead of stopping at it', () => {
    // Regression. Indentation alone ended the span at `): void => {`, which sits
    // back at the header's column, so the span was the parameter list and the
    // body contributed no traits at all. `peer-sets.ts` drops a trait-less
    // declaration, so every function written in this style vanished from the
    // conformance capability. Measured on this repository's own `src/cli/args.ts`:
    // nine of ten exported declarations extracted ZERO traits.
    const lines = toSourceLines(
      [
        'export const handle = (', //        1
        '  request: Request,', //             2
        '  options: readonly string[]', //    3
        '): void => {', //                    4
        '  requireAuth(request)', //          5
        '  persist(request)', //              6
        '}', //                               7
        '', //                                8
        'export const other = () => 2' //     9
      ].join('\n')
    )

    // Through the wrapped signature and across the whole body, still excluding
    // the closing brace at the header's column.
    expect(declarationSpanAt(lines, 1)).toEqual({
      startLine: 1,
      endLine: 6,
      indentation: 0
    })
  })

  test('a brace on the header line does not swallow the closing brace', () => {
    // The counterpart risk: counting `{` as a signature bracket would carry the
    // span past the body and include the closing brace the indentation rule
    // exists to exclude. Only `(` and `[` continue a signature.
    const lines = toSourceLines(
      ['export const f = (a) => {', '  use(a)', '}', 'const after = 1'].join('\n')
    )

    expect(declarationSpanAt(lines, 1)).toEqual({
      startLine: 1,
      endLine: 2,
      indentation: 0
    })
  })

  test('a wrapped signature whose brackets sit inside a string or comment is not misread', () => {
    // The depth count runs over blanked text, so an unbalanced bracket in prose
    // or a literal cannot hold the header open and run the span to end of file.
    const lines = toSourceLines(
      [
        'export const g = (a) => {', //          1
        '  const sql = "SELECT ((("', //          2
        '  // an unclosed ( in prose', //         3
        '  return run(sql)', //                   4
        '}', //                                   5
        'const after = 1' //                      6
      ].join('\n')
    )

    expect(declarationSpanAt(lines, 1)).toEqual({
      startLine: 1,
      endLine: 4,
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
