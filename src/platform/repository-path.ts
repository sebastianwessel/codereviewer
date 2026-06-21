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
  const portablePath = toPortablePath(relativePath, { flavor })

  return RepositoryRelativePathSchema.parse(portablePath)
}
