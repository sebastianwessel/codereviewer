import { describe, expect, it } from 'vitest'
import {
  diffSegmentsForPaths,
  parseGitDiffHunkHeader,
  parseGitDiffNewPath
} from './git-diff-header.js'

describe('parseGitDiffNewPath', () => {
  it('returns undefined for a line that is not a diff header', () => {
    expect(parseGitDiffNewPath('@@ -1,2 +3,4 @@')).toBeUndefined()
    expect(parseGitDiffNewPath('+++ b/src/app.ts')).toBeUndefined()
  })

  it('reads an unquoted POSIX path', () => {
    expect(parseGitDiffNewPath('diff --git a/src/app.ts b/src/app.ts')).toBe(
      'src/app.ts'
    )
  })

  it('normalizes a Windows-separated unquoted path to a portable path', () => {
    expect(
      parseGitDiffNewPath('diff --git a/src\\win.ts b/src\\win.ts')
    ).toBe('src/win.ts')
  })

  it('decodes C-style escapes in a quoted path', () => {
    expect(
      parseGitDiffNewPath('diff --git "a/src/a\\tb.ts" "b/src/a\\tb.ts"')
    ).toBe('src/a\tb.ts')
  })

  it('decodes octal escapes in a quoted path', () => {
    // Git escapes non-ASCII bytes octally; \303\251 is UTF-8 for "é", which git
    // emits byte-wise, so each byte decodes to its own code unit here.
    expect(
      parseGitDiffNewPath('diff --git "a/src/caf\\303\\251.ts" "b/src/caf\\303\\251.ts"')
    ).toBe('src/cafÃ©.ts')
  })

  // A rename whose OLD path needed quoting and whose new path did not is the
  // case the two former per-domain copies disagreed on: one returned the old
  // path here, silently attributing the change to a file that no longer exists.
  it('returns the head-side path when only the old path is quoted', () => {
    expect(
      parseGitDiffNewPath('diff --git "a/src/old name.ts" b/src/new.ts')
    ).toBe('src/new.ts')
  })
})

describe('parseGitDiffHunkHeader', () => {
  it('returns undefined for a line that is not a hunk header', () => {
    expect(parseGitDiffHunkHeader('diff --git a/a.ts b/a.ts')).toBeUndefined()
    expect(parseGitDiffHunkHeader('-removed')).toBeUndefined()
  })

  it('reads both ranges', () => {
    expect(parseGitDiffHunkHeader('@@ -10,3 +20,5 @@ context')).toEqual({
      oldStartLine: 10,
      oldLineCount: 3,
      newStartLine: 20,
      newLineCount: 5
    })
  })

  it('defaults an omitted line count to 1, as git does', () => {
    expect(parseGitDiffHunkHeader('@@ -7 +9 @@')).toEqual({
      oldStartLine: 7,
      oldLineCount: 1,
      newStartLine: 9,
      newLineCount: 1
    })
  })

  it('preserves a zero-length new side for a pure deletion', () => {
    expect(parseGitDiffHunkHeader('@@ -4,2 +3,0 @@')).toEqual({
      oldStartLine: 4,
      oldLineCount: 2,
      newStartLine: 3,
      newLineCount: 0
    })
  })
})

// A reactive split (spec 26) halves a file into two tasks that keep the SAME path.
// Selection was by path alone, so both halves rendered the file's whole diff: the
// split halved the source and not the diff, and each half was shown hunks for lines
// it could not see — which invites a finding outside its own chunk that admission
// then rejects.
describe('diffSegmentsForPaths line-range clipping', () => {
  const rawDiff = [
    'diff --git a/src/app.ts b/src/app.ts',
    'index 1111111..2222222 100644',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -10,3 +10,3 @@',
    '-const early = 1',
    '+const early = 2',
    ' const untouched = 0',
    '@@ -600,2 +600,2 @@',
    '-const late = 1',
    '+const late = 2'
  ].join('\n')

  it('emits the whole diff when the path has no range', () => {
    const segments = diffSegmentsForPaths(rawDiff, ['src/app.ts'])

    expect(segments).toContain('const early = 2')
    expect(segments).toContain('const late = 2')
  })

  it('keeps only the hunks a chunk covers', () => {
    const firstHalf = diffSegmentsForPaths(
      rawDiff,
      ['src/app.ts'],
      new Map([['src/app.ts', { startLine: 1, endLine: 500 }]])
    )
    const secondHalf = diffSegmentsForPaths(
      rawDiff,
      ['src/app.ts'],
      new Map([['src/app.ts', { startLine: 501, endLine: 1000 }]])
    )

    expect(firstHalf).toContain('const early = 2')
    expect(firstHalf).not.toContain('const late = 2')
    expect(secondHalf).toContain('const late = 2')
    expect(secondHalf).not.toContain('const early = 2')

    // The header preamble survives on both, so each half still reads as a diff.
    expect(firstHalf).toContain('+++ b/src/app.ts')
    expect(secondHalf).toContain('+++ b/src/app.ts')
  })

  // A header with no hunks under it reads as "this file changed, and here is the
  // change" while showing none.
  it('emits nothing for a path whose range no hunk touches', () => {
    expect(
      diffSegmentsForPaths(
        rawDiff,
        ['src/app.ts'],
        new Map([['src/app.ts', { startLine: 200, endLine: 300 }]])
      )
    ).toBe('')
  })

  // A pure deletion has a zero-length new side. Treating that as an empty span
  // would match no range at all and drop the hunk from every chunk.
  it('anchors a zero-count new side at its start line', () => {
    const deletion = [
      'diff --git a/src/app.ts b/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -40,2 +39,0 @@',
      '-const removed = 1'
    ].join('\n')

    expect(
      diffSegmentsForPaths(
        deletion,
        ['src/app.ts'],
        new Map([['src/app.ts', { startLine: 30, endLine: 50 }]])
      )
    ).toContain('const removed = 1')
  })
})
