// Spec 25: which changed lines gate whether following code runs, and what code
// they gate.
//
// The trigger is a CONDITIONAL LINE the diff touched, inside a declaration, with
// something after it. Nothing about authorization, validation, safety or any
// other category — those would be the vendor- and language-specific taxonomy
// spec 15's Non-Negotiable forbids, and the adapted source (codex-security's
// `security-diff-scan`) states its own version of this rule as a list of helper
// kinds precisely because it is free of that constraint and we are not.
//
// WHY NOT ALSO "A CALL ON THE EXIT PATH".
//
// Spec 25's trigger names two shapes: a guard, and a call whose position is
// terminal for the declaration. The second is not implemented, and the reason is
// a property of `trait-position.ts` rather than a judgement: a span ends at the
// first line returning to the header's column, so no line after the header is
// ever materially shallower than a surface line, and EVERY surface trait is
// therefore `exit` by construction. Read literally, the second clause matches
// almost every changed line in a declaration body — it would not be a trigger, it
// would be the absence of one. The guard clause carries the spec's actual
// requirement ("a construct that gates whether following code runs") on its own.
//
// WHAT THIS CANNOT SEE, STATED RATHER THAN IMPLIED.
//
// A guard deleted OUTRIGHT leaves no conditional line in the head revision, so
// this finds nothing for it. Detecting that needs the base revision, which this
// module is not given. The three largest consequence shapes in the survey —
// widened scope (41), weakened in place (24), new code missing a check (17) — all
// keep a conditional line in the head and are reachable; pure removal (a minority
// shape, and the one the reviewer already sees as a deletion hunk in the diff) is
// not.

import {
  callNamesIn,
  isConditionalLine
} from './declaration-shape.js'
import {
  codeLinesOfSpan,
  declarationSpanAt,
  type SourceLines
} from './declaration-span.js'

export type GuardedRegion = {
  readonly declarationName: string
  // 1-based, the changed conditional line itself.
  readonly guardLine: number
  // 1-based inclusive extent of what that line precedes, bounded by the
  // declaration span. Spec 25: "the remainder of the enclosing declaration that
  // the guard precedes".
  readonly governedStartLine: number
  readonly governedEndLine: number
  // Names called inside the governed region, de-duplicated, in source order. The
  // ranking input for spec 25's Arm B; empty is normal and not an error.
  readonly calleeNames: readonly string[]
}

export type FindGuardedRegionsInput = {
  readonly lines: SourceLines
  // The declaration header line as `deterministic-signals` reports it.
  readonly declarationStartLine: number
  readonly declarationName: string
  // 1-based line numbers the diff added or modified in this file.
  readonly changedLines: ReadonlySet<number>
}

/**
 * The guarded regions of one declaration: every changed conditional line in it,
 * with what that line precedes and what that region calls.
 *
 * Returns empty — the normal case — when the declaration has no changed
 * conditional, when the span cannot be reconstructed, or when the only changed
 * conditional is the declaration's last line and therefore governs nothing.
 */
export const findGuardedRegions = (
  input: FindGuardedRegionsInput
): readonly GuardedRegion[] => {
  const span = declarationSpanAt(input.lines, input.declarationStartLine)

  if (span === undefined) {
    return []
  }

  // Comment- and string-blanked, so a conditional written inside a comment or a
  // string literal cannot trigger, and prose inside the governed region cannot
  // contribute a callee.
  const codeLines = codeLinesOfSpan(input.lines, span)
  const regions: GuardedRegion[] = []

  for (const [offset, codeLine] of codeLines.entries()) {
    const guardLine = span.startLine + offset

    if (!input.changedLines.has(guardLine) || !isConditionalLine(codeLine)) {
      continue
    }

    // A conditional on the declaration's final line precedes nothing inside it.
    // Reporting it would state a region of zero lines as if it were evidence.
    if (guardLine >= span.endLine) {
      continue
    }

    const governedStartLine = guardLine + 1
    const calleeNames: string[] = []

    for (
      let governed = governedStartLine;
      governed <= span.endLine;
      governed += 1
    ) {
      const governedCodeLine = codeLines[governed - span.startLine] ?? ''

      for (const name of callNamesIn(governedCodeLine, input.declarationName)) {
        if (!calleeNames.includes(name)) {
          calleeNames.push(name)
        }
      }
    }

    regions.push({
      declarationName: input.declarationName,
      guardLine,
      governedStartLine,
      governedEndLine: span.endLine,
      calleeNames
    })
  }

  return regions
}
