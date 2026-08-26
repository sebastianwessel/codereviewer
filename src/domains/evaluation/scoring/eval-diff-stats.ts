import {
  parseChangedLines,
  parseGitDiffMaps
} from '../../repository-intake/index.js'

export type EvalDiffStats = {
  readonly changedLineCount: number
  readonly diffHunkCount: number
}

/**
 * The per-case diff size a report publishes (spec 06: `changedLineCount` counts
 * added new-side lines excluding file headers; `diffHunkCount` counts parsed hunk
 * headers).
 *
 * BOTH NUMBERS NOW COME FROM THE SAME PARSER, which they did not before. The hunk
 * count always went through `parseGitDiffMaps`; the line count was a standalone
 * scan that called a line "added" whenever it began with `+` and did not begin with
 * `+++`, anywhere in the diff text, with no notion of being inside a hunk. Its
 * third condition — `!line.startsWith('diff --git ')` — could never be false, since
 * a line beginning with `+` cannot also begin with `d`; it read as a guard and
 * guarded nothing, which is how the scan looked more careful than it was.
 *
 * WHAT THE PREFIX TEST GETS WRONG. `'+++'` is not a header marker inside a hunk
 * body. A hunk line's first character is the marker and the REST is file content,
 * so the line `++++ b/src/app.ts` is an added line whose content is `+++ b/src/app.ts`
 * — a file that itself contains a unified diff. The scan dropped it as a header.
 * That case is not exotic for a code-review tool, whose fixtures and reports are
 * largely diffs about diffs, and it was measured on this repository's own history:
 * 2 of 400 commits, 12 lines, always UNDERCOUNTING (see the metrics-version entry
 * `2026-08-16.hunk-aware-changed-line-count`). It undercounts rather than inflates
 * because the failing prefix test only ever REMOVES lines from the tally.
 *
 * Walking the parsed hunks fixes both halves at once: `+++ b/…` is skipped because
 * it precedes the first `@@` rather than because of how it is spelled, and every
 * line inside a hunk body is judged on its marker alone.
 */
export const calculateEvalDiffStats = (diff: string): EvalDiffStats => {
  const changedLinesByPath = parseChangedLines(diff)
  let changedLineCount = 0

  for (const changedLines of changedLinesByPath.values()) {
    changedLineCount += changedLines.added.length
  }

  return {
    changedLineCount,
    diffHunkCount: parseGitDiffMaps(diff).reduce(
      (count, diffMap) => count + diffMap.hunks.length,
      0
    )
  }
}
