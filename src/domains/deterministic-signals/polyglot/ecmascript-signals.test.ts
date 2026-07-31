// ECMAScript deterministic signals, extracted by the same ast-grep engine as the
// other five languages.
//
// These cases were written against a separate extractor built on the TypeScript
// compiler API. That engine is gone — it used the compiler purely as a parser and
// reached an internal field for diagnostics — and the cases moved here unchanged,
// because the replacement is meant to be like-for-like. Anything that fails here
// is a behaviour change, not a port detail.
//
// The CommonJS cases in particular: recognising only ESM `export` left a CommonJS
// file with NO facts at all. Measured over four real JavaScript repositories
// (1,046 `.js` files): six declarations in total, and `fastify`'s 701-line
// `lib/route.js` produced zero. These facts feed the stage-1 support-signal
// packet, `impact check`'s changed symbols and `conformance check`'s
// declarations, so a CommonJS codebase degraded all three silently.

import { describe, expect, test } from 'vitest'
import { extractPolyglotSignals } from './polyglot-signal-extractor.js'

const exportNames = (content: string, path = 'lib/x.js'): readonly string[] =>
  extractPolyglotSignals('javascript', [{ path, content }])
    .facts.filter((fact) => fact.kind === 'export')
    .map((fact) => fact.name)

describe('CommonJS export signals', () => {
  test('reads the canonical multi-export object', () => {
    // The shape `fastify`'s lib/route.js uses, and the one that produced zero
    // facts before: shorthand and renamed properties in one literal. The
    // shorthand half regressed during this port — the object's child IS the
    // shorthand identifier rather than a wrapping pair — and this caught it.
    expect(
      exportNames(
        'function buildRouting() {}\nfunction validate() {}\nmodule.exports = { buildRouting, validate: validate }\n'
      )
    ).toEqual(['buildRouting', 'validate'])
  })

  test.each([
    ['exports.f = function () {}\n', ['f']],
    ['module.exports.g = 1\n', ['g']],
    ['const d = () => 1\nmodule.exports = d\n', ['d']],
    ['module.exports = function e() {}\n', ['e']],
    ['class G {}\nmodule.exports = G\n', ['G']]
  ])('names the export in %j', (source, expected) => {
    expect(exportNames(source)).toEqual(expected)
  })

  test('records nothing for an anonymous default export', () => {
    // There is no name a peer set or a reference lookup could match on, so this
    // is deliberately absent rather than invented as a placeholder.
    expect(exportNames('module.exports = function () {}\n')).toEqual([])
    expect(exportNames('module.exports = 42\n')).toEqual([])
  })

  test('does not treat an ordinary property assignment as an export', () => {
    // The guard that keeps this from firing on any `a.b = c` in the file.
    expect(exportNames('foo.bar = 1\nthis.baz = 2\nresult.exports = 3\n')).toEqual([])
  })

  test('records only the outermost name of a chained assignment', () => {
    // `exports.a = exports.b = void 0` is everywhere in compiled output. Matching
    // any `assignment_expression` rather than the STATEMENT would start reporting
    // the inner names too — 3,083 extra facts across 1,897 real files. Recovering
    // them may well be right, but it changes what every downstream consumer
    // receives and needs a spec, so it is pinned as-is here.
    expect(exportNames('exports.a = exports.b = void 0\n')).toEqual(['a'])
  })

  test('leaves ESM extraction unchanged', () => {
    expect(exportNames('export const a = 1\nexport function b() {}\n', 'lib/m.mjs')).toEqual([
      'a',
      'b'
    ])
  })

  test('applies to TypeScript too, since a .ts file may use CommonJS', () => {
    const { facts } = extractPolyglotSignals('typescript', [
      { path: 'src/legacy.ts', content: 'function h() {}\nmodule.exports = { h }\n' }
    ])

    expect(facts.map((fact) => fact.name)).toEqual(['h'])
  })

  test('reports the assignment line, not the declaration line', () => {
    // A CommonJS export is the assignment; the function may be declared far
    // above it. Downstream span reconstruction anchors on the reported line.
    const { facts } = extractPolyglotSignals('javascript', [
      { path: 'lib/x.js', content: 'function a() {}\n\n\nmodule.exports = { a }\n' }
    ])

    expect(facts[0]?.line).toBe(4)
  })
})

describe('ESM specifier names', () => {
  test('an alias names the binding it introduces', () => {
    // `import { a as b }` binds `b`; `export { c as d }` exports `d`.
    const { facts } = extractPolyglotSignals('javascript', [
      {
        path: 'lib/m.mjs',
        content: "import { a as b, plain } from 'dep'\nexport { b as d, plain }\n"
      }
    ])

    expect(facts.filter((f) => f.kind === 'import').map((f) => f.name)).toEqual([
      'b',
      'plain'
    ])
    expect(facts.filter((f) => f.kind === 'export').map((f) => f.name)).toEqual([
      'd',
      'plain'
    ])
  })

  test.each([
    ['export { X as default }\n', ['default']],
    ['export { x as "module.exports" }\n', ['module.exports']]
  ])('reads a non-identifier alias in %j', (source, expected) => {
    // A keyword alias and a string-literal alias are both real and both shipped
    // in packages this project depends on. Reading the last identifier instead of
    // the grammar's `alias` field returned the LOCAL name for both — a wrong
    // name, which is worse than a missing one.
    expect(exportNames(source, 'lib/m.mjs')).toEqual(expected)
  })

  test('a side-effect import binds nothing', () => {
    expect(
      extractPolyglotSignals('javascript', [
        { path: 'lib/m.mjs', content: "import 'polyfill'\n" }
      ]).facts
    ).toEqual([])
  })

  test('a star re-export is recorded as *', () => {
    const { facts } = extractPolyglotSignals('javascript', [
      { path: 'lib/m.mjs', content: "export * from './other.js'\n" }
    ])

    expect(facts.map((f) => [f.name, f.moduleSpecifier])).toEqual([['*', './other.js']])
  })

  test('only the first declarator of a multi-declaration export is named', () => {
    // Matching the compiler-based extractor, which read
    // `declarationList.declarations[0]`.
    expect(exportNames('export const a = 1, b = 2\n', 'lib/m.mjs')).toEqual(['a'])
  })

  test('a destructuring export names nothing', () => {
    expect(exportNames('export const { a, b } = obj\n', 'lib/m.mjs')).toEqual([])
  })
})

describe('parse failures', () => {
  test('a file the grammar rejects still yields the facts it could read', () => {
    // Exporting under a RESERVED WORD (`export { _null as null }`) is legal
    // ECMAScript that tree-sitter cannot parse. Skipping such a file — which is
    // what the engine does for the other five languages — cost 512 facts across
    // 4 of 1,897 real files, and lost them SILENTLY: the file reported "nothing
    // to say" rather than "could not see". tree-sitter recovers, so the valid
    // parts still yield correct facts.
    const { facts, evidence } = extractPolyglotSignals('javascript', [
      {
        path: 'lib/m.mjs',
        content: "export const ok = 1\nexport { _null as null }\n"
      }
    ])

    expect(evidence).toHaveLength(1)
    expect(evidence[0]?.kind).toBe('diagnostic')
    expect(facts.map((fact) => fact.name)).toContain('ok')
  })
})
