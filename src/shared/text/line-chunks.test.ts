import { describe, expect, test } from 'vitest'
import {
  splitContentInHalf,
  splitSourceIntoLineChunks,
  splitTextByUtf8Bytes
} from './line-chunks.js'

describe('line chunking', () => {
  test('splits text on UTF-8 character boundaries', () => {
    expect(splitTextByUtf8Bytes('a🙂b', 2)).toEqual(['a', '🙂', 'b'])
    expect(splitTextByUtf8Bytes('', 10)).toEqual([''])
    expect(() => splitTextByUtf8Bytes('abc', 0)).toThrow(
      'maxBytes must be greater than 0'
    )
  })

  test('splits source on line boundaries and records each chunk’s absolute origin', () => {
    // Multi-byte lines: the budget counts UTF-8 bytes, the origin counts lines.
    // The file's trailing empty line rides along in the last chunk, which is why
    // it ends at line 4.
    expect(splitSourceIntoLineChunks('äa\nbä\ncä\n', 4)).toEqual([
      { content: 'äa\n', startLine: 1, endLine: 1 },
      { content: 'bä\n', startLine: 2, endLine: 2 },
      { content: 'cä\n', startLine: 3, endLine: 4 }
    ])
    // A CRLF pair is one line break, so the second chunk starts at line 2 and not
    // at line 3.
    expect(splitSourceIntoLineChunks('aa\r\nbb\r\n', 4)).toEqual([
      { content: 'aa\r\n', startLine: 1, endLine: 1 },
      { content: 'bb\r\n', startLine: 2, endLine: 3 }
    ])
    // A single line longer than the budget is the one case that cannot be cut on a
    // boundary. Its pieces keep that line's number, so the continuation chunk
    // starts at line 1 again and the line after it is still numbered 2.
    expect(splitSourceIntoLineChunks('aaaaa\nb\n', 4)).toEqual([
      { content: 'aaaa', startLine: 1, endLine: 1 },
      { content: 'a\nb\n', startLine: 1, endLine: 3 }
    ])
    // Content that fits stays a single chunk spanning the whole file, so the file's
    // trailing empty line is counted exactly as `sourceLineCount` counts it.
    expect(splitSourceIntoLineChunks('one\ntwo\n', 1000)).toEqual([
      { content: 'one\ntwo\n', startLine: 1, endLine: 3 }
    ])
    expect(splitSourceIntoLineChunks('', 1000)).toEqual([
      { content: '', startLine: 1, endLine: 1 }
    ])
    expect(() => splitSourceIntoLineChunks('abc', 0)).toThrow(
      'maxBytes must be greater than 0'
    )
  })

  test('halves content on line boundaries, losslessly and in exactly two pieces', () => {
    const halves = splitContentInHalf('a\nb\nc\nd\n', 1)

    expect(halves).toEqual([
      { content: 'a\nb\n', startLine: 1, endLine: 2 },
      { content: 'c\nd\n', startLine: 3, endLine: 5 }
    ])
    // Lossless: the reactive split must never drop or duplicate a byte, because the
    // pieces are what the model reviews and what admission anchors findings against.
    expect(`${halves?.[0].content}${halves?.[1].content}`).toBe('a\nb\nc\nd\n')
  })

  test('halving a piece that is itself a chunk keeps the file’s real line numbers', () => {
    // The origin offset is what makes recursion safe: a task refused twice is split
    // twice, and the third-level pieces must still point at the file's own lines.
    expect(splitContentInHalf('e\nf\ng\nh\n', 41)).toEqual([
      { content: 'e\nf\n', startLine: 41, endLine: 42 },
      { content: 'g\nh\n', startLine: 43, endLine: 45 }
    ])
  })

  test('reports content that cannot be halved rather than returning one piece', () => {
    // This is what stops the reactive split recursing forever: an indivisible unit
    // says so, and the caller fails loudly instead.
    expect(splitContentInHalf('', 1)).toBeUndefined()
    expect(splitContentInHalf('a', 1)).toBeUndefined()
  })

  test('halves a single over-long line by bytes, keeping its line number', () => {
    // No line boundary exists to cut on, so the cut is by bytes and BOTH pieces keep
    // the same line number — the lines after them stay correctly numbered.
    expect(splitContentInHalf('aaaa', 7)).toEqual([
      { content: 'aa', startLine: 7, endLine: 7 },
      { content: 'aa', startLine: 7, endLine: 7 }
    ])
  })
})
