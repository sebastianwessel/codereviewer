import path from 'node:path'
import {
  resolvePathInsideRoot,
  toPortablePath,
  type FileSystemFlavor
} from './path-service.js'
import { RepositoryRelativePathSchema } from '../shared/contracts/index.js'

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
