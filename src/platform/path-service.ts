import path from 'node:path'
import { lstat, realpath } from 'node:fs/promises'

export type FileSystemFlavor = 'posix' | 'win32'

export const currentFileSystemFlavor: FileSystemFlavor =
  process.platform === 'win32' ? 'win32' : 'posix'

const pathApiByFlavor = {
  posix: path.posix,
  win32: path.win32
} as const

export type PathServiceOptions = {
  flavor?: FileSystemFlavor
}

const assertValidPathValue = (value: string): void => {
  if (value.includes('\u0000')) {
    throw new TypeError('Path value must not contain NUL bytes.')
  }

  if (value.trim().length === 0) {
    throw new TypeError('Path value must not be empty.')
  }
}

export const normalizeFileSystemPath = (
  value: string,
  options: PathServiceOptions = {}
): string => {
  assertValidPathValue(value)

  const trimmedValue = value.trim()
  const flavor = options.flavor ?? currentFileSystemFlavor

  return pathApiByFlavor[flavor].normalize(trimmedValue)
}

export const toPortablePath = (
  value: string,
  options: PathServiceOptions = {}
): string => {
  const flavor = options.flavor ?? currentFileSystemFlavor
  const normalizedPath = normalizeFileSystemPath(value, { flavor })

  return normalizedPath.split(pathApiByFlavor[flavor].sep).join('/')
}

export const resolvePathInsideRoot = (
  rootPath: string,
  requestedPath: string,
  options: PathServiceOptions = {}
): string => {
  const flavor = options.flavor ?? currentFileSystemFlavor
  const pathApi = pathApiByFlavor[flavor]
  const normalizedRoot = normalizeFileSystemPath(rootPath, { flavor })
  const normalizedRequest = normalizeFileSystemPath(requestedPath, { flavor })

  if (pathApi.isAbsolute(normalizedRequest)) {
    throw new TypeError('Path value must be relative to the root.')
  }

  const resolvedPath = pathApi.resolve(normalizedRoot, normalizedRequest)
  const relativePath = pathApi.relative(normalizedRoot, resolvedPath)
  const isInsideRoot =
    relativePath.length === 0 ||
    (!relativePath.startsWith('..') && !pathApi.isAbsolute(relativePath))

  if (!isInsideRoot) {
    throw new TypeError('Path value must resolve inside the root.')
  }

  return resolvedPath
}

export const resolveExistingPathInsideRoot = async (
  rootPath: string,
  requestedPath: string,
  options: PathServiceOptions = {}
): Promise<string> => {
  const flavor = options.flavor ?? currentFileSystemFlavor
  const pathApi = pathApiByFlavor[flavor]
  const resolvedPath = resolvePathInsideRoot(rootPath, requestedPath, { flavor })
  const realRoot = await realpath(rootPath)
  const realTarget = await realpath(resolvedPath)
  const relativeTarget = pathApi.relative(realRoot, realTarget)
  const isTargetInsideRoot =
    relativeTarget.length === 0 ||
    (!relativeTarget.startsWith('..') && !pathApi.isAbsolute(relativeTarget))

  if (!isTargetInsideRoot) {
    throw new TypeError('Path target must resolve inside the root.')
  }

  return resolvedPath
}

const realpathExistingAncestor = async (
  candidatePath: string,
  rootPath: string,
  flavor: FileSystemFlavor
): Promise<string> => {
  const pathApi = pathApiByFlavor[flavor]
  let currentPath = candidatePath

  while (true) {
    try {
      return await realpath(currentPath)
    } catch (error) {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      ) {
        throw error
      }
    }

    const parentPath = pathApi.dirname(currentPath)

    if (parentPath === currentPath) {
      throw new TypeError('Write path parent must resolve inside the root.')
    }

    currentPath = parentPath

    if (pathApi.relative(rootPath, currentPath).startsWith('..')) {
      throw new TypeError('Write path parent must resolve inside the root.')
    }
  }
}

export const resolveWritePathInsideRoot = async (
  rootPath: string,
  requestedPath: string,
  options: PathServiceOptions = {}
): Promise<string> => {
  const flavor = options.flavor ?? currentFileSystemFlavor
  const pathApi = pathApiByFlavor[flavor]
  const resolvedPath = resolvePathInsideRoot(rootPath, requestedPath, { flavor })
  const realRoot = await realpath(rootPath)
  const realParent = await realpathExistingAncestor(
    pathApi.dirname(resolvedPath),
    rootPath,
    flavor
  )
  const relativeParent = pathApi.relative(realRoot, realParent)
  const isInsideRoot =
    relativeParent.length === 0 ||
    (!relativeParent.startsWith('..') && !pathApi.isAbsolute(relativeParent))

  if (!isInsideRoot) {
    throw new TypeError('Write path parent must resolve inside the root.')
  }

  try {
    const targetStat = await lstat(resolvedPath)

    if (targetStat.isSymbolicLink()) {
      throw new TypeError('Write path target must not be a symlink.')
    }

    const realTarget = await realpath(resolvedPath)
    const relativeTarget = pathApi.relative(realRoot, realTarget)
    const isTargetInsideRoot =
      relativeTarget.length === 0 ||
      (!relativeTarget.startsWith('..') && !pathApi.isAbsolute(relativeTarget))

    if (!isTargetInsideRoot) {
      throw new TypeError('Write path target must resolve inside the root.')
    }
  } catch (error) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      throw error
    }
  }

  return resolvedPath
}
