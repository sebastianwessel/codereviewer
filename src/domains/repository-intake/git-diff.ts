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
