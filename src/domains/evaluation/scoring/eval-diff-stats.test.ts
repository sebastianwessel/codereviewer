// `changedLineCount` is published per eval case and divides `commentsPerKloc`, so
// a miscount is not cosmetic: it moves a rate nobody would think to re-derive.
//
// THE DEFECT THIS PINS. The count used to be a standalone scan over the raw diff
// text — "starts with `+`, does not start with `+++`" — with no notion of being
// inside a hunk. Inside a hunk body the first character is the marker and the rest
// is file content, so an added line whose CONTENT begins with `+++` arrives as
// `++++ …` and was dropped as though it were a `+++ b/path` file header. A
// code-review tool's own corpora are diffs about diffs, so the case is ordinary
// rather than adversarial: measured across 400 commits of this repository it hit 2
// of them, always undercounting.
//
// The direction matters and is asserted below. The failing prefix test can only
// ever REMOVE lines from the tally, so this class of error understates diff size
// and therefore OVERSTATES `commentsPerKloc`. A reader who assumed the opposite
// would look for the bias in the wrong place.

import { describe, expect, test } from 'vitest'
import { calculateEvalDiffStats } from './eval-diff-stats.js'

const diffOf = (...lines: readonly string[]): string => `${lines.join('\n')}\n`

describe('eval diff stats', () => {
  test('counts added new-side lines and hunk headers', () => {
    const stats = calculateEvalDiffStats(
      diffOf(
        'diff --git a/src/app.ts b/src/app.ts',
        'index 1111111..2222222 100644',
        '--- a/src/app.ts',
        '+++ b/src/app.ts',
        '@@ -1,2 +1,3 @@',
        ' const kept = 1',
        '-const removed = 2',
        '+const added = 2',
        '+const alsoAdded = 3',
        '@@ -10,1 +11,2 @@',
        ' const tail = 4',
        '+const tailAdded = 5'
      )
    )

    expect(stats).toEqual({ changedLineCount: 3, diffHunkCount: 2 })
  })

  test('counts an added line whose own content is a diff header', () => {
    // THE REGRESSION. `++++ b/src/app.ts` is one added line whose content is
    // `+++ b/src/app.ts` — a fixture file that itself holds a unified diff. The old
    // scan matched it against `startsWith('+++')` and discarded it as a header.
    const stats = calculateEvalDiffStats(
      diffOf(
        'diff --git a/eval/fixture.md b/eval/fixture.md',
        '--- a/eval/fixture.md',
        '+++ b/eval/fixture.md',
        '@@ -1,0 +1,5 @@',
        '+diff --git a/src/app.ts b/src/app.ts',
        '+--- a/src/app.ts',
        '++++ b/src/app.ts',
        '+@@ -1,1 +1,1 @@',
        '++const embeddedAddition = 1'
      )
    )

    // Five added lines, including the two the prefix test would have dropped.
    expect(stats.changedLineCount).toBe(5)
    // Exactly one hunk: the embedded `+@@ …` is content, not a hunk header, and
    // must not be counted as one either.
    expect(stats.diffHunkCount).toBe(1)
  })

  test('ignores the `+++` file header itself', () => {
    // The complement of the test above, and the reason the header cannot simply be
    // matched by spelling: `+++ b/…` is excluded because it precedes the first `@@`,
    // not because of the characters it starts with.
    const stats = calculateEvalDiffStats(
      diffOf(
        'diff --git a/src/new.ts b/src/new.ts',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/src/new.ts',
        '@@ -0,0 +1,1 @@',
        '+export const created = 1'
      )
    )

    expect(stats.changedLineCount).toBe(1)
  })

  test('counts nothing outside a hunk', () => {
    // A diff that never opens a hunk has no added lines, however many `+` lines its
    // headers carry. The old scan had no way to express this.
    const stats = calculateEvalDiffStats(
      diffOf(
        'diff --git a/src/renamed.ts b/src/moved.ts',
        'similarity index 100%',
        'rename from src/renamed.ts',
        'rename to src/moved.ts'
      )
    )

    expect(stats).toEqual({ changedLineCount: 0, diffHunkCount: 0 })
  })

  test('sums across files and tolerates CRLF diffs', () => {
    const stats = calculateEvalDiffStats(
      [
        'diff --git a/a.ts b/a.ts',
        '--- a/a.ts',
        '+++ b/a.ts',
        '@@ -1,0 +1,1 @@',
        '+const a = 1',
        'diff --git a/b.ts b/b.ts',
        '--- a/b.ts',
        '+++ b/b.ts',
        '@@ -1,0 +1,2 @@',
        '+const b = 1',
        '+const c = 2'
      ].join('\r\n')
    )

    expect(stats).toEqual({ changedLineCount: 3, diffHunkCount: 2 })
  })

  test('an empty diff measures zero rather than failing', () => {
    expect(calculateEvalDiffStats('')).toEqual({
      changedLineCount: 0,
      diffHunkCount: 0
    })
  })
})
