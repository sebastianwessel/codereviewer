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
      'call-argument:isAdmin(request)@surface/exit',
      'call:deny@surface/exit',
      'call:isAdmin@surface/exit',
      'call:load@surface/exit',
      'guard:isAdmin@surface/exit'
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
      'call-argument:audit(request)@surface/exit',
      'call-argument:requireRole("admin")@surface/exit',
      'call:audit@surface/exit',
      'call:configure@surface/exit',
      'call:requireRole@surface/exit'
    ])
  })

  test('normalizes a quoted first argument so quote style does not split a pattern', () => {
    expect(traitKeysOf("function f() {\n  role('admin')\n}")).toEqual(
      traitKeysOf('function f() {\n  role("admin")\n}')
    )
  })

  test('records a method call by its method name', () => {
    expect(traitKeysOf('function f() {\n  client.send(payload)\n}')).toContain(
      'call:send@surface/exit'
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
      'call-argument:kind(a)@surface/exit',
      'call-argument:ready(a)@surface/exit',
      'call:kind@surface/exit',
      'call:ready@surface/exit'
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
      'call-argument:log("requireAuth(request)")@surface/exit',
      'call:log@surface/exit'
    ])
    expect(keys.some((key) => key.startsWith('call:requireAuth'))).toBe(false)
    expect(keys.some((key) => key.startsWith('guard:requireAuth'))).toBe(false)
  })

  test('records the same call once however often the body repeats it at one position', () => {
    expect(traitKeysOf('function f() {\n  log()\n  log()\n  log()\n}')).toEqual([
      'call:log@surface/exit'
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
      'call-argument:is_admin(request)@surface/exit',
      'call:Denied@surface/exit',
      'call:is_admin@surface/exit',
      'call:load@surface/exit',
      'guard:is_admin@surface/exit'
    ])
  })
})

// Spec 24, "Positional Traits": a trait carries where it sits, so the same symbol
// at materially different positions is not the same trait. Both dimensions come
// from indentation; nothing here parses.
describe('positional traits', () => {
  test('separates a symbol used deep inside a nested block from the same symbol on the exit path', () => {
    const onExitPath = traitKeysOf(
      [
        'function parse(value) {',
        '  if (isKnown(value)) {',
        '    return convert(value)',
        '  }',
        '  return fail(value)',
        '}'
      ].join('\n')
    )
    const nested = traitKeysOf(
      [
        'function parse(value) {',
        '  for (const item of value) {',
        '    if (!isText(item)) {',
        '      return fail(item)',
        '    }',
        '    keep(item)',
        '  }',
        '  return done()',
        '}'
      ].join('\n')
    )

    expect(onExitPath).toContain('call:fail@surface/exit')
    expect(nested).toContain('call:fail@nested/interior')
    // The whole point: a set-membership comparison would have called these equal.
    expect(nested).not.toContain('call:fail@surface/exit')
  })

  test('a nested block that ends the declaration is not the same position as one it continues past', () => {
    const trailing = traitKeysOf(
      [
        'function walk(items) {',
        '  for (const item of items) {',
        '    if (item.ready) {',
        '      release(item)',
        '    }',
        '  }',
        '}'
      ].join('\n')
    )
    const interrupted = traitKeysOf(
      [
        'function walk(items) {',
        '  for (const item of items) {',
        '    if (item.ready) {',
        '      release(item)',
        '    }',
        '  }',
        '  return report(items)',
        '}'
      ].join('\n')
    )

    expect(trailing).toContain('call:release@nested/exit')
    expect(interrupted).toContain('call:release@nested/interior')
  })

  test('the same shape indented with tabs and with spaces yields the same positions', () => {
    const spaces = traitKeysOf(
      [
        'function parse(value) {',
        '  for (const item of value) {',
        '    if (!ok(item)) {',
        '      fail(item)',
        '    }',
        '  }',
        '  return done()',
        '}'
      ].join('\n')
    )
    const tabs = traitKeysOf(
      [
        'function parse(value) {',
        '\tfor (const item of value) {',
        '\t\tif (!ok(item)) {',
        '\t\t\tfail(item)',
        '\t\t}',
        '\t}',
        '\treturn done()',
        '}'
      ].join('\n')
    )

    expect(tabs).toEqual(spaces)
  })

  // The band is deliberately wide enough to swallow formatting. Indentation cannot
  // distinguish a nested block from a wrapped expression, and this repository's own
  // schema builders wrap a fluent chain onto the next line — a finer split would
  // report code style as divergence, which it was measured doing.
  test('a wrapped continuation line is the same position as the unwrapped form', () => {
    const inline = traitKeysOf(
      ['const Schema = build({', '  path: text().min(1)', '})'].join('\n')
    )
    const wrapped = traitKeysOf(
      [
        'const Schema = build({',
        '  path: text',
        '    .min(1)',
        '})'
      ].join('\n')
    )

    expect(inline).toContain('call:min@surface/exit')
    expect(wrapped).toContain('call:min@surface/exit')
  })

  // The same rule applied one level up, and it is measured rather than assumed:
  // treating the header line as its own position produced only this difference in
  // forty commits of this repository, and raised the firing rate by half.
  test('a call on the header line and the same call wrapped onto the next are one position', () => {
    const onHeader = traitKeysOf(
      ['const Schema = build({', '  path: text()', '})'].join('\n')
    )
    const wrapped = traitKeysOf(
      ['const Schema = z', '  .build({', '    path: text()', '  })'].join('\n')
    )

    expect(onHeader).toContain('call:build@surface/exit')
    expect(wrapped).toContain('call:build@surface/exit')
  })

  // THE CONTAINER DEFECT, at the level it is caused. Measured on real
  // repositories, an 875-line Ruby class was reported for "23 of 34 sibling
  // declarations call `initialize` with `app` as its first argument" — where the
  // "call" was its peers' `def initialize(app)` HEADER lines. A container was
  // being credited with everything its members do, so its trait set described its
  // members and the comparison was between classes phrased in the vocabulary of
  // functions.
  test("a declaration's traits are its own body's, not its members'", () => {
    const source = [
      'class Middleware {',
      '  constructor(app) {',
      '    this.app = wrap(app)',
      '  }',
      '  handle(request) {',
      '    return respond(request)',
      '  }',
      '}'
    ].join('\n')
    const lines = toSourceLines(source)
    const span = declarationSpanAt(lines, 1)
    const traitsWith = (nestedSpans: readonly ReturnType<typeof declarationSpanAt>[]) =>
      extractDeclarationTraits({
        lines,
        span: span ?? { startLine: 1, endLine: 1, indentation: 0 },
        declarationName: 'Middleware',
        nestedSpans: nestedSpans.flatMap((nested) => (nested === undefined ? [] : [nested]))
      })
        .map(declarationTraitKey)
        .sort()

    // Non-vacuity, stated in the test rather than left to a stashed edit: with the
    // members left in, the class holds every call they make and both of their
    // header lines as calls of its own.
    expect(traitsWith([])).toEqual([
      'call-argument:constructor(app)@surface/exit',
      'call-argument:handle(request)@surface/exit',
      'call-argument:respond(request)@surface/exit',
      'call-argument:wrap(app)@surface/exit',
      'call:constructor@surface/exit',
      'call:handle@surface/exit',
      'call:respond@surface/exit',
      'call:wrap@surface/exit'
    ])
    // Subtracting them leaves a class that is a namespace for its members and
    // nothing else — which is the truth about it, and which the peer derivation
    // then drops under its existing behaviourless-declaration rule.
    expect(
      traitsWith([declarationSpanAt(lines, 2), declarationSpanAt(lines, 5)])
    ).toEqual([])
  })

  test('a function keeps its own body when it holds a local helper', () => {
    const source = [
      'function handler(request) {',
      '  const normalize = (value) => trim(value)',
      '  return respond(normalize(request))',
      '}'
    ].join('\n')
    const lines = toSourceLines(source)
    const span = declarationSpanAt(lines, 1)
    const helper = declarationSpanAt(lines, 2)

    if (span === undefined || helper === undefined) {
      throw new Error('expected spans')
    }

    const keys = extractDeclarationTraits({
      lines,
      span,
      declarationName: 'handler',
      nestedSpans: [helper]
    })
      .map(declarationTraitKey)
      .sort()

    // `trim` belonged to the helper and is gone; `respond` and the call to the
    // helper are the function's own and stay. A function that holds a local
    // helper is not thereby a container with no behaviour of its own.
    expect(keys).toEqual([
      'call-argument:normalize(request)@surface/exit',
      'call:normalize@surface/exit',
      'call:respond@surface/exit'
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
