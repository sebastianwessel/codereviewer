import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { resolveExistingPathInsideRoot } from '../../platform/path-service.js'

// Repository text collection shared by every drift-domain checker. It lives in
// its own module rather than inside `drift-checker.ts` because the
// configuration-example checker walks a DIFFERENT set of roots (`docs/` and
// `skills/`) with the same containment, ordering and readability rules, and a
// second traversal would be a second place for those rules to drift.
export type TextFile = {
  readonly path: string
  readonly content: string
}

export const pathExists = async (
  repositoryRoot: string,
  repositoryRelativePath: string
): Promise<boolean> => {
  try {
    await stat(
      await resolveExistingPathInsideRoot(repositoryRoot, repositoryRelativePath)
    )
    return true
  } catch {
    return false
  }
}

export const collectTextFiles = async (
  repositoryRoot: string,
  requestedPath: string
): Promise<readonly TextFile[]> => {
  if (!(await pathExists(repositoryRoot, requestedPath))) {
    return []
  }

  const resolved = await resolveExistingPathInsideRoot(
    repositoryRoot,
    requestedPath
  )
  const fileStat = await stat(resolved)

  if (fileStat.isFile()) {
    return [
      {
        path: requestedPath,
        content: await readFile(resolved, 'utf8')
      }
    ]
  }

  // Sort directory entries so traversal order (and therefore the serialized
  // findings order) is stable across platforms and filesystems.
  const entries = (await readdir(resolved, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name)
  )
  const nested = await Promise.all(
    entries.map((entry) =>
      collectTextFiles(
        repositoryRoot,
        path.posix.join(requestedPath, entry.name)
      )
    )
  )

  return nested.flat().filter((file) => /\.(md|json|ya?ml)$/iu.test(file.path))
}
