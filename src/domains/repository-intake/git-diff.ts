import { normalizeRepositoryRelativePath } from '../../platform/repository-path.js'

export type DiffHunk = {
  readonly oldStartLine: number
  readonly oldLineCount: number
  readonly newStartLine: number
  readonly newLineCount: number
}

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

const diffPathPattern =
  /^diff --git (?:"a\/(.+?)"|a\/(\S+)) (?:"b\/(.+?)"|b\/(\S+))$/u
const hunkPattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u

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

const normalizeDiffPath = (rawPath: string): string =>
  normalizeRepositoryRelativePath(rawPath, {
    flavor: rawPath.includes('\\') ? 'win32' : 'posix'
  })

const parseDiffPath = (line: string): string | undefined => {
  const match = diffPathPattern.exec(line)

  if (match === null) {
    return undefined
  }

  // Quoted captures (groups 1/3) carry C-style escapes; unquoted captures
  // (groups 2/4) are literal and may use backslash separators on Windows.
  const quotedPath = match[3] ?? match[1]

  if (quotedPath !== undefined) {
    return normalizeDiffPath(unescapeGitPath(quotedPath))
  }

  const unquotedPath = match[4] ?? match[2]

  return unquotedPath === undefined ? undefined : normalizeDiffPath(unquotedPath)
}

const parsePositiveInteger = (value: string | undefined): number =>
  value === undefined ? 1 : Number.parseInt(value, 10)

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
    const path = parseDiffPath(line)

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

    if (hunkPattern.test(line)) {
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
    const path = parseDiffPath(line)

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

    const hunkMatch = hunkPattern.exec(line)

    if (hunkMatch !== null && currentMap !== undefined) {
      const oldStartLine = Number.parseInt(hunkMatch[1] ?? '0', 10)
      const newStartLine = Number.parseInt(hunkMatch[3] ?? '0', 10)

      currentMap.hunks.push({
        oldStartLine,
        oldLineCount: parsePositiveInteger(hunkMatch[2]),
        newStartLine,
        newLineCount: parsePositiveInteger(hunkMatch[4])
      })
    }
  }

  return maps.map((map) => ({
    path: map.path,
    changeKind: map.changeKind,
    hunks: map.hunks
  }))
}
