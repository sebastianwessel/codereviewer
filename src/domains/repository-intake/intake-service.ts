import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  currentFileSystemFlavor,
  resolveExistingPathInsideRoot,
  resolvePathInsideRoot,
  type FileSystemFlavor
} from '../../platform/path-service.js'
import { type SkippedFile } from '../../shared/contracts/index.js'
import {
  createStructuredError,
  normalizeError
} from '../../shared/errors/error-normalizer.js'
import { normalizeRepositoryRelativePath } from '../../platform/repository-path.js'
import { compileGlobMatchers, matchesAnyGlob } from '../../shared/glob/glob-matcher.js'
import { sha256 } from '../../shared/hash/hash.js'
import { parseGitDiffMaps, type DiffMap } from './git-diff.js'

const execFileAsync = promisify(execFile)
const defaultMaxFileBytes = 500_000
const defaultMaxFiles = 500
const gitMaxBufferBytes = 20_000_000

export type ChangedFileStatus = 'added' | 'modified' | 'renamed' | 'copied'

export type ChangedFile = {
  readonly path: string
  readonly status: ChangedFileStatus
  readonly sizeBytes: number
  readonly contentHash: string
}

export type RepositorySnapshot = {
  readonly repositoryRoot: string
  readonly changedFileCount: number
  readonly skippedFileCount: number
  // Commit the diff was actually taken against: the merge base of baseRef and
  // headRef. Absent for explicit-file runs, which bypass git entirely.
  readonly mergeBaseRef?: string
}

export type RepositoryIntake = {
  readonly repositorySnapshot: RepositorySnapshot
  readonly changedFiles: readonly ChangedFile[]
  readonly skippedFiles: readonly SkippedFile[]
  readonly diffMaps: readonly DiffMap[]
  // Raw unified diff text for the changed files (empty when unavailable, e.g.
  // explicit-file runs). Used by holistic discovery to show what changed.
  readonly rawDiff: string
}

export type GitCommandRunner = (
  args: readonly string[],
  options: {
    readonly cwd: string
    readonly signal?: AbortSignal
  }
) => Promise<string>

export type IntakeFileStat = {
  readonly size: number
}

export type RepositoryIntakeFileSystem = {
  readonly statFile: (path: string) => Promise<IntakeFileStat>
  readonly readFile: (path: string) => Promise<Buffer>
}

export type CollectRepositoryIntakeOptions = {
  readonly repositoryRoot: string
  readonly baseRef?: string
  readonly headRef?: string
  readonly explicitFiles?: readonly string[]
  readonly includePatterns?: readonly string[]
  readonly excludePatterns?: readonly string[]
  readonly maxFiles?: number
  readonly maxFileBytes?: number
  readonly pathFlavor?: FileSystemFlavor
  readonly runGit?: GitCommandRunner
  readonly fileSystem?: RepositoryIntakeFileSystem
  readonly signal?: AbortSignal
}

type GitChangedPath = {
  readonly path: string
  readonly status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied'
}

const createGitRunnerOptions = (
  cwd: string,
  signal: AbortSignal | undefined
): Parameters<GitCommandRunner>[1] =>
  signal === undefined ? { cwd } : { cwd, signal }

const defaultFileSystem: RepositoryIntakeFileSystem = {
  statFile: stat,
  readFile
}

const defaultGitRunner: GitCommandRunner = async (args, options) => {
  assertReadOnlyGitArgs(args)
  const { stdout } = await execFileAsync('git', [...args], {
    cwd: options.cwd,
    maxBuffer: gitMaxBufferBytes,
    signal: options.signal
  })

  return stdout
}

export const assertReadOnlyGitArgs = (args: readonly string[]): void => {
  const [command, ...rest] = args

  // `merge-base` resolves the divergence commit of two refs. It is a distinct
  // subcommand from `merge`: it only prints a commit id and never touches the
  // repository, index, or working tree.
  if (command === 'merge-base') {
    if (rest.length !== 2) {
      throw new TypeError('Git merge-base command shape is not allowlisted.')
    }

    assertSafeGitRef(rest[0], 'baseRef')
    assertSafeGitRef(rest[1], 'headRef')

    return
  }

  if (command !== 'diff') {
    throw new TypeError('Only read-only git diff and merge-base commands are allowed.')
  }

  const [mode, baseRef, headRef, separator] = rest

  if (mode === '--name-status' && rest.length === 3) {
    assertSafeGitRef(baseRef, 'baseRef')
    assertSafeGitRef(headRef, 'headRef')
    return
  }

  if (mode === '--unified=0' && separator === '--' && rest.length >= 4) {
    assertSafeGitRef(baseRef, 'baseRef')
    assertSafeGitRef(headRef, 'headRef')

    for (const filePath of rest.slice(4)) {
      normalizeRepositoryRelativePath(filePath)
    }

    return
  }

  throw new TypeError('Git diff command shape is not allowlisted.')
}

const assertSafeGitRef = (ref: string | undefined, fieldName: string): string => {
  if (ref === undefined || ref.trim().length === 0 || ref.startsWith('-')) {
    throw createStructuredError({
      code: 'invalid_git_ref',
      message: 'Git refs must be non-empty and must not start with "-".',
      category: 'config',
      recoverable: true,
      exitCode: 2,
      details: { field: fieldName }
    })
  }

  return ref
}

const textSourceExtensions = new Set([
  '.cjs',
  '.cts',
  '.go',
  '.java',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.py',
  '.rb',
  '.rs',
  '.ts',
  '.tsx'
])

const hasTextSourceExtension = (portablePath: string): boolean =>
  textSourceExtensions.has(path.posix.extname(portablePath).toLowerCase())

const isUtf8Text = (content: Buffer): boolean =>
  Buffer.from(content.toString('utf8'), 'utf8').equals(content)

const isBinaryContent = (portablePath: string, content: Buffer): boolean => {
  if (!content.includes(0)) {
    return false
  }

  return !(hasTextSourceExtension(portablePath) && isUtf8Text(content))
}

const isExcluded = (
  portablePath: string,
  matchers: readonly RegExp[]
): boolean => matchesAnyGlob(portablePath, matchers)

// A file is in scope when it matches an `include` glob (an empty include set
// means "include everything", matching the `['**/*']` default). Combined with
// the exclude check, this lets `paths.include` actually narrow the review set.
const isIncluded = (
  portablePath: string,
  matchers: readonly RegExp[]
): boolean => matchers.length === 0 || matchesAnyGlob(portablePath, matchers)

const statusFromGitCode = (statusCode: string): GitChangedPath['status'] => {
  const normalizedStatus = statusCode[0]

  if (normalizedStatus === 'A') {
    return 'added'
  }

  if (normalizedStatus === 'D') {
    return 'deleted'
  }

  if (normalizedStatus === 'R') {
    return 'renamed'
  }

  if (normalizedStatus === 'C') {
    return 'copied'
  }

  return 'modified'
}

const changedStatusFromGitStatus = (
  status: Exclude<GitChangedPath['status'], 'deleted'>
): ChangedFileStatus => status

const parseGitNameStatus = (output: string): readonly GitChangedPath[] =>
  output
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [statusCode, firstPath, secondPath] = line.split('\t')
      const status = statusFromGitCode(statusCode ?? 'M')
      const rawPath = status === 'renamed' || status === 'copied' ? secondPath : firstPath

      if (rawPath === undefined) {
        throw new TypeError('Git name-status output is missing a path.')
      }

      return {
        path: rawPath,
        status
      }
    })

const resolveExistingRepositoryPath = (
  repositoryRoot: string,
  portablePath: string,
  flavor: FileSystemFlavor
): Promise<string> =>
  resolveExistingPathInsideRoot(repositoryRoot, portablePath, { flavor })

const normalizeInputPath = (value: string, flavor: FileSystemFlavor): string =>
  normalizeRepositoryRelativePath(value, { flavor })

const toSkippedFile = (
  path: string,
  reason: SkippedFile['reason'],
  message?: string
): SkippedFile =>
  message === undefined
    ? { path, reason }
    : {
        path,
        reason,
        message
      }

const inspectChangedPath = async (
  options: {
    readonly repositoryRoot: string
    readonly rawPath: string
    readonly status: GitChangedPath['status']
    readonly excludeMatchers: readonly RegExp[]
    readonly maxFileBytes: number
    readonly pathFlavor: FileSystemFlavor
    readonly fileSystem: RepositoryIntakeFileSystem
    readonly enforceRealPathContainment: boolean
  }
): Promise<ChangedFile | SkippedFile> => {
  const portablePath = normalizeInputPath(options.rawPath, options.pathFlavor)

  if (options.status === 'deleted') {
    return toSkippedFile(portablePath, 'deleted')
  }

  if (isExcluded(portablePath, options.excludeMatchers)) {
    return toSkippedFile(portablePath, 'excluded')
  }

  try {
    const existingPath = options.enforceRealPathContainment
      ? await resolveExistingRepositoryPath(
          options.repositoryRoot,
          portablePath,
          options.pathFlavor
        )
      : resolvePathInsideRoot(options.repositoryRoot, portablePath, {
          flavor: options.pathFlavor
        })
    const fileStat = await options.fileSystem.statFile(existingPath)

    if (fileStat.size > options.maxFileBytes) {
      return toSkippedFile(portablePath, 'too-large')
    }

    const content = await options.fileSystem.readFile(existingPath)

    if (isBinaryContent(portablePath, content)) {
      return toSkippedFile(portablePath, 'binary')
    }

    return {
      path: portablePath,
      status: changedStatusFromGitStatus(options.status),
      sizeBytes: fileStat.size,
      contentHash: sha256(content)
    }
  } catch (error) {
    const normalizedError = normalizeError(error, {
      source: 'repository',
      operation: 'read_changed_file',
      details: { path: portablePath }
    })

    return toSkippedFile(portablePath, 'error', normalizedError.message)
  }
}

const inspectChangedPathsWithinLimit = async (
  options: {
    readonly repositoryRoot: string
    readonly changedPaths: readonly GitChangedPath[]
    readonly includeMatchers: readonly RegExp[]
    readonly excludeMatchers: readonly RegExp[]
    readonly maxFiles: number
    readonly maxFileBytes: number
    readonly pathFlavor: FileSystemFlavor
    readonly fileSystem: RepositoryIntakeFileSystem
    readonly enforceRealPathContainment: boolean
  }
): Promise<readonly (ChangedFile | SkippedFile)[]> => {
  const records: (ChangedFile | SkippedFile)[] = []
  let acceptedFileCount = 0

  for (const changedPath of options.changedPaths) {
    const portablePath = normalizeInputPath(changedPath.path, options.pathFlavor)

    if (changedPath.status === 'deleted') {
      records.push(toSkippedFile(portablePath, 'deleted'))
      continue
    }

    if (
      !isIncluded(portablePath, options.includeMatchers) ||
      isExcluded(portablePath, options.excludeMatchers)
    ) {
      records.push(toSkippedFile(portablePath, 'excluded'))
      continue
    }

    if (acceptedFileCount >= options.maxFiles) {
      records.push(
        toSkippedFile(
          portablePath,
          'too-many-files',
          `Skipped because review.maxFiles is ${options.maxFiles}.`
        )
      )
      continue
    }

    const record = await inspectChangedPath({
      repositoryRoot: options.repositoryRoot,
      rawPath: portablePath,
      status: changedPath.status,
      excludeMatchers: options.excludeMatchers,
      maxFileBytes: options.maxFileBytes,
      pathFlavor: options.pathFlavor,
      fileSystem: options.fileSystem,
      enforceRealPathContainment: options.enforceRealPathContainment
    })

    if ('contentHash' in record) {
      acceptedFileCount += 1
    }

    records.push(record)
  }

  return records
}

const commitIdPattern = /^[0-9a-f]{7,64}$/u

// git reports "the refs have no common ancestor" as a bare exit status 1 with
// empty stderr. Unknown refs exit 128 and runtime failures surface as string
// error codes, so both keep flowing to the normal error path.
const isNoMergeBaseExitStatus = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { readonly code: unknown }).code === 1

// The reviewed change set is what `headRef` added since it diverged from
// `baseRef`. Diffing the two refs directly would also surface commits that
// landed on `baseRef` after the divergence point, inflating every review on a
// branch that has fallen behind. Resolving the merge base first pins the diff
// to the branch's own work.
const resolveMergeBase = async (
  options: CollectRepositoryIntakeOptions,
  runGit: GitCommandRunner
): Promise<string> => {
  const baseRef = assertSafeGitRef(options.baseRef, 'baseRef')
  const headRef = assertSafeGitRef(options.headRef, 'headRef')

  // `git merge-base` exits 1 with no output when the refs share no history.
  // Every other failure (unknown ref, timeout, abort) must keep its own
  // classification rather than being reported as a missing merge base.
  const mergeBaseOutput = await runGit(
    ['merge-base', baseRef, headRef],
    createGitRunnerOptions(options.repositoryRoot, options.signal)
  ).catch((error: unknown) => {
    if (isNoMergeBaseExitStatus(error)) {
      return ''
    }

    throw error
  })

  const mergeBase = mergeBaseOutput.trim()

  if (!commitIdPattern.test(mergeBase)) {
    throw createStructuredError({
      code: 'merge_base_unavailable',
      message:
        'No merge base exists for the configured base and head refs. Fetch enough history for both refs (for example a full-depth checkout) and retry.',
      category: 'repository',
      recoverable: true,
      exitCode: 3,
      details: { baseRef, headRef }
    })
  }

  return mergeBase
}

const collectChangedPaths = async (
  options: CollectRepositoryIntakeOptions,
  runGit: GitCommandRunner,
  pathFlavor: FileSystemFlavor,
  mergeBase: string | undefined
): Promise<readonly GitChangedPath[]> => {
  if (options.explicitFiles !== undefined && options.explicitFiles.length > 0) {
    return options.explicitFiles.map((pathValue) => ({
      path: normalizeInputPath(pathValue, pathFlavor),
      status: 'modified'
    }))
  }

  const headRef = assertSafeGitRef(options.headRef, 'headRef')
  const diffBase = assertSafeGitRef(mergeBase, 'mergeBase')
  const nameStatusOutput = await runGit(
    ['diff', '--name-status', diffBase, headRef],
    createGitRunnerOptions(options.repositoryRoot, options.signal)
  )

  return parseGitNameStatus(nameStatusOutput)
}

const collectDiffMaps = async (
  options: CollectRepositoryIntakeOptions,
  runGit: GitCommandRunner,
  changedFiles: readonly ChangedFile[],
  mergeBase: string | undefined
): Promise<{ readonly diffMaps: readonly DiffMap[]; readonly rawDiff: string }> => {
  if (
    options.explicitFiles !== undefined ||
    changedFiles.length === 0 ||
    mergeBase === undefined ||
    options.headRef === undefined
  ) {
    return { diffMaps: [], rawDiff: '' }
  }

  const diffOutput = await runGit(
    [
      'diff',
      '--unified=0',
      mergeBase,
      options.headRef,
      '--',
      ...changedFiles.map((file) => file.path)
    ],
    createGitRunnerOptions(options.repositoryRoot, options.signal)
  )

  // Retain the raw unified diff alongside the parsed ranges: holistic discovery
  // needs the actual before/after hunks (what changed), not just line ranges.
  return { diffMaps: parseGitDiffMaps(diffOutput), rawDiff: diffOutput }
}

const partitionIntakeRecords = (
  records: readonly (ChangedFile | SkippedFile)[]
): {
  readonly changedFiles: readonly ChangedFile[]
  readonly skippedFiles: readonly SkippedFile[]
} => {
  const changedFiles: ChangedFile[] = []
  const skippedFiles: SkippedFile[] = []

  for (const record of records) {
    if ('contentHash' in record) {
      changedFiles.push(record)
    } else {
      skippedFiles.push(record)
    }
  }

  return { changedFiles, skippedFiles }
}

export const collectRepositoryIntake = async (
  options: CollectRepositoryIntakeOptions
): Promise<RepositoryIntake> => {
  const pathFlavor = options.pathFlavor ?? currentFileSystemFlavor
  const runGit = options.runGit ?? defaultGitRunner
  const fileSystem = options.fileSystem ?? defaultFileSystem
  // Real-path/symlink containment is enforced whenever we touch the real
  // filesystem. The flavor guard only protects synthetic runs that deliberately
  // declare a non-native flavor together with an in-memory file system.
  const enforceRealPathContainment =
    options.fileSystem === undefined && pathFlavor === currentFileSystemFlavor
  const includeMatchers = compileGlobMatchers(options.includePatterns ?? [])
  const excludeMatchers = compileGlobMatchers(options.excludePatterns ?? [])

  const usesGitDiff =
    !(options.explicitFiles !== undefined && options.explicitFiles.length > 0) &&
    options.baseRef !== undefined &&
    options.headRef !== undefined

  try {
    const mergeBase = usesGitDiff
      ? await resolveMergeBase(options, runGit)
      : undefined
    const changedPaths = await collectChangedPaths(
      options,
      runGit,
      pathFlavor,
      mergeBase
    )
    const inspectedRecords = await inspectChangedPathsWithinLimit({
      repositoryRoot: options.repositoryRoot,
      changedPaths,
      includeMatchers,
      excludeMatchers,
      maxFiles: options.maxFiles ?? defaultMaxFiles,
      maxFileBytes: options.maxFileBytes ?? defaultMaxFileBytes,
      pathFlavor,
      fileSystem,
      enforceRealPathContainment
    })
    const { changedFiles, skippedFiles } = partitionIntakeRecords(inspectedRecords)
    const { diffMaps, rawDiff } = await collectDiffMaps(
      options,
      runGit,
      changedFiles,
      mergeBase
    )

    return {
      repositorySnapshot: {
        repositoryRoot: options.repositoryRoot,
        changedFileCount: changedFiles.length,
        skippedFileCount: skippedFiles.length,
        ...(mergeBase === undefined ? {} : { mergeBaseRef: mergeBase })
      },
      changedFiles,
      skippedFiles,
      diffMaps,
      rawDiff
    }
  } catch (error) {
    throw normalizeError(error, {
      source: 'repository',
      operation: 'collect_repository_intake'
    })
  }
}
