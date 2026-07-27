// Spec 19: the unit geometry of the un-anchored discovery pass.
//
// A unit is a span of lines the reviewer is shown on its own. The rule that
// produces the spans is deliberately the dumbest one that can work: it reads the
// number of lines and nothing else. It cannot consult the language, the syntax,
// the diff, or anything about what the file is expected to contain, because a
// unit rule that could see any of those could be tuned — knowingly or not —
// towards the defects the engine is scored on, and the resulting measurement
// would be worthless. Unit size and stride are configuration; they are never
// per-language or per-defect-class tuning.
//
// The same consequence stated positively: two files with the same line count are
// decomposed identically no matter what language they are written in.

export type UnanchoredUnit = {
  readonly startLine: number
  readonly endLine: number
}

export type UnanchoredUnitGeometry = {
  readonly unitLines: number
  readonly strideLines: number
}

/**
 * Derives the units of a span of `lineCount` lines, numbered from 1.
 *
 * Units start at line 1 and every `strideLines` after it, and each one runs for
 * `unitLines` lines or to the end of the span, whichever comes first. Overlap
 * (stride smaller than unit size) is intentional: a defect that straddles a unit
 * boundary is invisible to both neighbours without it.
 *
 * Enumeration stops at the first unit that reaches the last line, because every
 * later start would produce a strict subset of that unit's tail — the same code,
 * a second time, at the price of another model call.
 */
export const unanchoredUnitsForLineCount = (
  lineCount: number,
  geometry: UnanchoredUnitGeometry
): readonly UnanchoredUnit[] => {
  if (
    lineCount < 1 ||
    geometry.unitLines < 1 ||
    geometry.strideLines < 1
  ) {
    return []
  }

  const units: UnanchoredUnit[] = []

  for (
    let startLine = 1;
    startLine <= lineCount;
    startLine += geometry.strideLines
  ) {
    const endLine = Math.min(startLine + geometry.unitLines - 1, lineCount)

    units.push({ startLine, endLine })

    if (endLine >= lineCount) {
      break
    }
  }

  return units
}

/**
 * The units of a span of content whose first line is `contentStartLine` in the
 * file it came from, expressed in the FILE's line numbers.
 *
 * A file too large for one packet is split into chunks that each become their own
 * task, so the content a task carries can start partway into its file. The
 * geometry above is deliberately origin-free — it sees only a length — and this
 * is where the chunk's origin is applied. Deriving units in the chunk's own
 * coordinates and forgetting to translate them produces spans that look right and
 * point at the wrong lines, which is the same class of mislocation the chunk
 * numbering itself once had.
 */
export const unanchoredUnitsForSpan = (
  contentStartLine: number,
  lineCount: number,
  geometry: UnanchoredUnitGeometry
): readonly UnanchoredUnit[] =>
  unanchoredUnitsForLineCount(lineCount, geometry).map((unit) => ({
    startLine: unit.startLine + contentStartLine - 1,
    endLine: unit.endLine + contentStartLine - 1
  }))

/**
 * The text of one unit, taken from content whose first line is `contentStartLine`
 * in the file it came from.
 *
 * A file too large for one packet is already split into chunks that each become
 * their own task, so the content a task carries can start partway into its file.
 * Slicing against the chunk's own origin is what keeps a unit's declared span and
 * the line numbers the reviewer reads back pointing at the file's real lines.
 * Returns '' when the unit falls outside the content, which the caller treats as
 * a unit with nothing to review.
 */
export const unanchoredUnitText = (
  content: string,
  contentStartLine: number,
  unit: UnanchoredUnit
): string => {
  const lines = content.split('\n')
  const firstIndex = unit.startLine - contentStartLine
  const lastIndex = unit.endLine - contentStartLine

  if (firstIndex < 0 || firstIndex >= lines.length) {
    return ''
  }

  return lines.slice(firstIndex, lastIndex + 1).join('\n')
}
