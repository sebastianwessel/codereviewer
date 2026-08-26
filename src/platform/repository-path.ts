import path from 'node:path'
import {
  resolvePathInsideRoot,
  toPortablePath,
  type FileSystemFlavor
} from './path-service.js'
import { RepositoryRelativePathSchema } from '../shared/contracts/index.js'
import { lineRangesOverlap } from '../shared/text/line-ranges.js'

export type RepositoryPathOptions = {
  readonly flavor?: FileSystemFlavor
}

const virtualRootByFlavor: Readonly<Record<FileSystemFlavor, string>> = {
  posix: '/repo',
  win32: 'C:\\repo'
}

const pathApiByFlavor = {
  posix: path.posix,
  win32: path.win32
} as const

export const normalizeRepositoryRelativePath = (
  value: string,
  options: RepositoryPathOptions = {}
): string => {
  // Defaults to win32 normalization, which accepts both `/` and `\` separators,
  // so repository-relative paths from either platform normalize consistently.
  const flavor = options.flavor ?? 'win32'
  const pathApi = pathApiByFlavor[flavor]
  const virtualRoot = virtualRootByFlavor[flavor]
  const resolvedPath = resolvePathInsideRoot(virtualRoot, value, { flavor })
  const relativePath = pathApi.relative(virtualRoot, resolvedPath)
  // `path.relative` returns '' when the resolved path is the root itself (for
  // example a bare `.`, `./`, or `""` input). Represent the repository root as
  // the conventional `.` rather than failing the empty-string validation below.
  const portablePath = toPortablePath(relativePath === '' ? '.' : relativePath, {
    flavor
  })

  return RepositoryRelativePathSchema.parse(portablePath)
}

/**
 * A code location's inclusive end line. `endLine` is optional across the finding
 * contracts, and an absent one means the location is the single `startLine`.
 */
export const locationEndLine = (location: {
  readonly startLine: number
  readonly endLine?: number | undefined
}): number => location.endLine ?? location.startLine

/**
 * Do two repository-relative paths name the same file?
 *
 * One definition, because there were two and they DISAGREED. Refutation compared
 * `left.location.path === right.location.path` raw, so two locations in the same
 * file written differently (a leading `./`, a `\` separator) failed to match and
 * a real corroboration was silently lost; verification normalized both sides
 * first and did not have that hole. Normalization is the correct half, so it is
 * the half that survived — the raw comparison was not a second opinion, it was
 * the defect.
 */
export const sameRepositoryPath = (
  left: string,
  right: string,
  options: RepositoryPathOptions = {}
): boolean =>
  normalizeRepositoryRelativePath(left, options) ===
  normalizeRepositoryRelativePath(right, options)

/**
 * Do two code locations cover at least one line of the same file? Composes the
 * two primitives above rather than restating either: path identity is this
 * module's, and line overlap is `lineRangesOverlap`'s.
 */
export const locationsOverlap = (
  left: {
    readonly path: string
    readonly startLine: number
    readonly endLine?: number | undefined
  },
  right: {
    readonly path: string
    readonly startLine: number
    readonly endLine?: number | undefined
  },
  options: RepositoryPathOptions = {}
): boolean =>
  sameRepositoryPath(left.path, right.path, options) &&
  lineRangesOverlap(
    { startLine: left.startLine, endLine: locationEndLine(left) },
    { startLine: right.startLine, endLine: locationEndLine(right) }
  )
