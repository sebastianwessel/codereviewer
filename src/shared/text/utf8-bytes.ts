// Shared UTF-8 byte helpers for the context/budget code, which measures and
// caps text by encoded byte size rather than JavaScript string length. Reuse
// these instead of inline `Buffer` calls so every byte budget is enforced the
// same way across the context builders and the mediated repository tools.

/** Encoded UTF-8 byte length of a string. */
export const utf8ByteLength = (value: string): number => Buffer.byteLength(value)

/**
 * Truncate a string to at most `maxBytes` encoded UTF-8 bytes. A negative
 * budget is treated as zero. May drop a trailing multi-byte code point rather
 * than emit a partial one.
 */
export const sliceUtf8Bytes = (value: string, maxBytes: number): string =>
  Buffer.from(value).subarray(0, Math.max(0, maxBytes)).toString('utf8')
