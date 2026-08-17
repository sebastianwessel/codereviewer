import path from 'node:path'
import { lstat, realpath } from 'node:fs/promises'
// Platform may depend on shared; shared must never depend on a domain. The
// errno predicate reaches only `shared/redaction`, which imports nothing, so
// this does not close a loop back into the platform layer.
import { isFileNotFoundError } from '../shared/errors/error-normalizer.js'

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

/**
 * The portable (`/`-separated) path from `fromPath` to `toPath`, both of which are
 * real filesystem paths in the SAME flavor.
 *
 * One definition, because there were two and one of them was wrong on Windows.
 * `skill-index.ts` composed `toPortablePath(path.relative(a, b), { flavor: 'posix' })`,
 * pinning the POSIX flavor while `path.relative` speaks the flavor of the platform
 * it actually runs on — so on Windows it split a `skills\nested` on `/`, found no
 * separator, and handed back `skills\nested` with the backslash intact.
 * `eval-slice-manifest.ts` split on `path.sep` and converted correctly, and its
 * output feeds a stable sha256 slice digest, so the two spellings would have made a
 * Windows-generated digest disagree with the one every other platform computes.
 *
 * The flavor defaults to the current platform's rather than being pinned, because
 * the INPUT's flavor is the platform's: `path.relative` is what produced it.
 *
 * NOT routed through `normalizeRepositoryRelativePath`, which is the canonical
 * normalizer for repository-relative paths that arrive as DATA (from a config file,
 * a model, an analyzer). That one deliberately reads `\` as a separator whatever the
 * platform, so that a path written on one platform normalizes the same on the other.
 * That is right for data and wrong here: `\` is a legal character in a POSIX file
 * name, and a path this function derives from the filesystem has already committed
 * to one flavor. Feeding a real POSIX `a\b.txt` through it would rewrite the file's
 * name to `a/b.txt` — and, for the manifest, silently move a published digest.
 */
export const toPortableRelativePath = (
  fromPath: string,
  toPath: string,
  options: PathServiceOptions = {}
): string => {
  const flavor = options.flavor ?? currentFileSystemFlavor

  return toPortablePath(pathApiByFlavor[flavor].relative(fromPath, toPath), {
    flavor
  })
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
      if (!isFileNotFoundError(error)) {
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
    if (!isFileNotFoundError(error)) {
      throw error
    }
  }

  return resolvedPath
}
