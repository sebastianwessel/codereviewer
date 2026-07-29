import { describe, expect, test } from 'vitest'
import { declarationSpanAt, toSourceLines } from './declaration-span.js'
import {
  declarationTraitKey,
  extractDeclarationTraits,
  isComparableDeclarationHeader
} from './declaration-shape.js'

const traitKeysOf = (source: string, startLine = 1): readonly string[] => {
  const lines = toSourceLines(source)
  const span = declarationSpanAt(lines, startLine)

  if (span === undefined) {
    throw new Error('expected a span')
  }

  const headerName = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*[(=:]/u.exec(
    lines[startLine - 1] ?? ''
  )

  return extractDeclarationTraits({
    lines,
    span,
    declarationName: headerName?.[1] ?? ''
  })
    .map(declarationTraitKey)
    .sort()
}

describe('declaration traits', () => {
  test('records a call, and the same call in a conditional as a guard as well', () => {
    const keys = traitKeysOf(
      [
        'function handler(request) {',
        '  if (!isAdmin(request)) {',
        '    deny()',
        '  }',
        '  return load()',
        '}'
      ].join('\n')
    )

    expect(keys).toEqual([
      'call-argument:isAdmin(request)',
      'call:deny',
      'call:isAdmin',
      'call:load',
      'guard:isAdmin'
    ])
  })

  test('records the first argument of a call when it is a simple token', () => {
    const keys = traitKeysOf(
      [
        'function handler(request) {',
        '  requireRole("admin")',
        '  audit(request, "read")',
        '  configure({ deep: true })',
        '}'
      ].join('\n')
    )

    // The object literal yields no argument trait: two peers passing different
    // expressions would otherwise be reported as sharing nothing useful.
    expect(keys).toEqual([
      'call-argument:audit(request)',
      'call-argument:requireRole("admin")',
      'call:audit',
      'call:configure',
      'call:requireRole'
    ])
  })

  test('normalizes a quoted first argument so quote style does not split a pattern', () => {
    expect(traitKeysOf("function f() {\n  role('admin')\n}")).toEqual(
      traitKeysOf('function f() {\n  role("admin")\n}')
    )
  })

  test('records a method call by its method name', () => {
    expect(traitKeysOf('function f() {\n  client.send(payload)\n}')).toContain(
      'call:send'
    )
  })

  test('ignores control-flow keywords that are followed by a parenthesis', () => {
    const keys = traitKeysOf(
      [
        'function f(a) {',
        '  while (ready(a)) {',
        '    switch (kind(a)) {}',
        '  }',
        '  return typeof(a)',
        '}'
      ].join('\n')
    )

    expect(keys).toEqual([
      'call-argument:kind(a)',
      'call-argument:ready(a)',
      'call:kind',
      'call:ready'
    ])
  })

  test('ignores its own name, so recursion is not a convention', () => {
    expect(traitKeysOf('function f(a) {\n  return f(a)\n}')).toEqual([])
  })

  test('never treats a name inside a comment or a string as a call', () => {
    const keys = traitKeysOf(
      [
        'function f() {',
        '  // every peer calls requireAuth(request) first',
        '  log("requireAuth(request)")',
        '}'
      ].join('\n')
    )

    // `log` is a real call and its literal argument is real code, so both are
    // recorded. `requireAuth` is named twice and is a call neither time.
    expect(keys).toEqual([
      'call-argument:log("requireAuth(request)")',
      'call:log'
    ])
    expect(keys).not.toContain('call:requireAuth')
    expect(keys).not.toContain('guard:requireAuth')
  })

  test('records the same call once however often the body repeats it', () => {
    expect(traitKeysOf('function f() {\n  log()\n  log()\n  log()\n}')).toEqual([
      'call:log'
    ])
  })

  test('extracts from a Python body, whose guard uses no parentheses', () => {
    expect(
      traitKeysOf(
        ['def handler(request):', '    if not is_admin(request):', '        raise Denied()', '    return load()'].join(
          '\n'
        )
      )
    ).toEqual([
      'call-argument:is_admin(request)',
      'call:Denied',
      'call:is_admin',
      'call:load',
      'guard:is_admin'
    ])
  })
})

describe('comparable declaration headers', () => {
  test('accepts a real header and rejects one that is entirely comment', () => {
    const lines = toSourceLines('export const f = () => 1\n// nothing here\n')

    expect(isComparableDeclarationHeader(lines, 1)).toBe(true)
    expect(isComparableDeclarationHeader(lines, 2)).toBe(false)
    expect(isComparableDeclarationHeader(lines, 99)).toBe(false)
  })
})
