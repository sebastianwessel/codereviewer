import { describe, expect, test } from 'vitest'
import { uniqueSorted } from './unique-sorted.js'

describe('uniqueSorted', () => {
  test('removes duplicates and sorts by locale', () => {
    expect(uniqueSorted(['b', 'a', 'b', 'c', 'a'])).toEqual(['a', 'b', 'c'])
  })

  test('returns an empty array unchanged', () => {
    expect(uniqueSorted([])).toEqual([])
  })

  // The signature accepts any iterable so no caller has a reason to keep a
  // private copy of this beside it; `change-impact-scoring.ts` did exactly that
  // because it held a Set-producing iterable.
  test('accepts a non-array iterable', () => {
    expect(uniqueSorted(new Set(['b', 'a', 'b']))).toEqual(['a', 'b'])
    expect(
      uniqueSorted(
        (function* generate(): Generator<string> {
          yield 'c'
          yield 'a'
          yield 'c'
        })()
      )
    ).toEqual(['a', 'c'])
  })
})
