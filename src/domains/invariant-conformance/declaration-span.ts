// Where a declaration's body starts and stops, and what of it counts as code.
//
// `deterministic-signals` reports a declaration's START line only — there is no
// end line in a `SupportSignalFact`, and adding one would change a contract seven
// extractors and three domains already depend on. Spec 24 needs a body to compare
// against its peers, so the extent is reconstructed here, from the source text,
// deterministically.
//
// The rule is indentation, not syntax: a declaration's body is the run of lines
// after its header that are blank or indented further than the header. That is
// exact for the indentation-scoped languages (Python, Ruby) and correct in
// practice for the brace-scoped ones, whose bodies are conventionally indented and
// whose closing brace sits back at the header's column — so it is excluded, which
// costs nothing because a closing brace carries no trait.
//
// It is deliberately NOT a parser. A second parsing layer beside the extractors
// would be a language-specific analyzer outside the adapter boundary AGENTS.md
// draws, and the traits this feeds (see `declaration-shape.ts`) are lexical
// anyway. What it must not do is silently misreport: a declaration whose body
// cannot be bounded this way yields a short span and therefore few traits, which
// makes it a poor peer rather than a wrong one.

// Leading whitespace width of a line, counting a tab as one column. Absolute
// column values are never compared across files, only within one file against one
// header line, so the tab width only has to be self-consistent.
const indentationWidth = (line: string): number =>
  line.length - line.trimStart().length

const isBlank = (line: string): boolean => line.trim().length === 0

export type SourceLines = readonly string[]

/**
 * Splits source into lines on any of the three line terminators. The index of a
 * line in the result is its 1-based line number minus one, which is the space
 * every `SupportSignalFact.line` is expressed in.
 */
export const toSourceLines = (content: string): SourceLines =>
  content.split(/\r\n|\n|\r/u)

export type DeclarationSpan = {
  // 1-based, inclusive. `startLine` is the declaration's header line as the
  // extractors report it.
  readonly startLine: number
  readonly endLine: number
  readonly indentation: number
}

/**
 * Reconstructs the inclusive line span of the declaration whose header is at
 * `startLine`. A declaration with no indented lines after it (a one-line arrow
 * function, a Go type alias) spans exactly its header line.
 */
export const declarationSpanAt = (
  lines: SourceLines,
  startLine: number
): DeclarationSpan | undefined => {
  const headerLine = lines[startLine - 1]

  if (headerLine === undefined) {
    return undefined
  }

  const indentation = indentationWidth(headerLine)
  let endLine = startLine

  for (let index = startLine; index < lines.length; index += 1) {
    const line = lines[index] ?? ''

    // A blank line does not end a body; a declaration separated from its own
    // trailing blank line by nothing would otherwise stop one line early, and a
    // blank line inside a body is universal.
    if (isBlank(line)) {
      continue
    }

    if (indentationWidth(line) <= indentation) {
      break
    }

    endLine = index + 1
  }

  return { startLine, endLine, indentation }
}

// Delimiters treated as opening a string. Backtick is included for JS/Go raw
// strings; the same character is harmless in the languages that do not use it.
const stringDelimiters = new Set(['"', "'", '`'])

export type BlankedLine = {
  // The line with every comment and string-literal character replaced by a
  // space, so column positions and line numbers are unchanged.
  readonly text: string
  // Whether a block comment is still open at the end of this line, so the caller
  // can carry the state into the next one.
  readonly insideBlockComment: boolean
}

/**
 * Blanks out comments and string literal contents, in place, preserving line
 * structure and line numbers.
 *
 * Without this, every lexical trait would be contaminated by prose: a comment
 * saying "call requireAuth first" would register as a call to `requireAuth`, and
 * a SQL string would register calls to whatever it names. Peer comparison is
 * especially vulnerable, because sibling declarations frequently carry a copied
 * comment header — which would then read as a shared convention.
 *
 * The scanner is deliberately one small language-neutral state machine rather
 * than seven language-specific ones: `//` and `#` start a line comment,
 * `/* ... *\/` a block comment, and the three quote characters a string. A
 * construct it misreads (a Python triple-quoted docstring, whose delimiters it
 * sees as an empty string followed by an opening one) degrades into blanking more
 * text than necessary, which loses traits rather than inventing them. Losing a
 * trait is safe here: a trait that is never extracted cannot become a majority
 * pattern, so the failure mode is silence rather than a false divergence.
 */
export const blankNonCode = (
  line: string,
  insideBlockComment = false
): BlankedLine => {
  let result = ''
  let index = 0
  let inBlockComment = insideBlockComment
  let stringDelimiter: string | undefined

  while (index < line.length) {
    const character = line[index] ?? ''

    if (inBlockComment) {
      if (line.startsWith('*/', index)) {
        inBlockComment = false
        result += '  '
        index += 2
        continue
      }

      result += ' '
      index += 1
      continue
    }

    if (stringDelimiter !== undefined) {
      // A backslash escapes the next character, so an escaped quote cannot close
      // the literal.
      if (character === '\\') {
        result += '  '
        index += 2
        continue
      }

      if (character === stringDelimiter) {
        stringDelimiter = undefined
        result += character
      } else {
        result += ' '
      }

      index += 1
      continue
    }

    if (stringDelimiters.has(character)) {
      stringDelimiter = character
      result += character
      index += 1
      continue
    }

    if (line.startsWith('//', index) || character === '#') {
      return { text: result.padEnd(line.length, ' '), insideBlockComment: false }
    }

    if (line.startsWith('/*', index)) {
      inBlockComment = true
      result += '  '
      index += 2
      continue
    }

    result += character
    index += 1
  }

  return { text: result, insideBlockComment: inBlockComment }
}

/**
 * Applies `blankNonCode` across a span, carrying block-comment state from line to
 * line so a multi-line comment header inside a body is suppressed in full.
 */
export const codeLinesOfSpan = (
  lines: SourceLines,
  span: DeclarationSpan
): readonly string[] => {
  const result: string[] = []
  let insideBlockComment = false

  for (let line = span.startLine; line <= span.endLine; line += 1) {
    const blanked = blankNonCode(lines[line - 1] ?? '', insideBlockComment)

    insideBlockComment = blanked.insideBlockComment
    result.push(blanked.text)
  }

  return result
}
