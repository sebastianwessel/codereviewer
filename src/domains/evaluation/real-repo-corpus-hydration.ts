import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  resolveExistingPathInsideRoot,
  resolveWritePathInsideRoot
} from '../../platform/path-service.js'
import { materializeDiffFiles } from './benchmark-hydration.js'
import { EvalSliceCaseSchema } from './eval-fixture.schema.js'
import {
  answerKeyLeakIn,
  parseRealRepoCorpusManifestJson,
  selectCorpusCases,
  tokenNormalizedDiffFingerprint,
  type RealRepoCorpusCase,
  type RealRepoCorpusManifest
} from './real-repo-corpus.schema.js'

const execFileAsync = promisify(execFile)

export const defaultRealRepoManifestPath =
  'eval/corpora/real-repo-cross-file/manifest.json'
export const defaultRealRepoOutputSliceRoot =
  '.codereviewer/eval/corpus-slices/real-repo-cross-file'

// Marks a hydrated slice as a full working-tree checkout, distinguishing it from
// the changed-files-only benchmark hydration.
export const realRepoHydrationSource = 'real-repo-full-checkout-v1'

// Git diffs of a whole commit can be large; the default 1 MB stdout cap would
// truncate them into invalid patches.
const gitOutputByteCap = 64 * 1024 * 1024

export type CorpusGitCommandRunner = (input: {
  readonly args: readonly string[]
  readonly cwd: string
}) => Promise<string>

const defaultGitRunner: CorpusGitCommandRunner = async ({ args, cwd }) => {
  const { stdout } = await execFileAsync('git', [...args], {
    cwd,
    maxBuffer: gitOutputByteCap,
    // Repository content is untrusted input: never let a hydration run inherit
    // an interactive credential or editor prompt that would hang CI.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  })

  return stdout
}

// Git argument builders. They are pure so the exact plumbing a case runs can be
// asserted in tests without touching the network.

// A separate git directory keeps `repo/` a clean working tree: only a small
// `.git` pointer file sits beside the sources, so the reviewed fixture root is
// the repository content and nothing else.
export const gitInitArgs = (input: {
  readonly gitDirectory: string
  readonly workTreeDirectory: string
}): readonly string[] => [
  '-c',
  'init.defaultBranch=main',
  'init',
  '--quiet',
  '--separate-git-dir',
  input.gitDirectory,
  input.workTreeDirectory
]

export const gitRemoteArgs = (repositoryUrl: string): readonly string[] => [
  'remote',
  'add',
  'origin',
  repositoryUrl
]

// Checked-out bytes must not depend on the host: line-ending translation would
// shift every expected line range on Windows.
export const gitDisableAutoCrlfArgs = (): readonly string[] => [
  'config',
  'core.autocrlf',
  'false'
]

// Depth 2 is exactly what a case needs: the fix commit and its parent. Fetching
// one commit by object name avoids downloading the repository's history.
export const gitFetchArgs = (input: {
  readonly fixCommit: string
}): readonly string[] => [
  'fetch',
  '--quiet',
  '--no-tags',
  '--depth',
  '2',
  'origin',
  input.fixCommit
]

export const gitParentOfArgs = (fixCommit: string): readonly string[] => [
  'rev-parse',
  '--verify',
  `${fixCommit}^`
]

export const gitHeadArgs = (): readonly string[] => [
  'rev-parse',
  '--verify',
  'HEAD'
]

export const gitCheckoutArgs = (parentCommit: string): readonly string[] => [
  '-c',
  'advice.detachedHead=false',
  'checkout',
  '--quiet',
  '--detach',
  '--force',
  parentCommit
]

// The reviewed change is the fix READ BACKWARDS: base is the repaired tree, head
// is the parent that still contains the defect. That direction is required, not
// stylistic — the new side of the diff must be the tree that was checked out, or
// every expected line range points at bytes the reviewer never saw.
//
// `git diff` is used rather than `git show -R`, because `show` prints the fix
// commit message, which is the answer key. Paths are restricted for the same
// reason: a fix commonly adds a regression test whose name states the defect.
export const gitReviewedDiffArgs = (input: {
  readonly fixCommit: string
  readonly parentCommit: string
  readonly reviewedPaths: readonly string[]
}): readonly string[] => [
  'diff',
  '--no-color',
  '--no-ext-diff',
  '--no-renames',
  input.fixCommit,
  input.parentCommit,
  '--',
  ...input.reviewedPaths
]

export type CaseHydrationState = 'hydrated' | 'absent' | 'stale'

// Idempotence and integrity in one decision: a case counts as hydrated only when
// its checkout sits on the expected parent commit AND its slice carries a
// reviewed diff. Anything else is rebuilt rather than trusted.
export const resolveCaseHydrationState = (input: {
  readonly headCommit: string | undefined
  readonly expectedParentCommit: string
  readonly sliceDiff: string | undefined
}): CaseHydrationState => {
  if (input.headCommit === undefined && input.sliceDiff === undefined) {
    return 'absent'
  }

  return input.headCommit === input.expectedParentCommit &&
    input.sliceDiff !== undefined &&
    input.sliceDiff.length > 0
    ? 'hydrated'
    : 'stale'
}

// A reviewed path is declared per case; anything the diff touches outside that
// set means the manifest declared a directory or drifted from upstream, and the
// case would review files its expectations never covered.
export const diffPathsOutsideReviewedSet = (input: {
  readonly diffPaths: readonly string[]
  readonly reviewedPaths: readonly string[]
}): readonly string[] => {
  const reviewed = new Set(input.reviewedPaths)

  return input.diffPaths.filter((diffPath) => !reviewed.has(diffPath))
}

export const buildRealRepoSlice = (input: {
  readonly corpusCase: RealRepoCorpusCase
  readonly datasetId: string
  readonly diff: string
  readonly changedFiles: readonly string[]
}): Record<string, unknown> => {
  const upstream = `${input.corpusCase.upstreamOwner}/${input.corpusCase.upstreamRepo}`
  const slice = {
    id: input.corpusCase.id,
    title: input.corpusCase.reviewIntent,
    description: `Full ${upstream} working tree at ${input.corpusCase.parentCommit}, reviewed as the change that introduces the defect. License ${input.corpusCase.license}; split ${input.corpusCase.split}.`,
    source: input.datasetId,
    sourceUrl: input.corpusCase.repositoryUrl,
    sourceProfile: 'captured-pr',
    capturedAt: input.corpusCase.capturedAt,
    sourceRepo: upstream,
    upstreamOwner: input.corpusCase.upstreamOwner,
    upstreamRepo: input.corpusCase.upstreamRepo,
    // Base/head follow the reviewed diff, not the upstream history: the base is
    // the fixed tree and the head is the pre-fix tree that was checked out.
    baseSha: input.corpusCase.fixCommit,
    headSha: input.corpusCase.parentCommit,
    hydratedSource: realRepoHydrationSource,
    hydratedHeadRepository: upstream,
    hydratedHeadRef: input.corpusCase.parentCommit,
    diff: input.diff,
    language: input.corpusCase.language,
    changedFiles: [...input.changedFiles],
    expectedFindings: input.corpusCase.expectedFindings,
    expectedNoFindingZones: input.corpusCase.expectedNoFindingZones,
    tags: [
      ...new Set([
        ...input.corpusCase.tags,
        'real-repo-corpus',
        'full-checkout',
        input.corpusCase.split
      ])
    ]
  }

  // Fail here rather than at eval time: a slice this tool cannot load is a bug
  // in this tool, not a dataset problem for the runner to discover.
  EvalSliceCaseSchema.parse(slice)

  return slice
}

export type RealRepoCaseResult = {
  readonly id: string
  readonly split: string
  readonly state: 'hydrated' | 'repaired' | 'cached'
  readonly changedFileCount: number
  readonly diffFingerprint: string
}

export type HydrateRealRepoCorpusOptions = {
  readonly repositoryRoot: string
  readonly manifestPath?: string
  readonly outputSliceRoot?: string
  readonly caseFilters?: readonly string[]
  readonly force?: boolean
  readonly runGit?: CorpusGitCommandRunner
  readonly log?: (message: string) => void
}

export type HydrateRealRepoCorpusResult = {
  readonly manifestPath: string
  readonly outputSliceRoot: string
  readonly datasetId: string
  readonly hydratedCaseCount: number
  readonly repairedCaseCount: number
  readonly cachedCaseCount: number
  readonly reviewedFileCount: number
  // Case directories removed because the manifest no longer defines them. An
  // eval loads a slice root by DIRECTORY, so a checkout left behind by a dropped
  // case would silently re-enter the next measurement as a case nobody curates.
  readonly prunedCaseIds: readonly string[]
  readonly cases: readonly RealRepoCaseResult[]
}

const readOptionalText = async (
  filePath: string
): Promise<string | undefined> => {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return undefined
    }

    throw error
  }
}

const readSliceDiff = async (
  slicePath: string
): Promise<string | undefined> => {
  const text = await readOptionalText(slicePath)

  if (text === undefined) {
    return undefined
  }

  const slice = JSON.parse(text) as Record<string, unknown>

  return typeof slice.diff === 'string' ? slice.diff : undefined
}

const readHeadCommit = async (
  input: {
    readonly runGit: CorpusGitCommandRunner
    readonly workTreeDirectory: string
  }
): Promise<string | undefined> => {
  try {
    return (
      await input.runGit({
        args: gitHeadArgs(),
        cwd: input.workTreeDirectory
      })
    ).trim()
  } catch {
    // No git directory, a broken checkout, or an interrupted fetch: all mean the
    // case must be rebuilt, and none of them is worth distinguishing here.
    return undefined
  }
}

const checkoutCase = async (
  input: {
    readonly corpusCase: RealRepoCorpusCase
    readonly caseDirectory: string
    readonly runGit: CorpusGitCommandRunner
  }
): Promise<string> => {
  const workTreeDirectory = path.join(input.caseDirectory, 'repo')
  const gitDirectory = path.join(input.caseDirectory, 'git')

  await mkdir(workTreeDirectory, { recursive: true })
  await input.runGit({
    args: gitInitArgs({ gitDirectory, workTreeDirectory }),
    cwd: input.caseDirectory
  })
  await input.runGit({
    args: gitDisableAutoCrlfArgs(),
    cwd: workTreeDirectory
  })
  await input.runGit({
    args: gitRemoteArgs(input.corpusCase.repositoryUrl),
    cwd: workTreeDirectory
  })
  await input.runGit({
    args: gitFetchArgs({ fixCommit: input.corpusCase.fixCommit }),
    cwd: workTreeDirectory
  })

  const parentCommit = (
    await input.runGit({
      args: gitParentOfArgs(input.corpusCase.fixCommit),
      cwd: workTreeDirectory
    })
  ).trim()

  // The manifest's commit pair is ground truth for every expected line range. If
  // upstream history was rewritten, the case must be re-captured, not reviewed.
  if (parentCommit !== input.corpusCase.parentCommit) {
    throw new Error(
      `Corpus case "${input.corpusCase.id}": upstream parent of ${input.corpusCase.fixCommit} is ${parentCommit}, but the manifest declares ${input.corpusCase.parentCommit}.`
    )
  }

  await input.runGit({
    args: gitCheckoutArgs(input.corpusCase.parentCommit),
    cwd: workTreeDirectory
  })

  const headCommit = await readHeadCommit({
    runGit: input.runGit,
    workTreeDirectory
  })

  if (headCommit !== input.corpusCase.parentCommit) {
    throw new Error(
      `Corpus case "${input.corpusCase.id}": checkout landed on ${headCommit ?? 'an unknown commit'} instead of ${input.corpusCase.parentCommit}.`
    )
  }

  return input.runGit({
    args: gitReviewedDiffArgs({
      fixCommit: input.corpusCase.fixCommit,
      parentCommit: input.corpusCase.parentCommit,
      reviewedPaths: input.corpusCase.reviewedPaths
    }),
    cwd: workTreeDirectory
  })
}

const writeSlice = async (
  input: {
    readonly slicePath: string
    readonly slice: Record<string, unknown>
  }
): Promise<void> => {
  await mkdir(path.dirname(input.slicePath), { recursive: true })
  await writeFile(input.slicePath, `${JSON.stringify(input.slice, null, 2)}\n`)
}

const hydrateCase = async (
  input: {
    readonly manifest: RealRepoCorpusManifest
    readonly corpusCase: RealRepoCorpusCase
    readonly caseDirectory: string
    readonly slicePath: string
    readonly runGit: CorpusGitCommandRunner
    readonly log?: (message: string) => void
  }
): Promise<{ readonly changedFileCount: number; readonly diff: string }> => {
  const diff = await checkoutCase({
    corpusCase: input.corpusCase,
    caseDirectory: input.caseDirectory,
    runGit: input.runGit
  })
  const changedFiles = materializeDiffFiles(diff).map((file) => file.path)
  const unexpectedPaths = diffPathsOutsideReviewedSet({
    diffPaths: changedFiles,
    reviewedPaths: input.corpusCase.reviewedPaths
  })

  if (unexpectedPaths.length > 0) {
    throw new Error(
      `Corpus case "${input.corpusCase.id}": reviewed diff touches undeclared path(s) ${unexpectedPaths.join(', ')}. Declare explicit file paths in reviewedPaths.`
    )
  }

  if (changedFiles.length === 0) {
    throw new Error(
      `Corpus case "${input.corpusCase.id}": reviewed diff contains no new-side file content.`
    )
  }

  // The manifest's own text is validated for answer-key wording, but the reviewed
  // DIFF is generated from upstream and is what the model actually reads. An
  // upstream fix that also added an advisory id or a comment naming the defect
  // puts the answer inside the model's input, and a case like that measures
  // nothing while silently inflating recall. Reject it here rather than let it
  // score.
  const diffLeak = answerKeyLeakIn(diff)

  if (diffLeak !== undefined) {
    throw new Error(
      `Corpus case "${input.corpusCase.id}": the reviewed diff names the defect, so the answer key is inside the model's input ("${diffLeak}"). Drop the case or choose reviewed paths that exclude the disclosure.`
    )
  }

  // A declared path with no new-side content means the fix ADDED that file, so
  // the pre-fix tree has nothing to review there. Worth saying out loud, but not
  // fatal: the remaining paths still carry the case.
  for (const reviewedPath of input.corpusCase.reviewedPaths) {
    if (!changedFiles.includes(reviewedPath)) {
      input.log?.(
        `${input.corpusCase.id}: reviewed path ${reviewedPath} has no pre-fix content and is skipped`
      )
    }
  }

  await writeSlice({
    slicePath: input.slicePath,
    slice: buildRealRepoSlice({
      corpusCase: input.corpusCase,
      datasetId: input.manifest.datasetId,
      diff,
      changedFiles
    })
  })

  return { changedFileCount: changedFiles.length, diff }
}

// Hydrate the committed real-repository corpus into full working-tree checkouts
// under a gitignored output root, one slice directory per case, in the layout
// `eval run --slice-root` already understands.
// Remove hydrated case directories that the manifest no longer defines, and report
// which. Returns the pruned ids sorted so the result stays deterministic.
export const pruneUnknownCaseDirectories = async (
  outputRoot: string,
  knownCaseIds: ReadonlySet<string>
): Promise<readonly string[]> => {
  const entries = await readdir(outputRoot, { withFileTypes: true })
  const unknownCaseIds = entries
    .filter((entry) => entry.isDirectory() && !knownCaseIds.has(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))

  for (const caseId of unknownCaseIds) {
    await rm(path.join(outputRoot, caseId), { recursive: true, force: true })
  }

  return unknownCaseIds
}

export const hydrateRealRepoCorpus = async (
  options: HydrateRealRepoCorpusOptions
): Promise<HydrateRealRepoCorpusResult> => {
  const manifestPath = options.manifestPath ?? defaultRealRepoManifestPath
  const outputSliceRoot =
    options.outputSliceRoot ?? defaultRealRepoOutputSliceRoot
  const runGit = options.runGit ?? defaultGitRunner
  const manifest = parseRealRepoCorpusManifestJson(
    await readFile(
      await resolveExistingPathInsideRoot(options.repositoryRoot, manifestPath),
      'utf8'
    )
  )
  const selectedCases = selectCorpusCases(
    manifest.cases,
    options.caseFilters ?? []
  )
  const outputRoot = await resolveWritePathInsideRoot(
    options.repositoryRoot,
    outputSliceRoot
  )

  if (options.force === true) {
    await rm(outputRoot, { recursive: true, force: true })
  }

  await mkdir(outputRoot, { recursive: true })

  const results: RealRepoCaseResult[] = []
  const fingerprintOwners = new Map<string, string>()
  let hydratedCaseCount = 0
  let repairedCaseCount = 0
  let cachedCaseCount = 0
  let reviewedFileCount = 0

  for (const corpusCase of selectedCases) {
    const caseDirectory = path.join(outputRoot, corpusCase.id)
    const slicePath = path.join(caseDirectory, 'slice.json')
    const [headCommit, sliceDiff] = await Promise.all([
      readHeadCommit({
        runGit,
        workTreeDirectory: path.join(caseDirectory, 'repo')
      }),
      readSliceDiff(slicePath)
    ])
    const state = resolveCaseHydrationState({
      headCommit,
      expectedParentCommit: corpusCase.parentCommit,
      sliceDiff
    })

    if (state === 'hydrated' && sliceDiff !== undefined) {
      const changedFileCount = materializeDiffFiles(sliceDiff).length

      cachedCaseCount += 1
      reviewedFileCount += changedFileCount
      results.push({
        id: corpusCase.id,
        split: corpusCase.split,
        state: 'cached',
        changedFileCount,
        diffFingerprint: tokenNormalizedDiffFingerprint(sliceDiff)
      })
      continue
    }

    // A stale case is repaired by rebuilding it: a partially fetched checkout
    // cannot be trusted to describe the commit it claims.
    if (state === 'stale') {
      await rm(caseDirectory, { recursive: true, force: true })
    }

    options.log?.(
      `${state === 'stale' ? 'Repairing' : 'Hydrating'} ${corpusCase.id}`
    )

    const hydrated = await hydrateCase({
      manifest,
      corpusCase,
      caseDirectory,
      slicePath,
      runGit,
      ...(options.log === undefined ? {} : { log: options.log })
    })

    if (state === 'stale') {
      repairedCaseCount += 1
    } else {
      hydratedCaseCount += 1
    }

    reviewedFileCount += hydrated.changedFileCount
    results.push({
      id: corpusCase.id,
      split: corpusCase.split,
      state: state === 'stale' ? 'repaired' : 'hydrated',
      changedFileCount: hydrated.changedFileCount,
      diffFingerprint: tokenNormalizedDiffFingerprint(hydrated.diff)
    })
  }

  // Dedup is enforced on the hydrated material, not on a curator's promise: two
  // cases carrying the same normalized change would double-count one defect.
  for (const result of results) {
    const owner = fingerprintOwners.get(result.diffFingerprint)

    if (owner !== undefined) {
      throw new Error(
        `Corpus cases "${owner}" and "${result.id}" hydrate the same normalized change; remove the duplicate.`
      )
    }

    fingerprintOwners.set(result.diffFingerprint, result.id)
  }

  // Drop checkouts whose case the manifest no longer defines. Only done for a full
  // hydration: with `--case` filters the un-selected cases are legitimately absent
  // from this run and must not be deleted.
  const prunedCaseIds =
    (options.caseFilters ?? []).length > 0
      ? []
      : await pruneUnknownCaseDirectories(
          outputRoot,
          new Set(manifest.cases.map((corpusCase) => corpusCase.id))
        )

  return {
    manifestPath,
    outputSliceRoot,
    datasetId: manifest.datasetId,
    hydratedCaseCount,
    repairedCaseCount,
    cachedCaseCount,
    reviewedFileCount,
    prunedCaseIds,
    cases: results
  }
}
