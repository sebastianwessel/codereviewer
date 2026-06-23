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
}

export type RepositoryIntake = {
  readonly repositorySnapshot: RepositorySnapshot
  readonly changedFiles: readonly ChangedFile[]
  readonly skippedFiles: readonly SkippedFile[]
  readonly diffMaps: readonly DiffMap[]
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

  if (command !== 'diff') {
    throw new TypeError('Only read-only git diff commands are allowed.')
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

const maxGlobPatternLength = 4096

const globToRegExp = (pattern: string): RegExp => {
  if (pattern.length > maxGlobPatternLength) {
    throw new TypeError('Exclude pattern exceeds the maximum supported length.')
  }

  const normalizedPattern = pattern.replaceAll('\\', '/')
  let source = '^'

  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const char = normalizedPattern[index]
    const nextChar = normalizedPattern[index + 1]

    if (char === '*' && nextChar === '*') {
      source += '.*'
      index += 1
    } else if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char?.replace(/[|\\{}()[\]^$+?.]/g, '\\$&') ?? ''
    }
  }

  source += '$'

  return new RegExp(source)
}

const compileGlobMatchers = (
  patterns: readonly string[]
): readonly RegExp[] => patterns.map(globToRegExp)

const isExcluded = (
  portablePath: string,
  matchers: readonly RegExp[]
): boolean => matchers.some((matcher) => matcher.test(portablePath))

// A file is in scope when it matches an `include` glob (an empty include set
// means "include everything", matching the `['**/*']` default). Combined with
// the exclude check, this lets `paths.include` actually narrow the review set.
const isIncluded = (
  portablePath: string,
  matchers: readonly RegExp[]
): boolean =>
  matchers.length === 0 || matchers.some((matcher) => matcher.test(portablePath))

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

const collectChangedPaths = async (
  options: CollectRepositoryIntakeOptions,
  runGit: GitCommandRunner,
  pathFlavor: FileSystemFlavor
): Promise<readonly GitChangedPath[]> => {
  if (options.explicitFiles !== undefined && options.explicitFiles.length > 0) {
    return options.explicitFiles.map((pathValue) => ({
      path: normalizeInputPath(pathValue, pathFlavor),
      status: 'modified'
    }))
  }

  const baseRef = assertSafeGitRef(options.baseRef, 'baseRef')
  const headRef = assertSafeGitRef(options.headRef, 'headRef')
  const nameStatusOutput = await runGit(
    ['diff', '--name-status', baseRef, headRef],
    createGitRunnerOptions(options.repositoryRoot, options.signal)
  )

  return parseGitNameStatus(nameStatusOutput)
}

const collectDiffMaps = async (
  options: CollectRepositoryIntakeOptions,
  runGit: GitCommandRunner,
  changedFiles: readonly ChangedFile[]
): Promise<readonly DiffMap[]> => {
  if (
    options.explicitFiles !== undefined ||
    changedFiles.length === 0 ||
    options.baseRef === undefined ||
    options.headRef === undefined
  ) {
    return []
  }

  const diffOutput = await runGit(
    [
      'diff',
      '--unified=0',
      options.baseRef,
      options.headRef,
      '--',
      ...changedFiles.map((file) => file.path)
    ],
    createGitRunnerOptions(options.repositoryRoot, options.signal)
  )

  return parseGitDiffMaps(diffOutput)
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

  try {
    const changedPaths = await collectChangedPaths(options, runGit, pathFlavor)
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
    const diffMaps = await collectDiffMaps(options, runGit, changedFiles)

    return {
      repositorySnapshot: {
        repositoryRoot: options.repositoryRoot,
        changedFileCount: changedFiles.length,
        skippedFileCount: skippedFiles.length
      },
      changedFiles,
      skippedFiles,
      diffMaps
    }
  } catch (error) {
    throw normalizeError(error, {
      source: 'repository',
      operation: 'collect_repository_intake'
    })
  }
}
