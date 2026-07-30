// CommonJS exports produce the same `export` fact an ESM export would.
//
// The extractor used to recognise ESM `export` and nothing else, so a CommonJS
// file yielded NO facts at all. Measured 2026-07-30 over four real JavaScript
// repositories (1,046 `.js` files): six declarations in total, and `fastify`'s
// 701-line `lib/route.js` produced zero. Deterministic facts feed the stage-1
// support-signal packet, `impact check`'s changed symbols and `conformance
// check`'s declarations, so a CommonJS codebase degraded all three silently.

import { describe, expect, test } from 'vitest'
import { extractEcmascriptSignals } from './ecmascript-signal-extractor.js'

const namesOf = (content: string, path = 'lib/x.js'): readonly string[] =>
  extractEcmascriptSignals('javascript', [{ path, content }])
    .facts.filter((fact) => fact.kind === 'export')
    .map((fact) => fact.name)

describe('CommonJS export signals', () => {
  test('reads the canonical multi-export object', () => {
    // The shape `fastify`'s lib/route.js uses, and the one that produced zero
    // facts before: shorthand and renamed properties in one literal.
    expect(
      namesOf(
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
    expect(namesOf(source)).toEqual(expected)
  })

  test('records nothing for an anonymous default export', () => {
    // There is no name a peer set or a reference lookup could match on, so this
    // is deliberately absent rather than invented as a placeholder.
    expect(namesOf('module.exports = function () {}\n')).toEqual([])
    expect(namesOf('module.exports = 42\n')).toEqual([])
  })

  test('does not treat an ordinary property assignment as an export', () => {
    // The guard that keeps this from firing on any `a.b = c` in the file.
    expect(namesOf('foo.bar = 1\nthis.baz = 2\nresult.exports = 3\n')).toEqual([])
  })

  test('leaves ESM extraction unchanged', () => {
    expect(namesOf('export const a = 1\nexport function b() {}\n', 'lib/m.mjs')).toEqual([
      'a',
      'b'
    ])
  })

  test('applies to TypeScript too, since a .ts file may use CommonJS', () => {
    const facts = extractEcmascriptSignals('typescript', [
      { path: 'src/legacy.ts', content: 'function h() {}\nmodule.exports = { h }\n' }
    ]).facts

    expect(facts.map((fact) => fact.name)).toEqual(['h'])
  })

  test('reports the assignment line, not the declaration line', () => {
    // A CommonJS export is the assignment; the function may be declared far
    // above it. Downstream span reconstruction anchors on the reported line.
    const facts = extractEcmascriptSignals('javascript', [
      { path: 'lib/x.js', content: 'function a() {}\n\n\nmodule.exports = { a }\n' }
    ]).facts

    expect(facts[0]?.line).toBe(4)
  })
})
