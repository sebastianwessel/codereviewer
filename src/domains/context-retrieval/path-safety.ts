import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  resolveExistingPathInsideRoot,
  resolvePathInsideRoot
} from '../../platform/path-service.js'
import { normalizeRepositoryRelativePath } from '../../platform/repository-path.js'
import { RepositoryRelativePathSchema } from '../../shared/contracts/index.js'
import {
  evaluatePathEligibility,
  type CompiledEligibilityConfig
} from './eligibility.js'
import {
  pathNotEligibleCondition,
  pathNotFoundCondition
} from './expected-conditions.js'

/**
 * The repository-relative path of an entry inside a listed or traversed
 * directory, in the portable (POSIX-separator) form every mediated surface
 * reports.
 *
 * Shared by the directory listing and the search traversal so the two cannot
 * name the same entry differently.
 */
export const portableChildPath = (
  directory: string,
  childName: string
): string => normalizeRepositoryRelativePath(path.posix.join(directory, childName))

// Whether a filesystem error means "nothing is there". `ENOENT` is the plain
// case; `ENOTDIR` is the same statement made about an intermediate segment (a
// path under a regular file). Every other errno — a permission failure above
// all — is a fault: reporting it as "not found" would be exactly the silent
// optimism this surface exists to prevent.
const isMissingEntryError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error.code === 'ENOENT' || error.code === 'ENOTDIR')

// The entry at a path, or `undefined` when nothing is there. Returns the stats
// rather than a boolean because the gate below needs the entry's KIND — whether
// a path admitted as a directory really is one — and asking the filesystem twice
// for one answer would let the two answers disagree.
const statIfExists = async (
  absolutePath: string
): Promise<Awaited<ReturnType<typeof stat>> | undefined> => {
  try {
    // Follows symlinks on purpose: a link to a deleted target is not there, and a
    // link to a live target outside the root must reach the containment check
    // below rather than being answered as a miss.
    return await stat(absolutePath)
  } catch (error) {
    if (isMissingEntryError(error)) {
      return undefined
    }

    throw error
  }
}

// What the caller intends to do with a requested path, which is what decides
// which eligibility rule it is held to. `read` addresses a file. `list`
// addresses a directory. A `grep` root may legitimately be either — a subtree to
// walk or a single file to scan — and is resolved to whichever it turns out to
// be, under the rule for that kind.
export type RequestedEntryKind = 'file' | 'directory' | 'file-or-directory'

// Normalizes a caller-supplied path (liberal about leading `./`, `\`
// separators, and repeated slashes — see `repository-path.ts`), confirms it
// is eligible, then confirms it exists inside the repository root. Any of the
// three failure modes produces a clear, actionable error rather than an
// opaque one.
export const resolveEligibleExistingPath = async (options: {
  readonly repositoryRoot: string
  readonly requestedPath: string
  readonly compiledEligibility: CompiledEligibilityConfig
  readonly entryKind: RequestedEntryKind
}): Promise<{ readonly portablePath: string; readonly absolutePath: string }> => {
  const portablePath = RepositoryRelativePathSchema.parse(
    normalizeRepositoryRelativePath(options.requestedPath)
  )
  // A path that may be a directory is gated by the directory rule first, because
  // that is the only rule that can admit the subtree root a traversal starts
  // from. Whether it really is a directory is settled below, once — and only
  // once — the path is known to be eligible under SOME rule.
  const gateKind = options.entryKind === 'file' ? 'file' : 'directory'
  const eligibility = evaluatePathEligibility(
    portablePath,
    options.compiledEligibility,
    gateKind
  )

  if (!eligibility.eligible) {
    throw pathNotEligibleCondition(portablePath, eligibility.reason)
  }
  // Whether the path passed ONLY because directories are judged on what may live
  // beneath them. If so it is eligible while it is a directory and not otherwise,
  // so a file at this path must be refused rather than read: the directory rule
  // is a traversal permit, never a permit to serve a file the include list does
  // not cover.
  const fileEligibility = evaluatePathEligibility(
    portablePath,
    options.compiledEligibility,
    'file'
  )
  const directoryOnlyRefusalReason =
    gateKind === 'directory' && !fileEligibility.eligible
      ? fileEligibility.reason
      : undefined

  // Containment first, existence second, and NEITHER is decided by reading an
  // error message. `resolvePathInsideRoot` refuses a path that escapes the root,
  // and that refusal propagates as the fault it is — a containment breach is a
  // security-relevant invariant, never an expected condition the model may treat
  // as "the code is not there". Only once the path is contained is absence
  // established by asking the filesystem directly, so the not-found condition is
  // raised on positive evidence rather than by assuming that whatever the path
  // service threw must have meant "missing".
  const containedPath = resolvePathInsideRoot(
    options.repositoryRoot,
    portablePath
  )
  const entryStat = await statIfExists(containedPath)

  // A path admitted only as a directory that is not one — a file, or nothing at
  // all — is refused as INELIGIBLE, identically in both cases. Eligibility is
  // otherwise decided before existence precisely so a refusal cannot be used to
  // probe for a file the include list does not cover, and this is the one check
  // that has to consult the filesystem; answering "it is a file" differently from
  // "it is not there" would hand that probe back (spec 07).
  if (
    directoryOnlyRefusalReason !== undefined &&
    entryStat?.isDirectory() !== true
  ) {
    throw pathNotEligibleCondition(portablePath, directoryOnlyRefusalReason)
  }

  if (entryStat === undefined) {
    throw pathNotFoundCondition(portablePath)
  }

  // Re-resolves through the same helper so the symlink-target containment check
  // (real target inside the real root) still runs and still propagates.
  const absolutePath = await resolveExistingPathInsideRoot(
    options.repositoryRoot,
    portablePath
  )

  // Re-evaluate eligibility against the REAL target. `resolveExistingPathInsideRoot`
  // confirms the realpath is *contained* in the root but returns the requested
  // (symlink) path, and eligibility was only checked on the requested name. Without
  // this, an in-repo symlink whose name is eligible but whose realpath is an
  // excluded/secret file (e.g. `notes.txt -> .env`, `-> .git/config`, `-> node_modules/x`)
  // would be read/listed/searched, defeating the hard floor. The write path rejects
  // symlinks outright; the read path follows to the true target and re-checks it.
  const realRoot = await realpath(options.repositoryRoot)
  const realTarget = await realpath(absolutePath)
  const realRelative = path.relative(realRoot, realTarget)
  // Empty means the target is the repository root itself (e.g. list/grep of `.`);
  // equal means no symlink indirection changed the path. Otherwise re-check.
  if (realRelative.length > 0 && realRelative !== portablePath) {
    const realPortable = normalizeRepositoryRelativePath(realRelative)
    // Held to the rule for what the target actually IS, which the stat above
    // already established: a link to a directory is a traversal root and is
    // judged on what may live beneath it, a link to a file is judged as a file.
    const targetEligibility = evaluatePathEligibility(
      realPortable,
      options.compiledEligibility,
      entryStat.isDirectory() ? 'directory' : 'file'
    )

    if (!targetEligibility.eligible) {
      throw pathNotEligibleCondition(
        portablePath,
        `resolves to an ineligible target (${targetEligibility.reason})`
      )
    }
  }

  return { portablePath, absolutePath }
}
