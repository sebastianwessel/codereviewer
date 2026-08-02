// What a declaration observably does, expressed as a set of comparable traits.
//
// Spec 24 asks for "the calls, guards and argument shapes that a majority of
// peers share and the changed declaration does not". Those three become three
// trait kinds:
//
//   call           — the body calls `name`.
//   guard          — the body calls `name` in a conditional position.
//   call-argument  — the body calls `name` with `argument` as its first argument.
//
// `call-argument` is this implementation's reading of "argument shapes". The
// alternative reading — the declaration's own parameter list — was rejected
// because extracting a parameter NAME is not language-neutral: `a: string` names
// the parameter first and `String a` names it last, so the rule would need a
// per-language table inside a domain that is supposed to stay language-neutral.
// The call-argument reading needs no such table, and it reaches the consequence
// shape the research pass measured as the largest single group (widened scope —
// `requireRole("admin")` becoming `requireRole("user")`), which a parameter-list
// reading does not reach at all.
//
// Extraction is lexical, over the comment- and string-blanked lines produced by
// `declaration-span.ts`. It is not a parser and does not resolve anything: a
// method call `client.send(x)` yields `call:send`, not the receiver's type. That
// is adequate here because a trait is only ever compared against the same trait
// extracted the same way from a sibling, and both sides carry the same
// imprecision.

import { blankNonCode, codeLinesOfSpan, type DeclarationSpan, type SourceLines } from './declaration-span.js'
import {
  describeTraitPosition,
  traitPositionKey,
  traitPositionsOfSpan,
  type TraitPosition
} from './trait-position.js'

export type DeclarationTraitKind = 'call' | 'guard' | 'call-argument'

// What a trait is, minus where it sits. Spec 24 compares traits including their
// position, but the two questions "which symbol, used how" and "where in the
// declaration" are separable, and several readers only want the first: the
// adjudication packet describes a group by what its members do, and listing "calls
// respond on the exit path" beside "calls respond inside a nested block" would
// describe the group twice.
export type DeclarationTraitSubject = {
  readonly kind: DeclarationTraitKind
  // The called symbol.
  readonly name: string
  // Present only for `call-argument`: the normalized first argument.
  readonly argument?: string
}

export type DeclarationTrait = DeclarationTraitSubject & {
  // Where in the declaration the trait was observed (spec 24, "Positional
  // Traits"). Two declarations holding the same symbol at materially different
  // positions do not hold the same trait.
  readonly position: TraitPosition
}

/**
 * Identity of a trait's subject, ignoring where it sits.
 *
 * This is what "the declaration mentions this symbol at all" means, and it is the
 * question that separates a divergence of ABSENCE — the peers call it and this
 * declaration never does — from a divergence of POSITION, where the declaration
 * does call it but somewhere else entirely. The two read differently to a human and
 * are stated differently.
 */
export const declarationTraitSubjectKey = (
  trait: DeclarationTraitSubject
): string =>
  trait.argument === undefined
    ? `${trait.kind}:${trait.name}`
    : `${trait.kind}:${trait.name}(${trait.argument})`

/** Stable, comparable identity of a trait, including its structural position. */
export const declarationTraitKey = (trait: DeclarationTrait): string =>
  `${declarationTraitSubjectKey(trait)}@${traitPositionKey(trait.position)}`

/**
 * The trait as a phrase, for the one reader that is not code: the adjudicator.
 *
 * A trait key (`guard:requireAuth`) is a comparison identity and reads as jargon;
 * the adjudication packet is asked to judge whether a set of peers shares a
 * practice, so it presents each trait the same way the divergence statement does.
 * It states what the code does and nothing about whether that matters.
 *
 * The position is deliberately NOT part of this phrase; `describePositionedTrait`
 * adds it where it is the point.
 */
export const describeDeclarationTrait = (
  trait: DeclarationTraitSubject
): string => {
  if (trait.kind === 'guard') {
    return `calls ${trait.name} in a conditional`
  }

  if (trait.kind === 'call-argument') {
    return `calls ${trait.name} with ${trait.argument} as its first argument`
  }

  return `calls ${trait.name}`
}

/** The trait as a phrase, with the structural position that now distinguishes it. */
export const describePositionedTrait = (trait: DeclarationTrait): string =>
  `${describeDeclarationTrait(trait)} ${describeTraitPosition(trait.position)}`

// Identifiers that are followed by `(` without being a call in at least one
// supported language: `if (`, `catch (`, Python's `class Foo(Base):`, Go's
// grouped `var ( ... )` and `import ( ... )`, a JavaScript anonymous
// `function (` or `func (` literal.
//
// The list is deliberately narrow. A keyword that never appears directly before
// a parenthesis (`enum`, `struct`, `interface`, `impl`, `trait`, `loop`) is NOT
// listed, because listing it only suppresses a real callee of the same name —
// `z.enum(...)` is an ordinary call, and excluding it made every schema-builder
// declaration in this repository's config module look behaviourless.
const nonCallKeywords = new Set([
  'and',
  'await',
  'case',
  'catch',
  'class',
  'const',
  'def',
  'defer',
  'delete',
  'do',
  'elif',
  'else',
  'elsif',
  'except',
  'fn',
  'for',
  'foreach',
  'func',
  'function',
  'go',
  'if',
  'import',
  'in',
  'instanceof',
  'is',
  'lambda',
  'new',
  'not',
  'or',
  'rescue',
  'return',
  'self',
  'sizeof',
  'super',
  'switch',
  'this',
  'throw',
  'try',
  'type',
  'typeof',
  'unless',
  'until',
  'var',
  'when',
  'while',
  'with',
  'yield'
])

// An identifier immediately followed by an opening parenthesis. Whitespace is
// allowed between the two because several languages conventionally write it, but
// a newline is not, so a call must be recognisable on one line.
//
// A receiver prefix is deliberately NOT excluded: `client.send(x)` yields
// `call:send`. Method calls are most of what a body does in every supported
// language, and dropping them would leave the trait sets of object-oriented peers
// almost empty. The cost is that the receiver is not distinguished, so two peers
// calling `send` on different objects look alike — an imprecision both sides of
// every comparison carry equally.
const callPattern = /(?<![A-Za-z0-9_$])([A-Za-z_$][A-Za-z0-9_$]*[?!]?)\s*\(/gu

// ---------------------------------------------------------------------------
// AN IDENTIFIER BEFORE A PARENTHESIS IS NOT ALWAYS A CALLEE.
//
// It is a callee when the parenthesis opens an ARGUMENT LIST. Two other things
// wear the same shape, and both are the identifier MODIFYING the construct that
// follows the group rather than applying it:
//
//   pub(crate) fn insert(…)          — a visibility modifier on a declaration
//   emitter.on('x', async (e) => …)  — a modifier on a function literal
//
// Measured on 37 real repositories, `pub` was the single most-reported "call" in
// the divergence population: 60 statements of the form "14 of 25 sibling
// declarations call `pub` with `crate` as its first argument". That is not a
// mistake about Rust, it is a mistake about parentheses, so the rules below are
// about parentheses. Enumerating `pub` beside `async` beside `internal` beside
// `synchronized` would fix one language at a time forever, and every entry added
// to a keyword list also suppresses a real callee of that name — the reason the
// list further up is deliberately short.
//
// Two structural tests, one per shape. Both are decided from the text already
// blanked of comments and string contents, so nothing here can be fooled by a
// parenthesis inside prose or a literal.

// Index of the parenthesis closing the group that opens at `openIndex`, searching
// forward across the span's remaining lines because a parameter list is very often
// written over several. `undefined` when the group does not close within the span,
// which leaves the identifier treated as a call — the safe direction, since a
// missing trait is invisible while an invented one is reported.
const closingParenthesisAfter = (
  codeLines: readonly string[],
  openOffset: number,
  openIndex: number
): { readonly offset: number; readonly index: number } | undefined => {
  let depth = 0

  for (let offset = openOffset; offset < codeLines.length; offset += 1) {
    const line = codeLines[offset] ?? ''

    for (
      let index = offset === openOffset ? openIndex : 0;
      index < line.length;
      index += 1
    ) {
      const character = line[index]

      if (character === '(') {
        depth += 1
      } else if (character === ')') {
        depth -= 1

        if (depth === 0) {
          return { offset, index }
        }
      }
    }
  }

  return undefined
}

// What follows a parameter list and can follow nothing else: the arrow that
// introduces the function's body. `=>` covers ECMAScript, Java and C#-shaped
// lambdas; `->` covers a signature's return type in Rust and Python. A call's
// result is never written before an arrow in any supported language, so a group
// closed immediately before one is a parameter list and the identifier in front of
// it is a modifier on the function, not its callee.
//
// A return-type annotation may sit between the two — `async (input): Promise<void>
// => {` is the dominant style wherever types are written — so a `:` clause is
// stepped over. Only a clause, not a statement: a `;`, a brace or the end of the
// line ends the search, so a ternary's `f(a) : g(b)` cannot reach an arrow further
// down the line.
//
// It also, correctly, removes a destructuring PATTERN: Rust's `Ok(value) => …`
// match arm names a variant being taken apart, not a function being called.
const arrowAfterParameterList = /^\s*(?::[^;{}=]*)?(?:=>|->)/u

// Whether the group opened at `openIndex` is a function's parameter list rather
// than a call's argument list.
const opensParameterList = (
  codeLines: readonly string[],
  openOffset: number,
  openIndex: number
): boolean => {
  const closing = closingParenthesisAfter(codeLines, openOffset, openIndex)

  if (closing === undefined) {
    return false
  }

  return arrowAfterParameterList.test(
    (codeLines[closing.offset] ?? '').slice(closing.index + 1)
  )
}

const escapeForPattern = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

// Where the declaration's own name sits on its header line, as a whole
// identifier. Everything to the LEFT of it is the header's modifier prefix —
// visibility, mutability, an annotation, a decorator, a declaring keyword — and no
// supported language writes a call there. Everything to the right is the
// signature and, on a one-line declaration, the body: a default argument value
// `def render(escape = html())` is a real call and is kept.
//
// `undefined` when the name cannot be located, which suppresses nothing.
const declarationNameIndex = (
  headerLine: string,
  declarationName: string
): number | undefined => {
  if (declarationName.length === 0) {
    return undefined
  }

  const match = new RegExp(
    `(?<![A-Za-z0-9_$])${escapeForPattern(declarationName)}(?![A-Za-z0-9_$])`,
    'u'
  ).exec(headerLine)

  return match?.index
}

// A line that opens a conditional. Optional leading `}` and `else` cover the
// brace-language `} else if (...)` shape; `elif`/`elsif`/`unless` cover the
// others. Deliberately anchored: a conditional appearing mid-line (a ternary, a
// Ruby statement modifier) is not counted, because counting it would make the
// distinction between `guard` and `call` depend on formatting.
const guardLinePattern = /^\s*(?:\}\s*)?(?:else\s+)?(?:if|elif|elsif|unless|guard|when)\b/u

// A first argument simple enough to compare across peers: a bare identifier or
// dotted path, a quoted string, or a number. Anything more complex (an inline
// object, a nested call, an expression) is not recorded, because two peers whose
// first arguments are different expressions would be reported as sharing nothing
// useful.
const simpleArgumentPattern =
  /^\s*(?:(["'`])([^"'`]*)\1|([A-Za-z_$][A-Za-z0-9_$.]*)|(-?\d+(?:\.\d+)?))\s*[,)]/u

// Longer than this and the argument is a message or a payload rather than a
// mode, a role or a flag — the things a peer set can meaningfully agree on.
const MAX_ARGUMENT_LENGTH = 60

// Reads the first argument of the call whose `(` sits at `openIndex`. Returns
// undefined when the argument is absent, spans lines, or is not simple.
const firstArgumentAt = (line: string, openIndex: number): string | undefined => {
  const match = simpleArgumentPattern.exec(line.slice(openIndex + 1))

  if (match === null) {
    return undefined
  }

  const [, , stringValue, identifier, numberValue] = match
  // A string is normalized to its content in double quotes so `'admin'` and
  // `"admin"` compare equal across languages and styles.
  const argument =
    stringValue === undefined
      ? identifier ?? numberValue
      : `"${stringValue}"`

  if (argument === undefined || argument.length > MAX_ARGUMENT_LENGTH) {
    return undefined
  }

  // Defensive: a non-empty argument that is entirely whitespace can only be a
  // blanked string literal that reached here by mistake, and recording it would
  // make two unrelated peers appear to agree.
  return stringValue !== undefined &&
    stringValue.length > 0 &&
    stringValue.trim().length === 0
    ? undefined
    : argument
}

export type ExtractDeclarationTraitsInput = {
  readonly lines: SourceLines
  readonly span: DeclarationSpan
  // The declaration's own name, excluded from its traits: a recursive call is not
  // a convention, and a name that appears in its own header would otherwise make
  // every declaration trivially "call" itself.
  readonly declarationName: string
  // Spans of the declarations nested INSIDE this one, which are not part of what
  // it does. See `ownCodeLinesOf` for why they are subtracted rather than counted.
  readonly nestedSpans?: readonly DeclarationSpan[]
}

/**
 * The span's code lines with every nested declaration blanked out.
 *
 * A DECLARATION'S TRAITS ARE ITS OWN, NOT ITS MEMBERS'.
 *
 * Without this a class's trait set is the union of everything its methods do, and
 * every enclosing construct is credited with the behaviour of everything it holds.
 * Measured on real repositories, that is the single largest source of false
 * conformance reports: an 875-line Ruby class was reported for "23 of 34 sibling
 * declarations call `initialize` with `app` as its first argument", where the
 * "call" was in fact its peers' `def initialize(app)` HEADER lines and the claim
 * was really "23 of these 34 classes are middleware and this one is not". A
 * container-scale subject was being measured with a function-scale vocabulary, and
 * the vocabulary was borrowed from the members.
 *
 * Subtracting the members is the whole fix, and it needs no notion of "container":
 * a class whose body is nothing but methods is left with no traits at all and the
 * existing rule — a declaration with no observable behaviour is neither a subject
 * nor a peer — removes it. A function holding a local helper keeps every trait of
 * its own body and loses only the helper's, which is exactly right: the helper is a
 * declaration in its own right and is compared as one.
 *
 * Blanking rather than deleting keeps every offset equal to its line's offset in
 * the span, so a trait can still be traced back to a raw line, and it keeps the
 * nested lines out of the indentation ranking `traitPositionsOfSpan` performs — a
 * method body's depth is not a level of its enclosing class.
 */
const ownCodeLinesOf = (
  codeLines: readonly string[],
  span: DeclarationSpan,
  nestedSpans: readonly DeclarationSpan[]
): readonly string[] =>
  nestedSpans.length === 0
    ? codeLines
    : codeLines.map((line, offset) => {
        const lineNumber = span.startLine + offset

        return nestedSpans.some(
          (nested) => lineNumber >= nested.startLine && lineNumber <= nested.endLine
        )
          ? ''
          : line
      })

/**
 * Extracts the trait set of one declaration, from its OWN body: the spans of the
 * declarations nested inside it are subtracted first (see `ownCodeLinesOf`).
 *
 * The result is de-duplicated by
 * trait key: a body calling `log` five times at the same position shares exactly
 * the same trait with a peer calling it once, because what is being compared is
 * whether the convention is upheld, not how often. Calling it at two materially
 * different positions yields two traits, which is the whole of spec 24's
 * "Positional Traits".
 */
export const extractDeclarationTraits = (
  input: ExtractDeclarationTraitsInput
): readonly DeclarationTrait[] => {
  const codeLines = ownCodeLinesOf(
    codeLinesOfSpan(input.lines, input.span),
    input.span,
    input.nestedSpans ?? []
  )
  const positions = traitPositionsOfSpan(codeLines, input.span.indentation)
  // The end of the header's modifier prefix. Only the header line has one.
  const modifierPrefixEnd = declarationNameIndex(
    codeLines[0] ?? '',
    input.declarationName
  )
  const byKey = new Map<string, DeclarationTrait>()

  const record = (trait: DeclarationTrait): void => {
    const key = declarationTraitKey(trait)

    if (!byKey.has(key)) {
      byKey.set(key, trait)
    }
  }

  for (const [offset, line] of codeLines.entries()) {
    const position = positions[offset]

    // A line with no position is blank or fully blanked, so it carries no call
    // either; the guard is here so a trait can never be recorded without one.
    if (position === undefined) {
      continue
    }

    const isGuardLine = guardLinePattern.test(line)
    // Calls are located in the BLANKED line, so a name inside a comment or a
    // string is never one. The argument is then read from the RAW line at the
    // same column, because blanking replaces a string literal's contents with
    // spaces and `requireRole("admin")` versus `requireRole("user")` is exactly
    // the divergence the `call-argument` trait exists to express. The column is
    // trustworthy in both directions: blanking preserves every position, and the
    // call was already proven to sit in code rather than in prose.
    const rawLine = input.lines[input.span.startLine - 1 + offset] ?? line

    for (const match of line.matchAll(callPattern)) {
      const name = match[1] ?? ''
      // The match ends on the opening parenthesis, so its last character is the
      // one both the modifier tests and the argument scan work from.
      const openIndex = match.index + (match[0]?.length ?? 1) - 1

      if (
        nonCallKeywords.has(name) ||
        name === input.declarationName ||
        // A modifier in the header's prefix, or a modifier on a function literal.
        (offset === 0 &&
          modifierPrefixEnd !== undefined &&
          match.index < modifierPrefixEnd) ||
        opensParameterList(codeLines, offset, openIndex)
      ) {
        continue
      }

      record({ kind: 'call', name, position })

      if (isGuardLine) {
        record({ kind: 'guard', name, position })
      }

      const argument = firstArgumentAt(rawLine, openIndex)

      if (argument !== undefined) {
        record({ kind: 'call-argument', name, argument, position })
      }
    }
  }

  return [...byKey.values()]
}

/**
 * Whether the declaration header at `startLine` is one this domain can compare.
 *
 * The extractors emit one fact per exported NAME, so `export { readOne, readAll }`
 * produces several facts sharing a line. Those are a re-export list, not
 * declarations: they have no body, and left in they would form large bogus peer
 * sets inside barrel files where every member's trait set is empty. Any line
 * carrying more than one such fact is therefore excluded by the caller; this
 * predicate covers the other half of the problem, a header that is entirely
 * blanked out (a fact whose line the span reconstruction could not read).
 */
export const isComparableDeclarationHeader = (
  lines: SourceLines,
  startLine: number
): boolean => {
  const header = lines[startLine - 1]

  return header !== undefined && blankNonCode(header).text.trim().length > 0
}
