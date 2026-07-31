import { describe, expect, test } from 'vitest'
import { sliceUtf8Bytes, utf8ByteLength } from './utf8-bytes.js'

describe('sliceUtf8Bytes', () => {
  test('never splits a character, whatever the budget', () => {
    // Two earlier implementations both broke here while their doc comments claimed
    // they did not: slicing the Buffer emitted U+FFFD when the cut landed
    // mid-sequence, and binary-searching UTF-16 code-unit indices could land
    // between the halves of a surrogate pair and yield a LONE surrogate — not a
    // valid character at all. Reachable with emoji or CJK at a tight budget.
    const emoji = '😀😀😀'

    for (let budget = 0; budget <= utf8ByteLength(emoji) + 2; budget += 1) {
      const out = sliceUtf8Bytes(emoji, budget)

      expect(utf8ByteLength(out)).toBeLessThanOrEqual(budget)
      expect(out).not.toContain('\uFFFD')
      for (const character of out) {
        const code = character.codePointAt(0) ?? 0
        expect(code >= 0xd800 && code <= 0xdfff).toBe(false)
      }
      // Whole emoji only — never a half.
      expect(out).toBe('😀'.repeat(Math.floor(budget / 4)))
    }
  })

  test('returns the value untouched when it already fits', () => {
    expect(sliceUtf8Bytes('hello', 5)).toBe('hello')
    expect(sliceUtf8Bytes('hello', 500)).toBe('hello')
  })

  test('treats a negative budget as zero', () => {
    expect(sliceUtf8Bytes('hello', -10)).toBe('')
  })

  test('counts encoded bytes, not string length', () => {
    expect(utf8ByteLength('ü')).toBe(2)
    expect(sliceUtf8Bytes('üü', 3)).toBe('ü')
  })
})
