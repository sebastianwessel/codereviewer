import { describe, expect, test } from 'vitest'
import { uniqueSorted } from './unique-sorted.js'

describe('uniqueSorted', () => {
  test('removes duplicates and sorts by locale', () => {
    expect(uniqueSorted(['b', 'a', 'b', 'c', 'a'])).toEqual(['a', 'b', 'c'])
  })

  test('returns an empty array unchanged', () => {
    expect(uniqueSorted([])).toEqual([])
  })
})
