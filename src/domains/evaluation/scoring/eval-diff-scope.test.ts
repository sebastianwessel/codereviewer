import { describe, expect, test } from 'vitest'
import {
  classifyExpectedFindingDiffScope,
  expectedFindingDiffScopes,
  hunkSpansByPath
} from './eval-diff-scope.js'

// A reversed fix: the upstream commit ADDED a guard, so the reviewed diff (base
// = fix commit, head = parent commit) REMOVES it. The hunk therefore carries no
// added line at all, which is exactly the shape an added-lines rule cannot see.
const guardRemovalDiff = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -20,7 +20,4 @@ export const run = () => {
   const value = compute()
-  if (value === undefined) {
-    throw new Error('value is required')
-  }
   return value
 }
`

describe('expectation diff scope', () => {
  test('reads hunk spans from the head coordinates of the hunk header', () => {
    // `@@ -20,7 +20,4 @@` spans [20, 20 + 4 - 1] on the head side.
    expect(hunkSpansByPath(guardRemovalDiff)).toEqual(
      new Map([['src/app.ts', [[20, 23]]]])
    )
  })

  test('classifies a pure-deletion hunk as in-diff, which an added-lines rule cannot', () => {
    // The reviewer is shown this hunk with its surrounding context, so the
    // region is genuinely under review even though the diff adds nothing here.
    // Measured on the same runs, the added-lines rule reported 8.8% out-of-diff
    // recall where this rule reports 0.0%; the difference was entirely regions
    // the stricter rule had misclassified as unreviewed.
    expect(
      classifyExpectedFindingDiffScope(
        { path: 'src/app.ts', lineRange: [21, 22] },
        hunkSpansByPath(guardRemovalDiff)
      )
    ).toBe('in-diff')
  })

  test('classifies by span boundary, not by proximity', () => {
    const spans = hunkSpansByPath(guardRemovalDiff)

    expect(
      classifyExpectedFindingDiffScope(
        { path: 'src/app.ts', lineRange: [23, 40] },
        spans
      )
    ).toBe('in-diff')
    expect(
      classifyExpectedFindingDiffScope(
        { path: 'src/app.ts', lineRange: [24, 40] },
        spans
      )
    ).toBe('out-of-diff')
    expect(
      classifyExpectedFindingDiffScope(
        { path: 'src/app.ts', lineRange: [1, 19] },
        spans
      )
    ).toBe('out-of-diff')
  })

  test('classifies an expectation in a file the diff never mentions as out-of-diff', () => {
    // The corpus reviews `base = fixCommit, head = parentCommit`, so a defect
    // the fix never touched is byte-identical on both sides and never enters the
    // diff at all.
    expect(
      classifyExpectedFindingDiffScope(
        { path: 'src/legacy.ts', lineRange: [21, 22] },
        hunkSpansByPath(guardRemovalDiff)
      )
    ).toBe('out-of-diff')
  })

  test('counts a hunk with no head-side lines rather than dropping it', () => {
    // `+80,0` yields an EMPTY `[c, c+d-1]` span, which could never intersect
    // anything and would silently read as unreviewed.
    const wholeFileDeletionDiff = `diff --git a/src/gone.ts b/src/gone.ts
--- a/src/gone.ts
+++ /dev/null
@@ -80,3 +80,0 @@
-const a = 1
-const b = 2
-const c = 3
`

    expect(
      classifyExpectedFindingDiffScope(
        { path: 'src/gone.ts', lineRange: [80, 80] },
        hunkSpansByPath(wholeFileDeletionDiff)
      )
    ).toBe('in-diff')
  })

  test('reports an unplaceable expectation as undetermined, never as out-of-diff', () => {
    const spans = hunkSpansByPath(guardRemovalDiff)

    // No line range and no path mean the hunk-span rule has nothing to place.
    // Calling either "out-of-diff" would move an unclassifiable expectation into
    // the population the engine scores worst on.
    expect(
      classifyExpectedFindingDiffScope({ path: 'src/app.ts' }, spans)
    ).toBe('undetermined')
    expect(
      classifyExpectedFindingDiffScope({ lineRange: [21, 22] }, spans)
    ).toBe('undetermined')
    expect(
      classifyExpectedFindingDiffScope(
        { path: 'src/app.ts', lineRange: [21, 22] },
        undefined
      )
    ).toBe('undetermined')
  })

  test('classifies every expectation of a case positionally by expectedIndex', () => {
    const scopes = expectedFindingDiffScopes({
      diff: guardRemovalDiff,
      expectedFindings: [
        { path: 'src/app.ts', lineRange: [21, 22] },
        { path: 'src/app.ts', lineRange: [400, 401] },
        { path: 'src/legacy.ts', lineRange: [1, 2] },
        { semanticSummary: 'no location' } as { path?: string }
      ]
    })

    expect(scopes).toEqual([
      'in-diff',
      'out-of-diff',
      'out-of-diff',
      'undetermined'
    ])
  })

  test('classifies a case with no captured diff as undetermined throughout', () => {
    expect(
      expectedFindingDiffScopes({
        expectedFindings: [{ path: 'src/app.ts', lineRange: [21, 22] }]
      })
    ).toEqual(['undetermined'])
  })

  test('separates hunk spans per file in a multi-file diff', () => {
    const multiFileDiff = `${guardRemovalDiff}diff --git a/src/other.ts b/src/other.ts
--- a/src/other.ts
+++ b/src/other.ts
@@ -5,4 +5,5 @@
   const x = 1
+  const y = 2
   return x
 }
@@ -60,3 +61,3 @@
-  const old = true
+  const next = true
   return next
`

    const spans = hunkSpansByPath(multiFileDiff)

    expect(spans.get('src/other.ts')).toEqual([
      [5, 9],
      [61, 63]
    ])
    // A line inside the FIRST file's hunk must not be credited against the
    // second file's spans.
    expect(
      classifyExpectedFindingDiffScope(
        { path: 'src/other.ts', lineRange: [21, 22] },
        spans
      )
    ).toBe('out-of-diff')
    expect(
      classifyExpectedFindingDiffScope(
        { path: 'src/other.ts', lineRange: [62, 62] },
        spans
      )
    ).toBe('in-diff')
  })
})
