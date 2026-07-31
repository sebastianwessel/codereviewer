import { describe, expect, test } from 'vitest'
import {
  groupByKeyInOrder,
  selectSpreadAcrossGroups
} from './bounded-selection.js'

const letters = (prefix: string, count: number): readonly string[] =>
  Array.from({ length: count }, (_unused, index) => `${prefix}${index}`)

describe('bounded selection', () => {
  test('returns everything, in interleaved order, when the bound does not bind', () => {
    expect(
      selectSpreadAcrossGroups([['a0', 'a1'], ['b0'], ['c0', 'c1']], 10)
    ).toEqual(['a0', 'b0', 'c0', 'a1', 'c1'])
  })

  test('a single group cannot spend the whole budget while others get nothing', () => {
    const selected = selectSpreadAcrossGroups(
      [letters('a', 20), letters('b', 20), letters('c', 20)],
      6
    )

    expect(new Set(selected.map((item) => item[0]))).toEqual(
      new Set(['a', 'b', 'c'])
    )
  })

  // The regression the stride exists for. Interleaving alone puts one item from
  // every group into round one, so with more groups than the budget the budget is
  // spent before the later groups are ever reached — which is the same
  // front-of-list amputation the interleave was introduced to remove.
  test('draws from across the group list when the groups outnumber the bound', () => {
    const groups = letters('g', 40).map((name) => [name])
    const selected = selectSpreadAcrossGroups(groups, 4)

    expect(selected).toHaveLength(4)
    expect(selected).not.toEqual(['g0', 'g1', 'g2', 'g3'])
    // Drawn from the whole list rather than its front: the last decile is
    // represented, which a prefix of any length short of 36 cannot manage.
    expect(
      selected.some((name) => Number(name.slice(1)) >= 30)
    ).toBe(true)
  })

  test('a bound inside one group samples through it rather than off its front', () => {
    const selected = selectSpreadAcrossGroups([letters('a', 100)], 5)

    expect(selected).toHaveLength(5)
    expect(selected).not.toEqual(['a0', 'a1', 'a2', 'a3', 'a4'])
    expect(selected[0]).toBe('a0')
    expect(Number(selected[4]?.slice(1))).toBeGreaterThan(50)
  })

  test('selects exactly the bound, without repeating an item', () => {
    for (const limit of [1, 2, 3, 7, 13, 49]) {
      const selected = selectSpreadAcrossGroups(
        [letters('a', 17), letters('b', 23), letters('c', 11)],
        limit
      )

      expect(selected).toHaveLength(limit)
      expect(new Set(selected).size).toBe(limit)
    }
  })

  test('selection is reproducible across runs', () => {
    const groups = [letters('a', 31), letters('b', 17), letters('c', 43)]

    expect(selectSpreadAcrossGroups(groups, 20)).toEqual(
      selectSpreadAcrossGroups(groups, 20)
    )
  })

  test('a non-positive bound selects nothing, and empty groups are skipped', () => {
    expect(selectSpreadAcrossGroups([['a']], 0)).toEqual([])
    expect(selectSpreadAcrossGroups([], 5)).toEqual([])
    expect(selectSpreadAcrossGroups([[], ['b0'], []], 5)).toEqual(['b0'])
  })

  test('grouping orders the groups by key and keeps arrival order inside one', () => {
    expect(
      groupByKeyInOrder(
        [
          { path: 'src/b.ts', line: 2 },
          { path: 'src/a.ts', line: 9 },
          { path: 'src/b.ts', line: 1 },
          { path: 'src/a.ts', line: 4 }
        ],
        (item) => item.path
      )
    ).toEqual([
      [
        { path: 'src/a.ts', line: 9 },
        { path: 'src/a.ts', line: 4 }
      ],
      [
        { path: 'src/b.ts', line: 2 },
        { path: 'src/b.ts', line: 1 }
      ]
    ])
  })
})
