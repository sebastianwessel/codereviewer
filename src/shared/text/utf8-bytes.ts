// Shared UTF-8 byte helpers for the context/budget code, which measures and
// caps text by encoded byte size rather than JavaScript string length. Reuse
// these instead of inline `Buffer` calls so every byte budget is enforced the
// same way across the context builders and the mediated repository tools.

/** Encoded UTF-8 byte length of a string. */
export const utf8ByteLength = (value: string): number => Buffer.byteLength(value)

/**
 * Truncate a string to at most `maxBytes` encoded UTF-8 bytes, never splitting a
 * character. A negative budget is treated as zero.
 *
 * Iterates by CODE POINT, which is what makes it correct. Two earlier versions were
 * not, and both had doc comments claiming they were:
 *
 * - slicing the Buffer and decoding emits U+FFFD when the cut lands mid-sequence,
 *   so a truncated string ended in a replacement character rather than being short;
 * - binary-searching UTF-16 code-unit indices can land BETWEEN the halves of a
 *   surrogate pair, yielding a lone surrogate — an unpaired half that is not a
 *   valid character at all. Reachable with emoji or CJK content at a tight budget.
 *
 * A `for...of` over a string yields whole code points, so a surrogate pair is
 * measured and appended as one unit and can never be cut in half.
 */
export const sliceUtf8Bytes = (value: string, maxBytes: number): string => {
  const limit = Math.max(0, maxBytes)

  if (utf8ByteLength(value) <= limit) {
    return value
  }

  let bytes = 0
  let result = ''

  for (const codePoint of value) {
    const size = utf8ByteLength(codePoint)

    if (bytes + size > limit) {
      break
    }

    result += codePoint
    bytes += size
  }

  return result
}
