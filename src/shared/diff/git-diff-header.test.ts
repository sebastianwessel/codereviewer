import { describe, expect, it } from 'vitest'
import {
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
