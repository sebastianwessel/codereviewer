import { describe, expect, test } from 'vitest'
import { stableJsonDigest } from './stable-json-digest.js'

describe('stableJsonDigest', () => {
  test('is insensitive to object key order', () => {
    const left = stableJsonDigest({ a: 1, b: 2, c: [1, 2, 3] })
    const right = stableJsonDigest({ c: [1, 2, 3], b: 2, a: 1 })

    expect(left).toBe(right)
  })

  test('is sensitive to array element order', () => {
    // Arrays are NOT canonicalized: some arrays carry meaning in their order
    // (expectedFindings' expectedIndex, for one), so silently sorting every
    // array would erase exactly the distinction `computeAnswerKeyDigest`
    // depends on to keep case-internal ordering significant.
    const left = stableJsonDigest({ items: [1, 2, 3] })
    const right = stableJsonDigest({ items: [3, 2, 1] })

    expect(left).not.toBe(right)
  })

  test('is deterministic across repeated calls on identical input', () => {
    const value = { nested: { z: 1, a: [1, { y: 2, x: 1 }] } }

    expect(stableJsonDigest(value)).toBe(stableJsonDigest(value))
  })

  test('treats undefined object properties as absent, matching JSON.stringify', () => {
    const withUndefined = stableJsonDigest({ a: 1, b: undefined })
    const withoutKey = stableJsonDigest({ a: 1 })

    expect(withUndefined).toBe(withoutKey)
  })

  // The exact disagreement between the two serializers that once backed these
  // digests: the manifest copy coerced `undefined` to `null` (`value[key] ??
  // null`), which makes an absent property indistinguishable from an explicitly
  // null one AND makes `{a: undefined}` differ from `{}`. Both directions are
  // asserted so neither can be reintroduced by a copy that "just" adds a
  // fallback.
  test('distinguishes an absent property from an explicitly null one', () => {
    expect(stableJsonDigest({ a: 1, b: undefined })).not.toBe(
      stableJsonDigest({ a: 1, b: null })
    )
  })
})
