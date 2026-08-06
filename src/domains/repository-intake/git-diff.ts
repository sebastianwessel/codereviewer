import {
  parseGitDiffHunkHeader,
  parseGitDiffNewPath,
  type GitDiffHunkHeader
} from '../../shared/diff/git-diff-header.js'

// The hunk ranges exactly as the shared header parser reports them. Aliased
// rather than restated so the domain type cannot drift from what is parsed.
export type DiffHunk = GitDiffHunkHeader

export type DiffMap = {
  readonly path: string
  readonly changeKind: 'new' | 'modified' | 'deleted'
  readonly hunks: readonly DiffHunk[]
}

type MutableDiffMap = {
  path: string
  changeKind: 'new' | 'modified' | 'deleted'
  hunks: DiffHunk[]
}

export type RemovedLine = {
  // 1-based line number on the PRE-change side. A removed line has no post-change
  // number, which is exactly why it needs its own address space.
  readonly line: number
  readonly text: string
}

/**
 * Every line the diff removes, per path, numbered on the pre-change side.
 *
 * Spec 23's 2026-07-30 amendment: an obligation judged addressed may cite a line
 * the change REMOVED. Without this, a deletion is unprovable — it creates no line
 * to point at — and *"remove the old caching layer"* could never be judged
 * addressed however completely it was done. Measured on this repository's own
 * revert commit, every one of nine removal obligations came back wrong.
 *
 * Unlike `parseDeletedFileContents` below, this covers MODIFIED files too. That
 * function reconstructs whole files and must therefore refuse a partial old side;
 * here a partial view is the point, because each removed line is cited
 * individually rather than assembled into a document.
 */
export const parseRemovedLines = (
  diffOutput: string
): ReadonlyMap<string, readonly RemovedLine[]> => {
  const removed = new Map<string, RemovedLine[]>()
  let currentPath: string | undefined
  // Tracks the pre-change line number as the hunk body is walked. Context lines
  // and removals advance it; additions do not exist on the old side.
  let oldLine = 0

  for (const line of diffOutput.split(/\r?\n/)) {
    const path = parseGitDiffNewPath(line)

    if (path !== undefined) {
      currentPath = path
      oldLine = 0
      continue
    }

    const hunk = parseGitDiffHunkHeader(line)

    if (hunk !== undefined) {
      oldLine = hunk.oldStartLine
      continue
    }

    if (currentPath === undefined || oldLine === 0) {
      continue
    }

    // `---` and `+++` file headers start with the marker characters but are not
    // hunk body lines; they are skipped because `oldLine` is still 0 above.
    if (line.startsWith('-')) {
      const text = line.slice(1)

      if (text.trim().length > 0) {
        const entries = removed.get(currentPath) ?? []
        entries.push({ line: oldLine, text })
        removed.set(currentPath, entries)
      }

      oldLine += 1
      continue
    }

    if (line.startsWith('+')) {
      continue
    }

    if (line.startsWith(' ') || line.length === 0) {
      oldLine += 1
    }
  }

  return removed
}

export type ChangedLine = {
  // 1-based HEAD-side line number. For an added line that is simply where the
  // line now is. For a removed line there is no such number — the line does not
  // exist on the head side — so this is an ANCHOR: the head-side position the
  // removal sits at. See `parseChangedLines` for what that position is and why.
  readonly line: number
  readonly text: string
}

export type ChangedLines = {
  readonly added: readonly ChangedLine[]
  readonly removed: readonly ChangedLine[]
}

/**
 * Every line the diff adds and removes, per path, addressed in HEAD-side line
 * numbers on both sides.
 *
 * `parseRemovedLines` above numbers removals on the pre-change side, which is
 * what citing a deleted line needs. This function answers a different question —
 * *which changed lines fall inside this symbol's span?* — and a symbol's span is
 * only knowable on the head side, because that is the side whose content was
 * parsed for declarations. Two coordinate systems cannot be intersected, so both
 * sides are expressed in the head's.
 *
 * **The removed-line anchor.** A removed line is attributed to the head-side line
 * number the walker has reached when it meets the removal: the position the line
 * would occupy on the head side if it had survived. Intake fetches the diff with
 * `--unified=0`, so a hunk body is nothing but `-` and `+` lines, and that rule
 * lands in exactly the right place for the two shapes a hunk can take:
 *
 * - A REPLACEMENT (`-` lines followed by `+` lines) anchors its removals on the
 *   same head line as the additions that replaced them. That co-location is what
 *   the contract-delta comparison needs — both sides of one edit must be judged
 *   inside the same span, or replacing `throw A` with `throw B` would read as a
 *   newly-thrown error.
 * - A PURE DELETION reports `newLineCount === 0`, and git sets `newStartLine` to
 *   the head line the removal sits *after*. The walker therefore anchors it on
 *   the last surviving line above the deletion, which is inside the same
 *   construct in every case but one: deleting the tail of a block whose closing
 *   line was also deleted. `parseGitDiffMaps`'s hunk mapping treats that same
 *   position as touched, so the two agree by construction.
 *
 * The approximation is stated rather than hidden because it has a failure mode: a
 * removal on the boundary between two declarations is attributed to whichever one
 * owns the anchored line, and the diff carries no information that would settle it
 * more precisely.
 */
export const parseChangedLines = (
  diffOutput: string
): ReadonlyMap<string, ChangedLines> => {
  const changed = new Map<
    string,
    { added: ChangedLine[]; removed: ChangedLine[] }
  >()
  let current: { added: ChangedLine[]; removed: ChangedLine[] } | undefined
  // Tracks the post-change line number as the hunk body is walked. Additions and
  // context lines advance it; removals do not exist on the new side.
  let newLine = 0
  // `--- a/<path>` and `+++ b/<path>` carry the marker characters without being
  // hunk body lines, so nothing is collected until a hunk header has been seen.
  let insideHunk = false

  for (const line of diffOutput.split(/\r?\n/)) {
    const path = parseGitDiffNewPath(line)

    if (path !== undefined) {
      // Keyed rather than pushed, so a path appearing twice in one diff (a mode
      // change followed by a content change) accumulates instead of resetting.
      current = changed.get(path) ?? { added: [], removed: [] }
      changed.set(path, current)
      newLine = 0
      insideHunk = false
      continue
    }

    const hunk = parseGitDiffHunkHeader(line)

    if (hunk !== undefined) {
      newLine = hunk.newStartLine
      insideHunk = true
      continue
    }

    if (current === undefined || !insideHunk) {
      continue
    }

    if (line.startsWith('+')) {
      current.added.push({ line: newLine, text: line.slice(1) })
      newLine += 1
      continue
    }

    if (line.startsWith('-')) {
      current.removed.push({ line: newLine, text: line.slice(1) })
      continue
    }

    if (line.startsWith(' ') || line.length === 0) {
      newLine += 1
    }
  }

  return changed
}

// Reconstructs the pre-change content of every file the diff deletes outright.
//
// A deletion hunk carries the file's ENTIRE old side as removed lines, so the
// base content is fully recoverable from the diff text this domain already
// fetches. That matters because a deleted file cannot be read from the working
// tree at all, and reading it would otherwise require either a second git
// subcommand (`git show <base>:<path>`, widening the read-only git allowlist) or
// a filesystem read from a consumer that is forbidden one.
//
// Only files whose new side is `/dev/null` are reconstructed. A modified file's
// removed lines are a partial view of its old side and would silently produce a
// truncated, misleading reconstruction, so they are ignored.
export const parseDeletedFileContents = (
  diffOutput: string
): ReadonlyMap<string, string> => {
  const contents = new Map<string, string>()
  let currentPath: string | undefined
  let currentLines: string[] | undefined
  let insideHunk = false

  const commit = (): void => {
    if (currentPath !== undefined && currentLines !== undefined) {
      contents.set(currentPath, currentLines.join('\n'))
    }
  }

  for (const line of diffOutput.split(/\r?\n/)) {
    const path = parseGitDiffNewPath(line)

    if (path !== undefined) {
      commit()
      currentPath = path
      currentLines = undefined
      insideHunk = false
      continue
    }

    if (line === '+++ /dev/null') {
      currentLines = []
      continue
    }

    if (parseGitDiffHunkHeader(line) !== undefined) {
      insideHunk = true
      continue
    }

    // `--- a/<path>` also starts with `-`, so body lines are only collected once
    // a hunk header has been seen.
    if (insideHunk && currentLines !== undefined && line.startsWith('-')) {
      currentLines.push(line.slice(1))
    }
  }

  commit()

  return contents
}

export const parseGitDiffMaps = (diffOutput: string): readonly DiffMap[] => {
  const maps: MutableDiffMap[] = []
  let currentMap: MutableDiffMap | undefined

  for (const line of diffOutput.split(/\r?\n/)) {
    const path = parseGitDiffNewPath(line)

    if (path !== undefined) {
      currentMap = { path, changeKind: 'modified', hunks: [] }
      maps.push(currentMap)
      continue
    }

    if (currentMap !== undefined && line === '--- /dev/null') {
      currentMap.changeKind = 'new'
      continue
    }

    if (currentMap !== undefined && line === '+++ /dev/null') {
      currentMap.changeKind = 'deleted'
      continue
    }

    const hunk = parseGitDiffHunkHeader(line)

    if (hunk !== undefined && currentMap !== undefined) {
      currentMap.hunks.push(hunk)
    }
  }

  return maps.map((map) => ({
    path: map.path,
    changeKind: map.changeKind,
    hunks: map.hunks
  }))
}
