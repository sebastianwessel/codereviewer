import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  resolveExistingPathInsideRoot,
  resolveWritePathInsideRoot
} from '../../../platform/path-service.js'
import { isFileNotFoundError } from '../../../shared/errors/error-normalizer.js'
import { materializeDiffFiles } from './benchmark-hydration.js'
import { EvalSliceCaseSchema } from './eval-fixture.schema.js'
import {
  removedProseCommentsIn,
  resolveRemovedCommentDisclosures
} from './real-repo-diff-comment-disclosure.js'
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

// Depth 2 is exactly what a case needs: the pinned commit and its parent, which
// is the pair every corpus here reviews whichever way round it reads them.
// Fetching one commit by object name avoids downloading the repository's history.
export const gitFetchArgs = (input: {
  readonly commit: string
}): readonly string[] => [
  'fetch',
  '--quiet',
  '--no-tags',
  '--depth',
  '2',
  'origin',
  input.commit
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

// Takes any commit: spec 17 checks out the fix's PARENT and reads the fix
// backwards, spec 22 checks out the commit that INTRODUCED the change. The
// argument list is the same either way, which is why one helper serves both.
export const gitCheckoutArgs = (commit: string): readonly string[] => [
  '-c',
  'advice.detachedHead=false',
  'checkout',
  '--quiet',
  '--detach',
  '--force',
  commit
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
// its checkout sits on the commit the case says it reviews AND its slice carries
// a reviewed diff. Anything else is rebuilt rather than trusted. Which commit
// that is depends on the corpus's orientation, so the caller names it.
export const resolveCaseHydrationState = (input: {
  readonly headCommit: string | undefined
  readonly expectedCheckoutCommit: string
  readonly sliceDiff: string | undefined
  readonly sliceMatchesCaseDefinition: boolean
}): CaseHydrationState => {
  if (input.headCommit === undefined && input.sliceDiff === undefined) {
    return 'absent'
  }

  return input.headCommit === input.expectedCheckoutCommit &&
    input.sliceDiff !== undefined &&
    input.sliceDiff.length > 0 &&
    input.sliceMatchesCaseDefinition
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

// Everything the reviewed diff must not contain, checked on the diff a run will
// actually score. It runs for a rebuilt case AND for a reused one: a slice
// hydrated before a rule existed would otherwise be served from cache forever,
// and the disclosure record is not part of the slice, so editing it does not
// invalidate the cache either.
export const assertReviewedDiffIsUncontaminated = (input: {
  readonly corpusCase: RealRepoCorpusCase
  readonly diff: string
  readonly log?: (message: string) => void
}): void => {
  // The manifest's own text is validated for answer-key wording, but the reviewed
  // DIFF is generated from upstream and is what the model actually reads. An
  // upstream fix that also added an advisory id puts the answer inside the
  // model's input, and a case like that measures nothing while silently
  // inflating recall.
  const diffLeak = answerKeyLeakIn(input.diff)

  if (diffLeak !== undefined) {
    throw new Error(
      `Corpus case "${input.corpusCase.id}": the reviewed diff names the defect, so the answer key is inside the model's input ("${diffLeak}"). Drop the case or choose reviewed paths that exclude the disclosure.`
    )
  }

  // A comment the upstream fix added is a REMOVED line in this reversed diff, and
  // advisory wording is not how an engineer writes one. Prose comments are too
  // fuzzy to reject outright, so each one must be judged by a curator and the
  // judgement recorded in the manifest; an unjudged one fails the case rather
  // than scoring against an answer key the model was shown in English.
  const flaggedComments = removedProseCommentsIn(input.diff)
  const acknowledgedComments =
    input.corpusCase.removedCommentDisclosureReview?.acknowledgedComments ?? []
  const { unresolvedComments, staleAcknowledgements } =
    resolveRemovedCommentDisclosures({ flaggedComments, acknowledgedComments })

  if (unresolvedComments.length > 0) {
    throw new Error(
      `Corpus case "${input.corpusCase.id}": the reviewed diff removes ${unresolvedComments.length} prose comment(s) no curator has judged, and a comment the upstream fix added states the defect in English. Read each one against the case's expectations, then either drop the case or record it under removedCommentDisclosureReview.acknowledgedComments: ${unresolvedComments.map((comment) => `"${comment}"`).join(', ')}.`
    )
  }

  if (staleAcknowledgements.length > 0) {
    throw new Error(
      `Corpus case "${input.corpusCase.id}": removedCommentDisclosureReview acknowledges comment(s) the reviewed diff no longer removes, so the resolution would blanket-cover whatever appears next. Remove them: ${staleAcknowledgements.map((comment) => `"${comment}"`).join(', ')}.`
    )
  }

  if (flaggedComments.length > 0) {
    input.log?.(
      `${input.corpusCase.id}: ${flaggedComments.length} removed prose comment(s) reviewed as non-disclosing on ${input.corpusCase.removedCommentDisclosureReview?.reviewedAt ?? 'an unrecorded date'}`
    )
  }
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
    if (isFileNotFoundError(error)) {
      return undefined
    }

    throw error
  }
}

const readSlice = async (
  slicePath: string
): Promise<Record<string, unknown> | undefined> => {
  const text = await readOptionalText(slicePath)

  if (text === undefined) {
    return undefined
  }

  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    // An unreadable slice is rebuilt, exactly like a missing one.
    return undefined
  }
}

const sliceDiffOf = (
  slice: Record<string, unknown> | undefined
): string | undefined =>
  typeof slice?.diff === 'string' ? slice.diff : undefined

// A hydrated slice carries a copy of the case definition, so editing the
// manifest leaves every existing slice describing the previous one. Comparing
// the stored slice against the definition it would be built from now is what
// makes a manifest edit take effect: without it, expected findings added to a
// curated case are silently absent from the next measurement, and the run
// reports a recall computed against a stale answer key.
const sliceMatchesCaseDefinition = (
  input: {
    readonly storedSlice: Record<string, unknown> | undefined
    readonly corpusCase: RealRepoCorpusCase
    readonly datasetId: string
  }
): boolean => {
  const storedDiff = sliceDiffOf(input.storedSlice)
  const storedChangedFiles = input.storedSlice?.changedFiles

  if (storedDiff === undefined || !Array.isArray(storedChangedFiles)) {
    return false
  }

  try {
    return (
      JSON.stringify(input.storedSlice) ===
      JSON.stringify(
        buildRealRepoSlice({
          corpusCase: input.corpusCase,
          datasetId: input.datasetId,
          diff: storedDiff,
          changedFiles: storedChangedFiles as readonly string[]
        })
      )
    )
  } catch {
    // A definition the builder now rejects (a reviewed path that no longer
    // covers the stored diff, say) cannot be reused either.
    return false
  }
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

  // Every case is built from an empty directory. `git init` is idempotent but
  // `git remote add` is not, so re-running against leftover material fails with
  // "remote origin already exists" — and a directory left by an interrupted
  // hydration reads as absent rather than stale, because it has neither a
  // resolvable HEAD nor a slice. Rebuilding unconditionally also discards
  // partial fetches, which cannot be trusted to describe the commit they claim.
  await rm(input.caseDirectory, { recursive: true, force: true })
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
    args: gitFetchArgs({ commit: input.corpusCase.fixCommit }),
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

  assertReviewedDiffIsUncontaminated({
    corpusCase: input.corpusCase,
    diff,
    ...(input.log === undefined ? {} : { log: input.log })
  })

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

  // Forcing removes only what this run rebuilds. Clearing the whole root while
  // case filters are in effect would destroy the checkouts of every unselected
  // case, which the run then does not restore — the same reason pruning is
  // skipped for a filtered run.
  if (options.force === true) {
    await Promise.all(
      selectedCases.map(async (corpusCase) =>
        rm(path.join(outputRoot, corpusCase.id), {
          recursive: true,
          force: true
        })
      )
    )
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
    const [headCommit, storedSlice] = await Promise.all([
      readHeadCommit({
        runGit,
        workTreeDirectory: path.join(caseDirectory, 'repo')
      }),
      readSlice(slicePath)
    ])
    const sliceDiff = sliceDiffOf(storedSlice)
    const state = resolveCaseHydrationState({
      sliceMatchesCaseDefinition: sliceMatchesCaseDefinition({
        storedSlice,
        corpusCase,
        datasetId: manifest.datasetId
      }),
      headCommit,
      expectedCheckoutCommit: corpusCase.parentCommit,
      sliceDiff
    })

    if (state === 'hydrated' && sliceDiff !== undefined) {
      assertReviewedDiffIsUncontaminated({
        corpusCase,
        diff: sliceDiff,
        ...(options.log === undefined ? {} : { log: options.log })
      })

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

    // A stale case is repaired by rebuilding it; `checkoutCase` clears the case
    // directory for every case it builds, so no separate removal is needed here.
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
