// Splitting source into line-aligned, byte-bounded pieces that know where they
// start in the original file.
//
// Shared, rather than living beside context assembly where it began, because spec 26
// gave it a SECOND caller with the same correctness requirement: assembly no longer
// splits proactively, but a task the provider refuses as too large is split
// reactively, and both paths must produce pieces whose line numbers are the file's
// real line numbers. Two implementations of that arithmetic would be two chances to
// reintroduce the off-by-a-chunk defect this project already fixed once.

import { utf8ByteLength } from './utf8-bytes.js'

export const splitTextByUtf8Bytes = (
  content: string,
  maxBytes: number
): readonly string[] => {
  if (maxBytes < 1) {
    throw new TypeError('maxBytes must be greater than 0.')
  }

  if (content.length === 0) {
    return ['']
  }

  const chunks: string[] = []
  let current = ''
  let currentBytes = 0

  for (const character of content) {
    const characterBytes = utf8ByteLength(character)

    if (currentBytes > 0 && currentBytes + characterBytes > maxBytes) {
      chunks.push(current)
      current = ''
      currentBytes = 0
    }

    current += character
    currentBytes += characterBytes
  }

  if (current.length > 0 || chunks.length === 0) {
    chunks.push(current)
  }

  return chunks
}

// One source chunk plus the absolute line span it occupies in the original file.
// The span is what makes a chunk reviewable on its own: discovery renders the
// chunk as a line-numbered document and admission checks the reported location
// against the lines the chunk actually contained.
export type SourceLineChunk = {
  readonly content: string
  readonly startLine: number
  readonly endLine: number
}

// Split content into line units that KEEP their terminator, so concatenating the
// units restores the input byte for byte. A file ending in a newline yields a
// final empty unit, which is the same trailing line `sourceLineCount` counts;
// keeping it makes the last chunk's `endLine` equal the file's line count.
const lineUnits = (content: string): readonly string[] => {
  const units: string[] = []
  let current = ''

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index] as string

    current += character

    // A CR is only a line break when it does not start a CRLF pair; otherwise the
    // pair would be counted as two lines and every following number would shift.
    if (
      character === '\n' ||
      (character === '\r' && content[index + 1] !== '\n')
    ) {
      units.push(current)
      current = ''
    }
  }

  units.push(current)

  return units
}

/**
 * Split source into byte-bounded chunks that each know where they start in the
 * original file.
 *
 * Chunks are cut on line boundaries so a chunk's first line is a whole line of
 * the file: discovery numbers a chunk's lines from `startLine`, and a cut in the
 * middle of a line would make every number after it ambiguous. A single line
 * longer than the budget cannot be cut on a boundary, so it is split by bytes and
 * every piece keeps that same line number, which leaves the lines after it
 * correctly numbered.
 *
 * Splitting stays lossless: concatenating the chunks of a path in order restores
 * the file, which the fingerprint anchor resolver depends on.
 */
export const splitSourceIntoLineChunks = (
  content: string,
  maxBytes: number
): readonly SourceLineChunk[] => {
  if (maxBytes < 1) {
    throw new TypeError('maxBytes must be greater than 0.')
  }

  const chunks: SourceLineChunk[] = []
  let current = ''
  let currentBytes = 0
  let startLine = 1
  let endLine = 1

  for (const [index, unit] of lineUnits(content).entries()) {
    const lineNumber = index + 1

    for (const piece of splitTextByUtf8Bytes(unit, maxBytes)) {
      const pieceBytes = utf8ByteLength(piece)

      if (currentBytes > 0 && currentBytes + pieceBytes > maxBytes) {
        chunks.push({ content: current, startLine, endLine })
        current = ''
        currentBytes = 0
        startLine = lineNumber
      }

      current += piece
      currentBytes += pieceBytes
      endLine = lineNumber
    }
  }

  if (current.length > 0 || chunks.length === 0) {
    chunks.push({ content: current, startLine, endLine })
  }

  return chunks
}

/**
 * Split content into exactly two line-aligned halves, or report that it cannot be.
 *
 * This is the reactive split's primitive (spec 26): a task the provider refused is
 * halved and each half retried. Returning `undefined` for content that cannot be cut
 * is what lets the caller fail loudly on a genuinely indivisible unit rather than
 * recurse forever on it.
 *
 * `originStartLine` is the absolute line the content begins at, so halving a piece
 * that is ITSELF already a chunk keeps reporting the file's real line numbers
 * however many times the split recurses.
 */
export const splitContentInHalf = (
  content: string,
  originStartLine: number
): readonly [SourceLineChunk, SourceLineChunk] | undefined => {
  const bytes = utf8ByteLength(content)

  if (bytes < 2) {
    return undefined
  }

  const chunks = splitSourceIntoLineChunks(content, Math.ceil(bytes / 2))

  if (chunks.length < 2) {
    return undefined
  }

  // A half-byte budget can yield three pieces when a line straddles the midpoint;
  // the tail is folded into the second half so the result is always exactly two and
  // remains lossless.
  const [first, ...rest] = chunks as [SourceLineChunk, ...SourceLineChunk[]]
  const second = rest.reduce((merged, chunk) => ({
    content: merged.content + chunk.content,
    startLine: merged.startLine,
    endLine: chunk.endLine
  }))
  const offset = originStartLine - 1

  return [
    {
      content: first.content,
      startLine: first.startLine + offset,
      endLine: first.endLine + offset
    },
    {
      content: second.content,
      startLine: second.startLine + offset,
      endLine: second.endLine + offset
    }
  ]
}
