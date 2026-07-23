import { describe, expect, test } from 'vitest'
import { sliceUtf8Bytes, utf8ByteLength } from './utf8-bytes.js'

describe('utf8 byte helpers', () => {
  test('utf8ByteLength counts encoded bytes, not code units', () => {
    expect(utf8ByteLength('abc')).toBe(3)
    // '€' is three UTF-8 bytes but one JavaScript character.
    expect(utf8ByteLength('€')).toBe(3)
  })

  test('sliceUtf8Bytes caps output at the byte budget', () => {
    expect(sliceUtf8Bytes('abcdef', 3)).toBe('abc')
    expect(sliceUtf8Bytes('abc', 10)).toBe('abc')
  })

  test('sliceUtf8Bytes treats a negative budget as zero', () => {
    expect(sliceUtf8Bytes('abc', -5)).toBe('')
  })
})
