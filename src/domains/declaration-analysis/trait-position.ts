// WHERE inside a declaration a trait sits, expressed coarsely enough to compare.
//
// Spec 24's "Positional Traits" requirement: a trait must carry its structural
// position, not only its presence, so that two declarations holding the same symbol
// at materially different positions no longer count as holding the same trait. The
// motivating case is three sibling parsers that all mention the same error: two
// return it on the way out of the declaration, and the third mentions it deep
// inside a loop whose fall-through returns no error at all. As a set-membership
// fact those are identical, and the divergence is invisible.
//
// Both dimensions come from indentation, which `declaration-span.ts` already
// computes. No parser, no per-language keyword table, no dependency: spec 15's
// language-neutrality Non-Negotiable applies to this domain and a construct table
// ("which keywords open a block") is exactly what it forbids.
//
// LEVELS, NOT COLUMNS. Two spaces, four spaces and a tab are the same nesting step
// written differently, so a raw column is not comparable across files or languages.
// The columns actually present inside one declaration are ranked, and the rank is
// the level: a Go body indented with tabs and a TypeScript body indented with two
// spaces produce the same levels for the same shape.
//
// WHY THE BANDS ARE COARSE, AND WHY THEY ARE DRAWN HERE.
//
// Indentation cannot tell a nested block from a wrapped expression. A fluent
// builder split across lines, a call whose arguments do not fit, a multi-line type
// literal — each adds an indentation step that is formatting rather than structure.
// A model that treated every step as nesting would report code style as divergence,
// and this repository's own negative control proves it: the four schema builders it
// compares hold `string` at level 1 in one declaration and at level 2 in another,
// purely because one wraps its chain. Splitting those apart would delete the
// control's case rather than sharpen it.
//
// So the declaration's header line and the first two levels under it are ONE band.
// A single wrap can explain level 2; it cannot explain level 3, which needs two
// enclosing constructs or a wrap inside a block. That is the line between "the
// declaration does this" and "the declaration does this in one of its sub-cases",
// and it is the smallest split that separates the parser case above (levels 1 and 2
// against level 4) without separating the negative control (levels 1 and 2 from
// each other).
//
// The header line was tried as a band of its own — a call in a declaration's
// initializer, a schema builder's `strictObject(`, is arguably part of what the
// declaration IS rather than something it does — and was MEASURED and dropped. Over
// forty commits of this repository it produced nothing but formatting divergences:
// `z.strictObject({` written on the header line against `z` and `.strictObject({`
// on the next, reported as two positions in the same peer set. It raised the firing
// rate from 0.90 to 1.375 reports per commit and contributed no divergence of any
// other shape. Indentation cannot see the difference between those two spellings,
// so neither can this.

export type TraitDepthBand =
  // The header line and levels 1-2: the declaration's own statements, plus
  // anything one wrap or one enclosing construct deep.
  | 'surface'
  // Level 3 and deeper: inside a nested construct.
  | 'nested'

export type TraitTerminality =
  // Nothing materially shallower follows inside the declaration, so the trait sits
  // on the way out rather than in a branch the declaration continues past.
  | 'exit'
  // The declaration returns to a materially shallower level afterwards, so the
  // trait is inside a block the declaration carries on beyond.
  | 'interior'

export type TraitPosition = {
  readonly depth: TraitDepthBand
  readonly terminality: TraitTerminality
}

// Highest level still counted as the declaration's own surface. See the band
// argument above: one wrap explains level 2, nothing explains level 3.
const SURFACE_MAX_LEVEL = 2

// How much shallower a later line must be before it counts as the declaration
// resuming rather than one wrapped expression ending. Same reason as the band
// width, applied to the other dimension.
const RESUME_TOLERANCE = 1

/** Stable, comparable identity of a position, for use inside a trait key. */
export const traitPositionKey = (position: TraitPosition): string =>
  `${position.depth}/${position.terminality}`

/**
 * The position as a phrase, for the two readers that are not code: the divergence
 * statement and the adjudicator. It states where the trait sits and nothing about
 * whether that matters.
 */
export const describeTraitPosition = (position: TraitPosition): string => {
  if (position.depth === 'surface') {
    return "on the declaration's exit path"
  }

  return position.terminality === 'exit'
    ? 'inside a nested block at the end of the declaration'
    : 'inside a nested block'
}

const isBlank = (line: string): boolean => line.trim().length === 0

// A line that only closes what an earlier line opened. In a brace-scoped language
// the closers dedent, so without this every nested trait would look like something
// the declaration continues past — the closing braces themselves would be the
// "shallower code that follows". The test is over punctuation only: a keyword list
// (`end`, `fi`, `done`) would be the per-language table this domain must not have,
// and the languages that use one dedent instead, where nothing needs excluding.
const closingOnlyPattern = /^[)\]},;]+$/u

const isClosingOnly = (line: string): boolean =>
  closingOnlyPattern.test(line.trim())

const indentationWidth = (line: string): number =>
  line.length - line.trimStart().length

const bandOf = (level: number): TraitDepthBand =>
  level <= SURFACE_MAX_LEVEL ? 'surface' : 'nested'

/**
 * The position of every line of a declaration span, indexed by offset from the
 * span's first line. A blank or fully-blanked line has no position.
 *
 * `codeLines` must be the comment- and string-blanked lines of the span, so a
 * commented-out block cannot contribute an indentation level and prose cannot make
 * a trait look nested.
 *
 * Note what the span construction guarantees: a span ends at the first line that
 * returns to the header's column, so no line after the header is ever at level 0.
 * A surface trait therefore cannot be followed by anything materially shallower,
 * and is always `exit`. Terminality does its work inside the `nested` band, which
 * is where the spec's motivating case lives — a nested block the declaration
 * continues past, against one that ends it. That is a consequence of how a span is
 * bounded rather than a shortcut taken here, and it is the reason the two
 * dimensions are stored separately even though one of them is currently constant
 * over part of the other's range.
 */
export const traitPositionsOfSpan = (
  codeLines: readonly string[],
  headerIndentation: number
): readonly (TraitPosition | undefined)[] => {
  const levelColumns = [
    ...new Set(
      codeLines
        .filter((line) => !isBlank(line))
        .map(indentationWidth)
        .filter((width) => width > headerIndentation)
    )
  ].sort((left, right) => left - right)
  const levels = codeLines.map((line) => {
    if (isBlank(line)) {
      return undefined
    }

    const width = indentationWidth(line)
    const index = levelColumns.indexOf(width)

    return index === -1 ? 0 : index + 1
  })
  const positions: (TraitPosition | undefined)[] = new Array<
    TraitPosition | undefined
  >(codeLines.length).fill(undefined)
  let minimumLevelAfter = Number.POSITIVE_INFINITY

  // Backwards, so the shallowest level still to come is known in one pass.
  for (let offset = codeLines.length - 1; offset >= 0; offset -= 1) {
    const level = levels[offset]

    if (level !== undefined) {
      positions[offset] = {
        depth: bandOf(level),
        terminality:
          minimumLevelAfter < level - RESUME_TOLERANCE ? 'interior' : 'exit'
      }

      if (!isClosingOnly(codeLines[offset] ?? '')) {
        minimumLevelAfter = Math.min(minimumLevelAfter, level)
      }
    }
  }

  return positions
}
