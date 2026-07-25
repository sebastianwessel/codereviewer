import {
  sliceUtf8Bytes,
  utf8ByteLength
} from '../../../../shared/text/utf8-bytes.js'

// Spec 18 step 2 ("Resolve"): quote the BODY of a symbol the context scout asked
// for, so the reviewer sees a callee's behavior instead of its signature window.
//
// The reviewer supports TS/JS, Go, Python, Java, PHP, Rust and Ruby, so this
// deliberately does not parse with a language grammar: seven parsers to quote
// seven bodies is not a cost this feature can carry, and the core must stay
// language-neutral. Instead a bounded heuristic runs over source whose strings
// and comments have been masked out, tracking brace depth for the
// brace-delimited families and indentation for the indentation-scoped ones.
//
// Every ambiguity is resolved towards capturing LESS. A mis-detected quote or an
// unbalanced brace can never walk the capture to end of file: the scan window is
// hard-capped, and a body that does not close inside it is emitted truncated.

// Hard backstop on the captured line span. Larger than any body worth quoting to
// a reviewer, small enough that a mis-tracked delimiter costs a bounded amount of
// context instead of the rest of the file.
const MAX_BODY_LINES = 400

// How far past the declaration line to look for the opening brace. Covers
// "brace on its own line" (Java/C#/PHP) and short multi-line parameter lists.
const OPENING_BRACE_LOOKAHEAD_LINES = 4

// Lines that close a block while sitting at the declaration's own indentation:
// Ruby's `end`, plus a bare closing brace for the case where a brace body fell
// back to indentation capture because its opener was masked.
const BLOCK_TERMINATORS = new Set(['end', '}', '};'])

export type SymbolBodyExtraction = {
  readonly name: string
  readonly path: string
  readonly startLine: number
  readonly endLine: number
  readonly content: string
  readonly truncated: boolean
}

export type ExtractSymbolBodyInput = {
  readonly path: string
  readonly content: string
  readonly name: string
  readonly declarationLine: number
  readonly maxBytes: number
}

const IDENTIFIER_CHARACTER = /[A-Za-z0-9_$]/u

const isIdentifierCharacter = (character: string | undefined): boolean =>
  character !== undefined && IDENTIFIER_CHARACTER.test(character)

// Whole-token containment: `run` must not match inside `runtimeConfig`.
const containsToken = (line: string, token: string): boolean => {
  let index = line.indexOf(token)

  while (index !== -1) {
    if (
      !isIdentifierCharacter(line[index - 1]) &&
      !isIdentifierCharacter(line[index + token.length])
    ) {
      return true
    }
    index = line.indexOf(token, index + 1)
  }

  return false
}

// The scout may name a member as `Class.method`, `Class::method` or `Mod#method`
// while the declaring line only carries the final segment, so both spellings are
// accepted.
const symbolNameCandidates = (name: string): readonly string[] => {
  const trimmed = name.trim()

  if (trimmed.length === 0) {
    return []
  }

  const segments = trimmed.split(/::|[.#]/u).filter((part) => part.length > 0)
  const lastSegment = segments.at(-1)

  return lastSegment !== undefined && lastSegment !== trimmed
    ? [trimmed, lastSegment]
    : [trimmed]
}

type ScanState =
  | { readonly kind: 'code' }
  | { readonly kind: 'block-comment' }
  // A string literal that may span lines (JS template literals, Python
  // docstrings, Java text blocks), tracked by its closing delimiter.
  | { readonly kind: 'spanning-string'; readonly closer: string }

const CODE_STATE: ScanState = { kind: 'code' }

// Index just past the closing delimiter, honoring backslash escapes.
const findStringEnd = (
  line: string,
  from: number,
  closer: string
): number | undefined => {
  let index = from

  while (index < line.length) {
    if (line[index] === '\\') {
      index += 2
      continue
    }
    if (line.startsWith(closer, index)) {
      return index + closer.length
    }
    index += 1
  }

  return undefined
}

// `&'a` / `<'a` is a Rust lifetime, not a character literal. Reading it as a
// quote would mask the remainder of the signature — including its opening brace.
const isRustLifetime = (line: string, index: number): boolean => {
  const previous = line[index - 1]

  if (previous !== '&' && previous !== '<') {
    return false
  }

  const next = line[index + 1]

  if (next === undefined || !/[A-Za-z_]/u.test(next)) {
    return false
  }

  let cursor = index + 1

  while (cursor < line.length && isIdentifierCharacter(line[cursor])) {
    cursor += 1
  }

  // `'a'` is a character literal; `'a>` or `'a ` is a lifetime.
  return line[cursor] !== "'"
}

const maskRun = (length: number): string => ' '.repeat(Math.max(0, length))

// Replace string-literal and comment spans with spaces, preserving line length
// and every delimiter that is actually code. Returns the state to carry into the
// next line.
const maskNonCode = (
  line: string,
  state: ScanState
): { readonly code: string; readonly state: ScanState } => {
  const masked: string[] = []
  let current = state
  let index = 0

  while (index < line.length) {
    if (current.kind === 'block-comment') {
      const close = line.indexOf('*/', index)

      if (close === -1) {
        masked.push(maskRun(line.length - index))
        index = line.length
        continue
      }

      masked.push(maskRun(close + 2 - index))
      index = close + 2
      current = CODE_STATE
      continue
    }

    if (current.kind === 'spanning-string') {
      const end = findStringEnd(line, index, current.closer)

      if (end === undefined) {
        masked.push(maskRun(line.length - index))
        index = line.length
        continue
      }

      masked.push(maskRun(end - index))
      index = end
      current = CODE_STATE
      continue
    }

    const character = line[index] as string

    if (line.startsWith('/*', index)) {
      masked.push(maskRun(2))
      index += 2
      current = { kind: 'block-comment' }
      continue
    }

    // `#` is a line comment in Python/Ruby/PHP/shell. In Rust attributes and TS
    // private names it is not, but masking those only ever hides balanced text
    // or costs one line of capture, so the simpler rule is the safer one.
    if (line.startsWith('//', index) || character === '#') {
      masked.push(maskRun(line.length - index))
      index = line.length
      continue
    }

    if (line.startsWith('"""', index) || line.startsWith("'''", index)) {
      const closer = line.slice(index, index + 3)
      masked.push(maskRun(3))
      index += 3
      current = { kind: 'spanning-string', closer }
      continue
    }

    if (character === '`') {
      masked.push(maskRun(1))
      index += 1
      current = { kind: 'spanning-string', closer: '`' }
      continue
    }

    if (character === '"' || (character === "'" && !isRustLifetime(line, index))) {
      // An unterminated quote is closed at end of line rather than carried
      // forward: an apostrophe in prose must not mask the rest of the file.
      const end = findStringEnd(line, index + 1, character) ?? line.length
      masked.push(maskRun(end - index))
      index = end
      continue
    }

    masked.push(character)
    index += 1
  }

  return { code: masked.join(''), state: current }
}

const maskWindow = (lines: readonly string[]): readonly string[] => {
  const masked: string[] = []
  let state: ScanState = CODE_STATE

  for (const line of lines) {
    const result = maskNonCode(line, state)
    masked.push(result.code)
    state = result.state
  }

  return masked
}

type BracePosition = {
  readonly line: number
  readonly column: number
}

// Locate the brace that opens the body, or `undefined` when the declaration is
// not brace-delimited. Braces nested inside the still-open parameter list are
// type or default-value literals (`(limits: { hard: number })`), never the body.
const findBodyOpeningBrace = (
  codeLines: readonly string[]
): BracePosition | undefined => {
  const declaration = codeLines[0] ?? ''

  // Python/Ruby-style openers end the declaration with ':'. Checked first so
  // `def build(options={}):` is not mistaken for a brace body.
  if (declaration.trimEnd().endsWith(':')) {
    return undefined
  }

  let groupDepth = 0
  const limit = Math.min(codeLines.length, OPENING_BRACE_LOOKAHEAD_LINES + 1)

  for (let line = 0; line < limit; line += 1) {
    const code = codeLines[line] ?? ''

    if (line > 0) {
      const trimmed = code.trim()

      if (trimmed.length === 0) {
        continue
      }

      // Past the declaration line a brace opens the body only while the
      // signature is still open across a multi-line parameter list, or when the
      // brace is the first thing on the line ("brace on its own line" styles).
      // Otherwise we are already looking at statements, where a brace may be a
      // map or hash literal.
      if (groupDepth <= 0 && !trimmed.startsWith('{')) {
        return undefined
      }
    }

    for (let column = 0; column < code.length; column += 1) {
      const character = code[column]

      if (character === '(' || character === '[') {
        groupDepth += 1
        continue
      }

      if (character === ')' || character === ']') {
        groupDepth = Math.max(0, groupDepth - 1)
        continue
      }

      if (character === '{' && groupDepth === 0) {
        return { line, column }
      }
    }
  }

  return undefined
}

type CaptureResult = {
  readonly endIndex: number
  readonly truncated: boolean
}

const captureBraceBody = (
  codeLines: readonly string[],
  opener: BracePosition
): CaptureResult => {
  let depth = 0

  for (let line = opener.line; line < codeLines.length; line += 1) {
    const code = codeLines[line] ?? ''
    const start = line === opener.line ? opener.column : 0

    for (let column = start; column < code.length; column += 1) {
      const character = code[column]

      if (character === '{') {
        depth += 1
        continue
      }

      if (character !== '}') {
        continue
      }

      // Clamped: an unbalanced closer ends the capture early rather than driving
      // depth negative and postponing the close past the real end of the body.
      depth = Math.max(0, depth - 1)

      if (depth === 0) {
        return { endIndex: line, truncated: false }
      }
    }
  }

  // Never closed inside the window: emit what we have rather than guess.
  return { endIndex: codeLines.length - 1, truncated: true }
}

// Indentation width in characters. Python forbids mixing tabs and spaces within
// a block, so counting characters is sufficient and avoids guessing a tab stop.
const indentWidth = (line: string): number =>
  line.length - line.trimStart().length

const captureIndentedBody = (
  rawLines: readonly string[],
  windowClipped: boolean
): CaptureResult => {
  const declarationIndent = indentWidth(rawLines[0] ?? '')
  let endIndex = 0
  let index = 1

  for (; index < rawLines.length; index += 1) {
    const raw = rawLines[index] ?? ''
    const trimmed = raw.trim()

    // Blank lines only extend the body if indented content follows them.
    if (trimmed.length === 0) {
      continue
    }

    if (indentWidth(raw) > declarationIndent) {
      endIndex = index
      continue
    }

    if (BLOCK_TERMINATORS.has(trimmed)) {
      endIndex = index
    }

    break
  }

  return {
    endIndex,
    // Only a body still running at the backstop is truncated; one that ends with
    // the file is complete.
    truncated: windowClipped && endIndex === rawLines.length - 1
  }
}

/**
 * Extract the body of `name` declared at `declarationLine` (1-based) from
 * `content`, line-numbered and capped to `maxBytes` UTF-8 bytes.
 *
 * Returns `undefined` when the declaration line is out of range or does not
 * plausibly declare `name`, so a stale deterministic fact drops the symbol
 * instead of quietly quoting an unrelated chunk of the file. Pure and
 * deterministic: identical input always yields identical output.
 */
export const extractSymbolBody = (
  input: ExtractSymbolBodyInput
): SymbolBodyExtraction | undefined => {
  if (!Number.isFinite(input.maxBytes) || input.maxBytes <= 0) {
    return undefined
  }

  const lines = input.content.split('\n')
  const declarationIndex = input.declarationLine - 1

  if (
    !Number.isInteger(input.declarationLine) ||
    declarationIndex < 0 ||
    declarationIndex >= lines.length
  ) {
    return undefined
  }

  const declarationText = lines[declarationIndex] as string
  const candidates = symbolNameCandidates(input.name)

  if (
    candidates.length === 0 ||
    !candidates.some((candidate) => containsToken(declarationText, candidate))
  ) {
    return undefined
  }

  const windowEnd = Math.min(lines.length, declarationIndex + MAX_BODY_LINES)
  const windowClipped = windowEnd < lines.length
  const rawWindow = lines.slice(declarationIndex, windowEnd)
  const codeWindow = maskWindow(rawWindow)

  const opener = findBodyOpeningBrace(codeWindow)
  const capture =
    opener === undefined
      ? captureIndentedBody(rawWindow, windowClipped)
      : captureBraceBody(codeWindow, opener)

  const body = rawWindow
    .slice(0, capture.endIndex + 1)
    .map((line, offset) => `${input.declarationLine + offset}: ${line}`)
    .join('\n')

  const cappedByBytes = utf8ByteLength(body) > input.maxBytes
  const content = cappedByBytes ? sliceUtf8Bytes(body, input.maxBytes) : body

  // endLine describes what `content` actually carries, so a byte-capped body
  // never claims lines the reviewer cannot see.
  const emittedLines = content.length === 0 ? 1 : content.split('\n').length

  return {
    name: input.name,
    path: input.path,
    startLine: input.declarationLine,
    endLine: input.declarationLine + emittedLines - 1,
    content,
    truncated: capture.truncated || cappedByBytes
  }
}

export const symbolBodyBounds = {
  maxBodyLines: MAX_BODY_LINES,
  openingBraceLookaheadLines: OPENING_BRACE_LOOKAHEAD_LINES
} as const
