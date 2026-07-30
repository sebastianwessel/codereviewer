import { describe, expect, test } from 'vitest'
import { toSourceLines } from './declaration-span.js'
import { findGuardedRegions } from './guarded-region.js'

const regionsIn = (
  source: string,
  declarationStartLine: number,
  declarationName: string,
  changed: readonly number[]
) =>
  findGuardedRegions({
    lines: toSourceLines(source),
    declarationStartLine,
    declarationName,
    changedLines: new Set(changed)
  })

describe('findGuardedRegions', () => {
  test('reports a changed conditional and what it precedes', () => {
    const source = [
      'export const handle = (request) => {', // 1
      '  if (!isAuthorized(request)) {', //     2
      '    return deny()', //                   3
      '  }', //                                 4
      '  return persist(request.body)', //      5
      '}' //                                    6
    ].join('\n')

    const regions = regionsIn(source, 1, 'handle', [2])

    expect(regions).toHaveLength(1)
    expect(regions[0]?.guardLine).toBe(2)
    expect(regions[0]?.governedStartLine).toBe(3)
    // Spec 25: the remainder of the declaration, bounded by the span. The
    // closing brace sits at the header's column and is outside the span.
    expect(regions[0]?.governedEndLine).toBe(5)
    expect(regions[0]?.calleeNames).toEqual(['deny', 'persist'])
  })

  test('fires on a conditional carrying no call at all', () => {
    // The largest consequence shape in the survey is weakening in place, and it
    // frequently has no call to key on: `role === "admin"` becoming `role`. A
    // call-bearing trigger would miss most of that group, so this is the case
    // that decides whether the trigger is the conditional or the call.
    const source = [
      'def export_users(request):', //   1
      '    if request.role:', //         2
      '        return dump(request)', // 3
      '    return None' //               4
    ].join('\n')

    const regions = regionsIn(source, 1, 'export_users', [2])

    expect(regions).toHaveLength(1)
    expect(regions[0]?.calleeNames).toEqual(['dump'])
  })

  test('is language-neutral: the same shape in Go with tab indentation', () => {
    const source = [
      'func ExportUsers(w http.ResponseWriter, r *http.Request) {', // 1
      '\tif !requireAuth(r) {', //                                     2
      '\t\treturn', //                                                 3
      '\t}', //                                                        4
      '\twriteAll(w, loadUsers())' //                                  5
    ].join('\n')

    const regions = regionsIn(source, 1, 'ExportUsers', [2])

    expect(regions).toHaveLength(1)
    expect(regions[0]?.calleeNames).toEqual(['writeAll', 'loadUsers'])
  })

  test('does not fire when the diff did not touch the conditional', () => {
    const source = [
      'export const handle = (request) => {',
      '  if (!isAuthorized(request)) {',
      '    return deny()',
      '  }',
      '  return persist(request.body)',
      '}'
    ].join('\n')

    // Line 5 changed; the guard on line 2 did not.
    expect(regionsIn(source, 1, 'handle', [5])).toEqual([])
  })

  test('does not fire for a conditional that governs nothing', () => {
    // A conditional on the declaration's last line precedes no code inside it.
    // Reporting it would state a zero-line region as though it were evidence.
    const source = ['const f = (x) => {', '  if (x) return 1', '}'].join('\n')

    expect(regionsIn(source, 1, 'f', [2])).toEqual([])
  })

  test('ignores a conditional written inside a comment or a string', () => {
    const source = [
      'export const handle = (request) => {', //    1
      '  // if (!isAuthorized(request)) {', //      2
      '  const sql = "if (x) then drop"', //        3
      '  return persist(request.body)', //          4
      '}' //                                        5
    ].join('\n')

    expect(regionsIn(source, 1, 'handle', [2, 3, 4])).toEqual([])
  })

  test('collects callees only from after the guard, and never the declaration itself', () => {
    const source = [
      'export const walk = (node) => {', //   1
      '  const seen = prepare(node)', //      2
      '  if (seen.done) {', //                3
      '    return finish(seen)', //           4
      '  }', //                               5
      '  return walk(node.next)', //          6
      '}' //                                  7
    ].join('\n')

    const regions = regionsIn(source, 1, 'walk', [3])

    expect(regions).toHaveLength(1)
    // `prepare` precedes the guard, so the guard does not govern it. `walk` is
    // the declaration's own name: a recursive call says nothing about what the
    // guarded region depends on.
    expect(regions[0]?.calleeNames).toEqual(['finish'])
  })

  test('reports each changed conditional separately', () => {
    const source = [
      'export const handle = (request) => {', // 1
      '  if (!request.user) {', //               2
      '    return deny()', //                    3
      '  }', //                                  4
      '  if (request.legacy) {', //              5
      '    return legacyPath(request)', //       6
      '  }', //                                  7
      '  return persist(request)', //            8
      '}' //                                     9
    ].join('\n')

    const regions = regionsIn(source, 1, 'handle', [2, 5])

    expect(regions.map((region) => region.guardLine)).toEqual([2, 5])
    // Both are bounded by the declaration span, so the second is a subset of the
    // first. That is spec 25's rule verbatim: the remainder the guard precedes.
    expect(regions[1]?.governedStartLine).toBe(6)
    expect(regions[1]?.governedEndLine).toBe(8)
  })

  test('returns empty when the declaration line does not exist', () => {
    expect(regionsIn('const a = 1', 99, 'missing', [99])).toEqual([])
  })
})
