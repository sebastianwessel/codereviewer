import { z } from 'zod'
import { parseGitDiffMaps } from '../../repository-intake/index.js'

// Diff scope of an expected finding (spec 17 *Diff Scope Of An Expectation*).
//
// The real-repository corpus reviews `base = fixCommit, head = parentCommit`, so
// a defect the upstream fix commit never touched is byte-identical on both sides
// and never enters the reviewed diff. It is pre-existing code the reviewer was
// not asked about, and the engine's measured recall on it is a different number
// entirely — in-diff and out-of-diff recall have been measured tens of points
// apart on the same runs. A single blended figure therefore says as much about
// the in/out ratio of the fixture set as about the reviewer.
//
// The classification is DERIVED from the reviewed diff, never hand-assigned and
// never read off the answer key or a case name: those would let the split drift
// case by case, which is exactly what the spec's storage requirement exists to
// prevent.
export const DiffScopeSchema = z.enum(['in-diff', 'out-of-diff', 'undetermined'])

export type DiffScope = z.infer<typeof DiffScopeSchema>

export const allDiffScopes = DiffScopeSchema.options

// Head-coordinate spans of every hunk, per path. `[c, c+d-1]` for a hunk header
// `@@ -a,b +c,d @@`, which is the whole region the reviewer is shown, not just
// the added lines within it.
export type DiffHunkSpansByPath = ReadonlyMap<
  string,
  readonly (readonly [number, number])[]
>

// THE RULE IS HUNK SPAN, NOT ADDED LINES. A fix that only ADDS a guard reverses
// into a pure deletion, and the reviewer is still shown that hunk with its
// surrounding context, so the region is genuinely under review. Measured on the
// same runs, an added-lines rule reported out-of-diff recall of 8.8% where the
// hunk-span rule reports 0.0%: the difference was entirely regions the stricter
// rule had misclassified as unreviewed.
export const hunkSpansByPath = (diff: string): DiffHunkSpansByPath => {
  const spans = new Map<string, (readonly [number, number])[]>()

  for (const diffMap of parseGitDiffMaps(diff)) {
    const pathSpans = spans.get(diffMap.path) ?? []

    for (const hunk of diffMap.hunks) {
      // A hunk with no new-side lines at all (`+c,0`, a whole-file deletion or a
      // zero-context diff) has an EMPTY `[c, c+d-1]` span, which can never
      // intersect anything and would silently classify a region the reviewer was
      // shown as unreviewed. It is collapsed to the single head coordinate the
      // header names instead, so the hunk still counts, as the rule requires.
      pathSpans.push(
        hunk.newLineCount === 0
          ? [hunk.newStartLine, hunk.newStartLine]
          : [hunk.newStartLine, hunk.newStartLine + hunk.newLineCount - 1]
      )
    }

    spans.set(diffMap.path, pathSpans)
  }

  return spans
}

export type DiffScopeExpectation = {
  readonly path?: string | undefined
  readonly lineRange?: readonly [number, number] | undefined
}

// `undetermined` is a THIRD outcome, not a synonym for out-of-diff. An
// expectation with no path or no declared line range cannot be placed by the
// hunk-span rule at all, and a case whose reviewed diff was never captured
// carries no coordinates to place it against. Calling either of those
// "out-of-diff" would quietly move an unclassifiable expectation into the
// population the engine scores worst on and depress that number with data that
// says nothing about it.
export const classifyExpectedFindingDiffScope = (
  expected: DiffScopeExpectation,
  hunkSpans: DiffHunkSpansByPath | undefined
): DiffScope => {
  if (
    hunkSpans === undefined ||
    expected.path === undefined ||
    expected.lineRange === undefined
  ) {
    return 'undetermined'
  }

  const [expectedStart, expectedEnd] = expected.lineRange
  const pathSpans = hunkSpans.get(expected.path) ?? []
  const intersectsHunk = pathSpans.some(
    ([hunkStart, hunkEnd]) => expectedStart <= hunkEnd && expectedEnd >= hunkStart
  )

  // A path the diff never mentions is genuinely outside it: the file is
  // byte-identical on both sides, so nothing about it was under review.
  return intersectsHunk ? 'in-diff' : 'out-of-diff'
}

// Diff scope of every expected finding of a case, positionally aligned to
// `expectedFindings` so the result indexes by `expectedIndex`. The diff is
// parsed once per case rather than once per expectation.
export const expectedFindingDiffScopes = (
  evalCase: {
    readonly diff?: string | undefined
    readonly expectedFindings: readonly DiffScopeExpectation[]
  }
): readonly DiffScope[] => {
  const hunkSpans =
    evalCase.diff === undefined ? undefined : hunkSpansByPath(evalCase.diff)

  return evalCase.expectedFindings.map((expected) =>
    classifyExpectedFindingDiffScope(expected, hunkSpans)
  )
}
