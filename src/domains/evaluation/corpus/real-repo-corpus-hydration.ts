import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { materializeDiffFiles } from './benchmark-hydration.js'
import { EvalSliceCaseSchema } from './eval-fixture.schema.js'
import {
  checkoutCorpusCase,
  defaultCorpusGitRunner,
  type CorpusGitCommandRunner
} from './git-corpus-plumbing.js'
import {
  assertCorpusDiffIsUncontaminated,
  hydrateGitCorpus,
  readCorpusManifestText,
  storedDiffOf
} from './git-corpus-hydration.js'
import {
  parseRealRepoCorpusManifestJson,
  type RealRepoCorpusCase
} from './real-repo-corpus.schema.js'

// Spec 17's real-repository corpus: an upstream fix READ BACKWARDS, so the
// reviewed tree is the fix's parent and the diff runs from the repaired tree to
// the defective one. Everything here that differs from the change-impact corpus
// differs because of that orientation; the git plumbing, the hydration loop and
// the contamination rules are shared and imported.

export const defaultRealRepoManifestPath =
  'eval/corpora/real-repo-cross-file/manifest.json'
export const defaultRealRepoOutputSliceRoot =
  '.codereviewer/eval/corpus-slices/real-repo-cross-file'

// Marks a hydrated slice as a full working-tree checkout, distinguishing it from
// the changed-files-only benchmark hydration.
export const realRepoHydrationSource = 'real-repo-full-checkout-v1'

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

// The contamination guard for this corpus. The rules live in
// `assertCorpusDiffIsUncontaminated`; what this corpus adds is its own wording:
// the reviewed diff is the fix reversed, so a comment the upstream fix ADDED is a
// REMOVED line here, and advisory wording is not how an engineer writes one.
export const assertReviewedDiffIsUncontaminated = (input: {
  readonly corpusCase: RealRepoCorpusCase
  readonly diff: string
  readonly log?: (message: string) => void
}): void => {
  assertCorpusDiffIsUncontaminated({
    caseLabel: `Corpus case "${input.corpusCase.id}"`,
    caseId: input.corpusCase.id,
    diff: input.diff,
    disclosureReview: input.corpusCase.removedCommentDisclosureReview,
    unjudgedCommentNote:
      ', and a comment the upstream fix added states the defect in English',
    ...(input.log === undefined ? {} : { log: input.log })
  })
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

// A hydrated slice carries a copy of the case definition, so editing the
// manifest leaves every existing slice describing the previous one. Comparing
// the stored slice against the definition it would be built from now is what
// makes a manifest edit take effect: without it, expected findings added to a
// curated case are silently absent from the next measurement, and the run
// reports a recall computed against a stale answer key.
const sliceMatchesCaseDefinition = (input: {
  readonly storedSlice: Record<string, unknown> | undefined
  readonly corpusCase: RealRepoCorpusCase
  readonly datasetId: string
}): boolean => {
  const storedDiff = storedDiffOf(input.storedSlice)
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

const writeSlice = async (input: {
  readonly slicePath: string
  readonly slice: Record<string, unknown>
}): Promise<void> => {
  await mkdir(path.dirname(input.slicePath), { recursive: true })
  await writeFile(input.slicePath, `${JSON.stringify(input.slice, null, 2)}\n`)
}

const hydrateCase = async (input: {
  readonly datasetId: string
  readonly corpusCase: RealRepoCorpusCase
  readonly caseDirectory: string
  readonly artifactPath: string
  readonly runGit: CorpusGitCommandRunner
  readonly log?: (message: string) => void
}): Promise<{ readonly reviewedFileCount: number; readonly diff: string }> => {
  const diff = await checkoutCorpusCase({
    caseLabel: `Corpus case "${input.corpusCase.id}"`,
    caseDirectory: input.caseDirectory,
    repositoryUrl: input.corpusCase.repositoryUrl,
    fetchCommit: input.corpusCase.fixCommit,
    declaredParentCommit: input.corpusCase.parentCommit,
    // The PRE-FIX tree is the working tree: it is the state that still contains
    // the defect, and the state every expected line range is written against.
    checkoutCommit: input.corpusCase.parentCommit,
    reviewedDiffArgs: gitReviewedDiffArgs({
      fixCommit: input.corpusCase.fixCommit,
      parentCommit: input.corpusCase.parentCommit,
      reviewedPaths: input.corpusCase.reviewedPaths
    }),
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
    slicePath: input.artifactPath,
    slice: buildRealRepoSlice({
      corpusCase: input.corpusCase,
      datasetId: input.datasetId,
      diff,
      changedFiles
    })
  })

  return { reviewedFileCount: changedFiles.length, diff }
}

// Hydrate the committed real-repository corpus into full working-tree checkouts
// under a gitignored output root, one slice directory per case, in the layout
// `eval run --slice-root` already understands.
export const hydrateRealRepoCorpus = async (
  options: HydrateRealRepoCorpusOptions
): Promise<HydrateRealRepoCorpusResult> => {
  const manifestPath = options.manifestPath ?? defaultRealRepoManifestPath
  const outputSliceRoot =
    options.outputSliceRoot ?? defaultRealRepoOutputSliceRoot
  const manifest = parseRealRepoCorpusManifestJson(
    await readCorpusManifestText(options.repositoryRoot, manifestPath)
  )
  const outcome = await hydrateGitCorpus<RealRepoCorpusCase, RealRepoCaseResult>(
    {
      repositoryRoot: options.repositoryRoot,
      outputRoot: outputSliceRoot,
      caseFilters: options.caseFilters ?? [],
      force: options.force === true,
      runGit: options.runGit ?? defaultCorpusGitRunner,
      ...(options.log === undefined ? {} : { log: options.log }),
      manifestCases: manifest.cases,
      artifactFileName: 'slice.json',
      expectedCheckoutCommit: (corpusCase) => corpusCase.parentCommit,
      storedArtifactMatchesCase: ({ stored, corpusCase }) =>
        sliceMatchesCaseDefinition({
          storedSlice: stored,
          corpusCase,
          datasetId: manifest.datasetId
        }),
      assertDiffIsUncontaminated: assertReviewedDiffIsUncontaminated,
      countReviewedFiles: (diff) => materializeDiffFiles(diff).length,
      hydrateCase: async (input) =>
        hydrateCase({ datasetId: manifest.datasetId, ...input }),
      buildCaseResult: ({
        corpusCase,
        state,
        reviewedFileCount,
        diffFingerprint
      }) => ({
        id: corpusCase.id,
        split: corpusCase.split,
        state,
        changedFileCount: reviewedFileCount,
        diffFingerprint
      }),
      duplicateChangeMessage: ({ ownerCaseId, caseId }) =>
        `Corpus cases "${ownerCaseId}" and "${caseId}" hydrate the same normalized change; remove the duplicate.`
    }
  )

  return {
    manifestPath,
    outputSliceRoot,
    datasetId: manifest.datasetId,
    hydratedCaseCount: outcome.hydratedCaseCount,
    repairedCaseCount: outcome.repairedCaseCount,
    cachedCaseCount: outcome.cachedCaseCount,
    reviewedFileCount: outcome.reviewedFileCount,
    prunedCaseIds: outcome.prunedCaseIds,
    cases: outcome.cases
  }
}
