// The one comment predicate, pinned. Both callers depend on the same two
// properties: a whole-line comment is not code, and a trailing one does not make
// the code before it disappear.

import { describe, expect, test } from 'vitest'
import { isCommentLine, withoutCommentLines } from './comment-lines.js'

describe('the comment predicate', () => {
  test('recognises a whole-line comment in every supported spelling', () => {
    for (const line of [
      '// a note',
      '  /* a note',
      '   * a continuation',
      '# a note',
      '-- a note',
      '; a note',
      '"""a docstring',
      "'''a docstring",
      '<!-- a note'
    ]) {
      expect(isCommentLine(line)).toBe(true)
    }
  })

  test('leaves code carrying a trailing comment alone', () => {
    // Stripping on a trailing marker would need to know whether the marker sits
    // inside a string literal, which text matching cannot know. The code before it
    // is real either way.
    expect(isCommentLine('  raise ValueError(reason)  # see the ticket')).toBe(
      false
    )
    expect(isCommentLine('  const url = "http://example.test" // note')).toBe(
      false
    )
  })

  test('keeps only the code lines', () => {
    expect(
      withoutCommentLines(['  # raise ValueError(', '  warnings.warn(msg)'])
    ).toEqual(['  warnings.warn(msg)'])
  })
})
