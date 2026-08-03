import { describe, expect, test } from 'vitest'
import { TRUNCATION_MARK, truncateForContract } from './truncate.js'

describe('truncateForContract', () => {
  test('returns short values unchanged', () => {
    expect(truncateForContract('hello', 10)).toBe('hello')
  })

  test('truncates values longer than the cap to exactly the cap length', () => {
    const value = 'x'.repeat(600)
    const result = truncateForContract(value, 500)

    expect(result).toHaveLength(500)
    expect(value.startsWith(result.slice(0, -TRUNCATION_MARK.length))).toBe(true)
  })

  test('marks the cut so a reader cannot mistake it for the whole value', () => {
    const result = truncateForContract('x'.repeat(600), 500)

    expect(result.endsWith(TRUNCATION_MARK)).toBe(true)
  })

  test('leaves an uncut value unmarked, so the mark means what it says', () => {
    expect(truncateForContract('short', 500)).not.toContain(TRUNCATION_MARK)
  })

  test('drops whitespace stranded before the mark', () => {
    expect(truncateForContract(`${'x'.repeat(6)}    tail`, 10)).toBe(
      `xxxxxx${TRUNCATION_MARK}`
    )
  })

  test('handles the boundary length exactly', () => {
    const value = 'y'.repeat(500)
    expect(truncateForContract(value, 500)).toBe(value)
  })

  test('honours a cap too small to hold the mark', () => {
    expect(truncateForContract('abc', 1)).toBe(TRUNCATION_MARK)
    expect(truncateForContract('abc', 0)).toBe('')
  })
})
