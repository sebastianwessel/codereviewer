import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  resolveExistingPathInsideRoot,
  resolveWritePathInsideRoot
} from '../../platform/path-service.js'
import { normalizeRepositoryRelativePath } from '../../platform/repository-path.js'

const defaultSourceSliceRoot = 'eval/benchmarks/code-review-bench-style'
const defaultOutputSliceRoot =
  '.codereviewer/eval/benchmark-slices/code-review-bench-style'
const fullFileHydrationSource = 'public-full-files-v1'

// Checked-in benchmark slices carry this marker in their placeholder diff until
// the hydration tool replaces them with the real PR diff and head-side files.
export const placeholderSliceMarker = 'Minimal source exists'

type PlaceholderSliceCandidate = {
  readonly expectedFindings: readonly unknown[]
  readonly diff?: string
}

// A positive (scored) slice is a placeholder when it still carries the
// hydration marker in its diff. Negative/noise slices (no expected findings)
// are allowed to remain placeholders, so they are never flagged.
export const isPlaceholderPositiveSlice = (
  slice: PlaceholderSliceCandidate
): boolean =>
  slice.expectedFindings.length > 0 &&
  slice.diff !== undefined &&
  slice.diff.includes(placeholderSliceMarker)

// Guard the benchmark eval path: scoring an un-hydrated positive slice would
// report a false 0 recall, so fail loudly and point the user at hydration.
export const assertBenchmarkSlicesHydrated = (
  slices: readonly ({ readonly id: string } & PlaceholderSliceCandidate)[]
): void => {
  const placeholderIds = slices
    .filter((slice) => isPlaceholderPositiveSlice(slice))
    .map((slice) => slice.id)

  if (placeholderIds.length === 0) {
    return
  }

  throw new Error(
    `Benchmark slices are not hydrated: ${placeholderIds.join(', ')}. ` +
      'Run "npm run eval:hydrate" before scoring these cases.'
  )
}

type FetchText = (url: string) => Promise<string>

export type HydrateBenchmarkPackOptions = {
  readonly repositoryRoot: string
  readonly sourceSliceRoot?: string
  readonly outputSliceRoot?: string
  readonly caseFilters?: readonly string[]
  readonly fetchText?: FetchText
  readonly force?: boolean
  readonly log?: (message: string) => void
}

export type HydrateBenchmarkPackResult = {
  readonly sourceSliceRoot: string
  readonly outputSliceRoot: string
  readonly hydratedCaseCount: number
  readonly copiedCaseCount: number
  readonly cachedCaseCount: number
  readonly changedFileCount: number
}

type MaterializedDiffFile = {
  readonly path: string
  readonly content: string
}

type ChangedDiffFile = {
  readonly path: string
}

type GitHubSourceRef = {
  readonly repository: string
  readonly ref: string
}

type MutableDiffFile = {
  path: string
  lines: string[]
  hasHunkContent: boolean
}

const diffPathPattern =
  /^diff --git (?:"a\/(.+?)"|a\/(\S+)) (?:"b\/(.+?)"|b\/(\S+))$/u
const hunkPattern = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u
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

const parseDiffNewPath = (line: string): string | undefined => {
  const match = diffPathPattern.exec(line)

  if (match === null) {
    return undefined
  }

  const quotedPath = match[3]

  if (quotedPath !== undefined) {
    return normalizeDiffPath(unescapeGitPath(quotedPath))
  }

  const unquotedPath = match[4]

  return unquotedPath === undefined ? undefined : normalizeDiffPath(unquotedPath)
}

const diffUrlFor = (sourceUrl: string): string => {
  const trimmed = sourceUrl.replace(/\/+$/u, '')

  return trimmed.endsWith('.diff') ? trimmed : `${trimmed}.diff`
}

const encodeGitHubPath = (pathValue: string): string =>
  pathValue.split('/').map(encodeURIComponent).join('/')

const parseGitHubSourceUrl = (
  sourceUrl: string
): {
  readonly owner: string
  readonly repo: string
  readonly type: 'pull' | 'commit'
  readonly value: string
} => {
  const url = new URL(sourceUrl)
  const [owner, repo, type, value] = url.pathname
    .split('/')
    .filter((segment) => segment.length > 0)

  if (
    owner === undefined ||
    repo === undefined ||
    value === undefined ||
    (type !== 'pull' && type !== 'commit')
  ) {
    throw new Error(`Unsupported GitHub benchmark URL: ${sourceUrl}`)
  }

  return { owner, repo, type, value }
}

const githubApiUrlFor = (
  source: ReturnType<typeof parseGitHubSourceUrl>
): string =>
  source.type === 'pull'
    ? `https://api.github.com/repos/${source.owner}/${source.repo}/pulls/${source.value}`
    : `https://api.github.com/repos/${source.owner}/${source.repo}/commits/${source.value}`

const resolveGitHubSourceRef = async (
  input: {
    readonly sourceUrl: string
    readonly fetchText: FetchText
  }
): Promise<GitHubSourceRef> => {
  const source = parseGitHubSourceUrl(input.sourceUrl)

  if (source.type === 'commit') {
    return {
      repository: `${source.owner}/${source.repo}`,
      ref: source.value
    }
  }

  const pull = JSON.parse(
    await input.fetchText(githubApiUrlFor(source))
  ) as {
    readonly head?: {
      readonly sha?: unknown
      readonly repo?: {
        readonly full_name?: unknown
      } | null
    }
  }
  const repository = pull.head?.repo?.full_name
  const ref = pull.head?.sha

  if (typeof repository !== 'string' || typeof ref !== 'string') {
    throw new Error(`GitHub PR metadata is incomplete for ${input.sourceUrl}`)
  }

  return { repository, ref }
}

const rawFileUrlFor = (
  input: {
    readonly sourceRef: GitHubSourceRef
    readonly filePath: string
  }
): string =>
  `https://raw.githubusercontent.com/${input.sourceRef.repository}/${input.sourceRef.ref}/${encodeGitHubPath(input.filePath)}`

const defaultFetchText: FetchText = async (url) => {
  const accept = url.startsWith('https://api.github.com/')
    ? 'application/vnd.github+json'
    : 'text/plain'
  const response = await fetch(url, {
    headers: {
      accept
    }
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`)
  }

  return response.text()
}

const ensureParentDirectory = async (filePath: string): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true })
}

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await readFile(filePath)
    return true
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return false
    }

    throw error
  }
}

const copyFileInsideRoot = async (
  input: {
    readonly repositoryRoot: string
    readonly fromRelative: string
    readonly toRelative: string
  }
): Promise<void> => {
  const [fromPath, toPath] = await Promise.all([
    resolveExistingPathInsideRoot(input.repositoryRoot, input.fromRelative),
    resolveWritePathInsideRoot(input.repositoryRoot, input.toRelative)
  ])

  await ensureParentDirectory(toPath)
  await writeFile(toPath, await readFile(fromPath))
}

const writeJsonInsideRoot = async (
  input: {
    readonly repositoryRoot: string
    readonly relativePath: string
    readonly value: unknown
  }
): Promise<void> => {
  const outputPath = await resolveWritePathInsideRoot(
    input.repositoryRoot,
    input.relativePath
  )

  await ensureParentDirectory(outputPath)
  await writeFile(outputPath, `${JSON.stringify(input.value, null, 2)}\n`)
}

const writeTextInsideRoot = async (
  input: {
    readonly repositoryRoot: string
    readonly relativePath: string
    readonly content: string
  }
): Promise<void> => {
  const outputPath = await resolveWritePathInsideRoot(
    input.repositoryRoot,
    input.relativePath
  )

  await ensureParentDirectory(outputPath)
  await writeFile(outputPath, input.content)
}

export const materializeDiffFiles = (
  diff: string
): readonly MaterializedDiffFile[] => {
  const files: MutableDiffFile[] = []
  let currentFile: MutableDiffFile | undefined
  let currentNewLine: number | undefined

  for (const line of diff.split(/\r?\n/u)) {
    const nextPath = parseDiffNewPath(line)

    if (nextPath !== undefined) {
      currentFile = {
        path: nextPath,
        lines: [],
        hasHunkContent: false
      }
      currentNewLine = undefined
      files.push(currentFile)
      continue
    }

    if (currentFile === undefined) {
      continue
    }

    const hunk = hunkPattern.exec(line)

    if (hunk !== null) {
      currentNewLine = Number.parseInt(hunk[1] ?? '0', 10)
      continue
    }

    if (currentNewLine === undefined) {
      continue
    }

    if (line.startsWith('+') && !line.startsWith('+++ ')) {
      currentFile.lines[currentNewLine - 1] = line.slice(1)
      currentFile.hasHunkContent = true
      currentNewLine += 1
      continue
    }

    if (line.startsWith(' ')) {
      currentFile.lines[currentNewLine - 1] = line.slice(1)
      currentFile.hasHunkContent = true
      currentNewLine += 1
      continue
    }

    if (line.startsWith('-') || line.startsWith('\\')) {
      continue
    }
  }

  return files
    .filter((file) => file.hasHunkContent)
    .map((file) => ({
      path: file.path,
      content: `${file.lines.map((line) => line ?? '').join('\n')}\n`
    }))
}

const changedFilesFromDiff = (diff: string): readonly ChangedDiffFile[] =>
  materializeDiffFiles(diff).map((file) => ({ path: file.path }))

const readSliceJson = async (
  repositoryRoot: string,
  relativePath: string
): Promise<Record<string, unknown>> => {
  const slicePath = await resolveExistingPathInsideRoot(
    repositoryRoot,
    relativePath
  )

  return JSON.parse(await readFile(slicePath, 'utf8')) as Record<string, unknown>
}

const expectedFindingCount = (slice: Record<string, unknown>): number =>
  Array.isArray(slice.expectedFindings)
    ? slice.expectedFindings.length
    : Array.isArray(slice.expected)
      ? slice.expected.length
      : 0

const cachedHydratedCaseFileCount = async (
  input: {
    readonly repositoryRoot: string
    readonly outputSliceRoot: string
    readonly entryName: string
  }
): Promise<number | undefined> => {
  const slicePath = await resolveWritePathInsideRoot(
    input.repositoryRoot,
    path.posix.join(input.outputSliceRoot, input.entryName, 'slice.json')
  )

  if (!(await pathExists(slicePath))) {
    return undefined
  }

  const slice = JSON.parse(await readFile(slicePath, 'utf8')) as Record<
    string,
    unknown
  >
  const changedFiles = Array.isArray(slice.changedFiles)
    ? slice.changedFiles.filter((value): value is string => typeof value === 'string')
    : []

  if (
    slice.hydratedSource !== fullFileHydrationSource ||
    typeof slice.diff !== 'string' ||
    slice.diff.includes('Minimal source exists') ||
    changedFiles.length === 0
  ) {
    return undefined
  }

  const firstFilePath = await resolveWritePathInsideRoot(
    input.repositoryRoot,
    path.posix.join(input.outputSliceRoot, input.entryName, 'repo', changedFiles[0]!)
  )

  return (await pathExists(firstFilePath)) ? changedFiles.length : undefined
}

const copyMetadataOnlyCase = async (
  input: {
    readonly repositoryRoot: string
    readonly sourceSliceRoot: string
    readonly outputSliceRoot: string
    readonly entryName: string
    readonly changedFiles: readonly string[]
  }
): Promise<void> => {
  await copyFileInsideRoot({
    repositoryRoot: input.repositoryRoot,
    fromRelative: path.posix.join(input.sourceSliceRoot, input.entryName, 'slice.json'),
    toRelative: path.posix.join(input.outputSliceRoot, input.entryName, 'slice.json')
  })

  for (const changedFile of input.changedFiles) {
    await copyFileInsideRoot({
      repositoryRoot: input.repositoryRoot,
      fromRelative: path.posix.join(
        input.sourceSliceRoot,
        input.entryName,
        'repo',
        changedFile
      ),
      toRelative: path.posix.join(
        input.outputSliceRoot,
        input.entryName,
        'repo',
        changedFile
      )
    })
  }
}

const hydratePositiveCase = async (
  input: {
    readonly repositoryRoot: string
    readonly outputSliceRoot: string
    readonly entryName: string
    readonly slice: Record<string, unknown>
    readonly fetchText: FetchText
  }
): Promise<number> => {
  if (typeof input.slice.prUrl !== 'string') {
    throw new Error(`Benchmark case ${input.entryName} is missing prUrl.`)
  }

  const diff = await input.fetchText(diffUrlFor(input.slice.prUrl))
  const sourceRef = await resolveGitHubSourceRef({
    sourceUrl: input.slice.prUrl,
    fetchText: input.fetchText
  })
  const files = changedFilesFromDiff(diff)

  if (files.length === 0) {
    throw new Error(`Benchmark case ${input.entryName} produced no diff files.`)
  }

  const changedFiles = files.map((file) => file.path)
  const hydratedSlice = {
    ...input.slice,
    description:
      typeof input.slice.description === 'string'
        ? `${input.slice.description} Hydrated from public unified diff and full head-side files.`
        : 'Hydrated from public unified diff and full head-side files.',
    hydratedSource: fullFileHydrationSource,
    hydratedHeadRepository: sourceRef.repository,
    hydratedHeadRef: sourceRef.ref,
    diff,
    changedFiles,
    expectedNoFindingZones: []
  }

  await writeJsonInsideRoot({
    repositoryRoot: input.repositoryRoot,
    relativePath: path.posix.join(input.outputSliceRoot, input.entryName, 'slice.json'),
    value: hydratedSlice
  })

  await Promise.all(
    files.map((file) =>
      input.fetchText(rawFileUrlFor({ sourceRef, filePath: file.path })).then(
        (content) =>
          writeTextInsideRoot({
            repositoryRoot: input.repositoryRoot,
            relativePath: path.posix.join(
              input.outputSliceRoot,
              input.entryName,
              'repo',
              file.path
            ),
            content
          })
      )
    )
  )

  return files.length
}

export const hydrateCodeReviewBenchmarkPack = async (
  options: HydrateBenchmarkPackOptions
): Promise<HydrateBenchmarkPackResult> => {
  const sourceSliceRoot = options.sourceSliceRoot ?? defaultSourceSliceRoot
  const outputSliceRoot = options.outputSliceRoot ?? defaultOutputSliceRoot
  const fetchText = options.fetchText ?? defaultFetchText
  const caseFilterSet =
    options.caseFilters === undefined || options.caseFilters.length === 0
      ? undefined
      : new Set(options.caseFilters)
  const sourceRoot = await resolveExistingPathInsideRoot(
    options.repositoryRoot,
    sourceSliceRoot
  )
  const outputRoot = await resolveWritePathInsideRoot(
    options.repositoryRoot,
    outputSliceRoot
  )

  if (options.force === true) {
    await rm(outputRoot, { recursive: true, force: true })
  }
  await mkdir(outputRoot, { recursive: true })

  const entries = await readdir(sourceRoot, { withFileTypes: true })
  let hydratedCaseCount = 0
  let copiedCaseCount = 0
  let cachedCaseCount = 0
  let changedFileCount = 0

  for (const entry of entries
    .filter((candidate) => candidate.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const slice = await readSliceJson(
      options.repositoryRoot,
      path.posix.join(sourceSliceRoot, entry.name, 'slice.json')
    )
    const caseId = typeof slice.id === 'string' ? slice.id : entry.name

    if (caseFilterSet !== undefined && !caseFilterSet.has(caseId)) {
      continue
    }

    const changedFiles = Array.isArray(slice.changedFiles)
      ? slice.changedFiles.filter((value): value is string => typeof value === 'string')
      : []

    if (expectedFindingCount(slice) === 0) {
      await copyMetadataOnlyCase({
        repositoryRoot: options.repositoryRoot,
        sourceSliceRoot,
        outputSliceRoot,
        entryName: entry.name,
        changedFiles
      })
      copiedCaseCount += 1
      changedFileCount += changedFiles.length
      continue
    }

    const cachedFileCount =
      options.force === true
        ? undefined
        : await cachedHydratedCaseFileCount({
            repositoryRoot: options.repositoryRoot,
            outputSliceRoot,
            entryName: entry.name
          })

    if (cachedFileCount !== undefined) {
      cachedCaseCount += 1
      changedFileCount += cachedFileCount
      continue
    }

    options.log?.(`Hydrating ${caseId}`)
    changedFileCount += await hydratePositiveCase({
      repositoryRoot: options.repositoryRoot,
      outputSliceRoot,
      entryName: entry.name,
      slice,
      fetchText
    })
    hydratedCaseCount += 1
  }

  return {
    sourceSliceRoot,
    outputSliceRoot,
    hydratedCaseCount,
    copiedCaseCount,
    cachedCaseCount,
    changedFileCount
  }
}
