import { normalizeRepositoryRelativePath } from '../../platform/repository-path.js'

// UNIFIED-DIFF HEADER SYNTAX, PARSED IN ONE PLACE.
//
// Three domains read the same `git diff` text for different reasons:
// `repository-intake` derives the changed-line set the reviewer is scored ON,
// `evaluation`'s benchmark hydration derives the head-side files the corpus's
// expectations are anchored TO, and `review-workflow`'s discovery packet selects
// the hunks the reviewer is SHOWN for the paths intake named. Those must agree by
// construction. When each domain kept its own copy of this parsing, a fix to
// git's C-quoted path decoding applied to one side could move measured recall
// without the engine changing, and nothing in a report would say so — which is
// precisely what the packet's own copy did: it compared undecoded header bytes
// against intake's decoded paths and silently dropped the hunks of every file
// git had quoted.

const diffHeaderPattern =
  /^diff --git (?:"a\/(.+?)"|a\/(\S+)) (?:"b\/(.+?)"|b\/(\S+))$/u

const hunkHeaderPattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u

// Git wraps paths with special characters in C-style double quotes. Decode the
// standard escapes so the real path is recovered before normalization.
const gitEscapePattern = /\\(\\|"|t|n|r|[0-7]{1,3})/gu

const unescapeGitPath = (value: string): string =>
  value.replace(gitEscapePattern, (_match, escape: string) => {
    switch (escape) {
      case '\\':
        return '\\'
      case '"':
        return '"'
      case 't':
        return '\t'
      case 'n':
        return '\n'
      case 'r':
        return '\r'
      default:
        return String.fromCharCode(Number.parseInt(escape, 8))
    }
  })

// A header path carries a backslash only when git produced the diff on a
// Windows checkout, where the backslash is a separator; a POSIX diff path never
// contains one, because git would have C-quoted and escaped it instead.
const normalizeDiffPath = (rawPath: string): string =>
  normalizeRepositoryRelativePath(rawPath, {
    flavor: rawPath.includes('\\') ? 'win32' : 'posix'
  })

/**
 * The HEAD-side (`b/`) path a `diff --git` header names, normalized to a
 * repository-relative portable path, or `undefined` when the line is not a diff
 * header.
 *
 * Always the `b/` side, never the `a/` side: the header pattern requires both,
 * so the head side is always present, and every consumer identifies a file by
 * where it is AFTER the change. A rename whose old path needed quoting and whose
 * new path did not must still resolve to the new path.
 *
 * Throws whatever `normalizeRepositoryRelativePath` throws for a path that
 * escapes the repository root — a diff naming such a path is malformed input,
 * not a file to review.
 */
export const parseGitDiffNewPath = (line: string): string | undefined => {
  const match = diffHeaderPattern.exec(line)

  if (match === null) {
    return undefined
  }

  // The quoted capture carries C-style escapes; the unquoted capture is literal
  // and may use backslash separators on Windows.
  const quotedPath = match[3]

  if (quotedPath !== undefined) {
    return normalizeDiffPath(unescapeGitPath(quotedPath))
  }

  const unquotedPath = match[4]

  return unquotedPath === undefined ? undefined : normalizeDiffPath(unquotedPath)
}

export type GitDiffHunkHeader = {
  // 1-based start line and line count on the PRE-change side.
  readonly oldStartLine: number
  readonly oldLineCount: number
  // 1-based start line and line count on the POST-change side.
  readonly newStartLine: number
  readonly newLineCount: number
}

// Git omits `,<count>` from a hunk range when the count is 1.
const parseHunkLineCount = (value: string | undefined): number =>
  value === undefined ? 1 : Number.parseInt(value, 10)

/**
 * Both ranges of an `@@ -a,b +c,d @@` hunk header, or `undefined` when the line
 * is not one.
 *
 * Deliberately returns BOTH sides even though some callers read only one. The
 * previous per-domain copies of this pattern had already drifted — one captured
 * the old-side range and the other discarded it — which meant the two parsers
 * could not be swapped for each other, and the capture-group index a caller read
 * depended on which copy it happened to import.
 */
export const parseGitDiffHunkHeader = (
  line: string
): GitDiffHunkHeader | undefined => {
  const match = hunkHeaderPattern.exec(line)

  if (match === null) {
    return undefined
  }

  return {
    // Groups 1 and 3 are non-optional in the pattern, so a match always carries
    // them; the `?? ''` only satisfies `noUncheckedIndexedAccess`, and
    // `Number.parseInt('')` is NaN rather than a plausible line number.
    oldStartLine: Number.parseInt(match[1] ?? '', 10),
    oldLineCount: parseHunkLineCount(match[2]),
    newStartLine: Number.parseInt(match[3] ?? '', 10),
    newLineCount: parseHunkLineCount(match[4])
  }
}

/**
 * The segments of a unified diff that belong to the given paths, joined into one
 * text — a per-task view of a whole-run diff.
 *
 * Lives here, beside the header parser it is built on, because it has two
 * consumers that must agree: the discovery packet builder, which decides what the
 * model actually sees for a task, and the context ledger, which accounts for what
 * was sent. Accounting computed a different way from presentation is accounting
 * that can be wrong without anything failing.
 *
 * Truncation is not this function's job. A segment whose header path does not
 * match is simply not emitted; a diff with no matching segment yields ''.
 *
 * The header is read with `parseGitDiffNewPath` — the shared parser, which is
 * authoritative for a reason this function is a live example of. The `paths` it
 * is given were produced by intake from the same header text through that same
 * parser, so the two strings compared here are only comparable if ONE parser
 * produced both. A private copy of the pattern kept the header bytes verbatim,
 * and git C-quotes and octal-escapes any path with a non-ASCII byte — so a
 * changed `café.ts` was captured as `src/caf\303\251.ts`, matched no reviewed
 * path, and had its entire hunk dropped from a section headed "What this change
 * modified". Nothing said so: an unmatched segment is simply not emitted.
 */
export const diffSegmentsForPaths = (
  rawDiff: string,
  paths: readonly string[]
): string => {
  if (rawDiff.trim().length === 0) {
    return ''
  }

  const pathSet = new Set(paths)
  const segments: string[] = []
  let current: string[] | undefined
  let currentPath: string | undefined

  const flush = (): void => {
    if (
      current !== undefined &&
      currentPath !== undefined &&
      pathSet.has(currentPath)
    ) {
      segments.push(current.join('\n'))
    }
  }

  for (const line of rawDiff.split('\n')) {
    const headerPath = parseGitDiffNewPath(line)

    if (headerPath !== undefined) {
      flush()
      current = [line]
      currentPath = headerPath
      continue
    }

    if (current !== undefined) {
      current.push(line)
    }
  }

  flush()

  return segments.join('\n\n')
}
