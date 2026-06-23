import { describe, expect, test } from 'vitest'
import { truncateForContract } from './truncate.js'

describe('truncateForContract', () => {
  test('returns short values unchanged', () => {
    expect(truncateForContract('hello', 10)).toBe('hello')
  })

  test('truncates values longer than the cap to exactly the cap length', () => {
    const value = 'x'.repeat(600)
    const result = truncateForContract(value, 500)

    expect(result).toHaveLength(500)
    expect(value.startsWith(result)).toBe(true)
  })

  test('handles the boundary length exactly', () => {
    const value = 'y'.repeat(500)
    expect(truncateForContract(value, 500)).toBe(value)
  })
})
