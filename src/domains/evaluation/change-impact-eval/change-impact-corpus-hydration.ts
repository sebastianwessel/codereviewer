import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  countExpectedImpactByReachability,
  parseChangeImpactCorpusManifestJson,
  type ChangeImpactCorpusCase,
  type ImpactReachabilityCounts
} from './change-impact-corpus.schema.js'
import {
  assertCorpusDiffIsUncontaminated,
  hydrateGitCorpus,
  readCorpusManifestText,
  readOptionalText,
  storedDiffOf
} from '../corpus/git-corpus-hydration.js'
import {
  checkoutCorpusCase,
  defaultCorpusGitRunner,
  CORPUS_WORK_TREE_DIRECTORY,
  type CorpusGitCommandRunner
} from '../corpus/git-corpus-plumbing.js'

// Hydration for the change-impact corpus (spec 22 §Evaluation).
//
// The git plumbing, the integrity decision, the hydration loop and the pruning
// rule are shared with spec 17's corpus and are imported rather than
// re-implemented. What does NOT carry over is the ORIENTATION: spec 17 checks out
// the fix's parent and reads the fix backwards, while a change-impact case checks
// out the INTRODUCING commit and reads the change forwards, exactly as it was
// made. Everything below that differs from spec 17 differs because of that one
// fact.

export const defaultChangeImpactManifestPath =
  'eval/corpora/change-impact-dependents/manifest.json'

// Deliberately NOT a sibling of the spec 17 slice root. An eval loads a slice root
// by directory, and these cases answer a different question; a shared parent
// directory is one `--slice-root` typo away from pooling the two corpora, which is
// the measurement error spec 22 exists to prevent.
export const defaultChangeImpactOutputRoot =
  '.codereviewer/eval/change-impact-cases/change-impact-dependents'

export const changeImpactHydrationSource = 'change-impact-forward-checkout-v1'

// FORWARD: base is the parent, head is the introducing commit. That direction is
// required, not stylistic — the new side of the diff must be the tree that was
// checked out, or every expected line range points at bytes the reviewer never
// saw, and the dependents are read at the wrong revision.
//
// `git diff` rather than `git show`, because `show` prints the commit message,
// which for a change like this frequently names the ticket the change implements.
export const gitForwardDiffArgs = (input: {
  readonly parentCommit: string
  readonly introducingCommit: string
  readonly reviewedPaths: readonly string[]
}): readonly string[] => [
  'diff',
  '--no-color',
  '--no-ext-diff',
  '--no-renames',
  input.parentCommit,
  input.introducingCommit,
  '--',
  ...input.reviewedPaths
]

// Every path the diff touches, from its `diff --git a/X b/Y` headers, taken from
// BOTH sides.
//
// `materializeDiffFiles` reports only paths with new-side content, which is the
// right set for spec 17 and the wrong one here: a change that DELETES a file is
// the strongest change-impact case there is — the dependents stop compiling — and
// a deletion has no new side. Reading the headers keeps a pure-deletion change
// reviewable and keeps the undeclared-path guard honest about it.
export const diffHeaderPaths = (diff: string): readonly string[] => {
  const paths = new Set<string>()

  for (const line of diff.split(/\r?\n/u)) {
    const match = /^diff --git a\/(.+) b\/(.+)$/u.exec(line)

    if (match?.[1] !== undefined && match[2] !== undefined) {
      paths.add(match[1])
      paths.add(match[2])
    }
  }

  return [...paths].sort((left, right) => left.localeCompare(right))
}

// The contamination guard for this corpus. The rules live in
// `assertCorpusDiffIsUncontaminated`; what this corpus adds is its own wording.
// The forward orientation removes spec 17's dominant leak — a comment the FIX
// added showing up as a removed line — but not the rule's reason to exist. A
// change that DELETES an explanatory comment still shows the reviewer prose that
// may state the contract it is about to move, and a curator still has to judge
// each one.
export const assertReviewedDiffIsUncontaminated = (input: {
  readonly corpusCase: ChangeImpactCorpusCase
  readonly diff: string
  readonly log?: (message: string) => void
}): void => {
  assertCorpusDiffIsUncontaminated({
    caseLabel: `Change-impact case "${input.corpusCase.id}"`,
    caseId: input.corpusCase.id,
    diff: input.diff,
    disclosureReview: input.corpusCase.removedCommentDisclosureReview,
    unjudgedCommentNote: '',
    ...(input.log === undefined ? {} : { log: input.log })
  })
}

// The hydrated case artefact. Deliberately NOT the eval slice contract: an eval
// slice is scored by the diff reviewer against expectations INSIDE the diff, and
// handing this case set to that scorer would answer the wrong question while
// looking like a result.
export const buildChangeImpactCase = (input: {
  readonly corpusCase: ChangeImpactCorpusCase
  readonly datasetId: string
  readonly diff: string
  readonly changedFiles: readonly string[]
}): Record<string, unknown> => {
  const upstream = `${input.corpusCase.upstreamOwner}/${input.corpusCase.upstreamRepo}`

  return {
    id: input.corpusCase.id,
    dataset: input.datasetId,
    title: input.corpusCase.reviewIntent,
    description: `Full ${upstream} working tree at ${input.corpusCase.introducingCommit}, reviewed as the change that broke a dependent outside the diff. License ${input.corpusCase.license}; split ${input.corpusCase.split}.`,
    sourceUrl: input.corpusCase.repositoryUrl,
    capturedAt: input.corpusCase.capturedAt,
    sourceRepo: upstream,
    upstreamOwner: input.corpusCase.upstreamOwner,
    upstreamRepo: input.corpusCase.upstreamRepo,
    language: input.corpusCase.language,
    split: input.corpusCase.split,
    // Forward: base is the parent, head is the change under review.
    baseSha: input.corpusCase.parentCommit,
    headSha: input.corpusCase.introducingCommit,
    hydratedSource: changeImpactHydrationSource,
    hydratedHeadRepository: upstream,
    hydratedHeadRef: input.corpusCase.introducingCommit,
    diff: input.diff,
    reviewedPaths: [...input.corpusCase.reviewedPaths],
    changedFiles: [...input.changedFiles],
    expectedImpact: input.corpusCase.expectedImpact,
    evidenceOfBreakage: input.corpusCase.evidenceOfBreakage,
    tags: [
      ...new Set([
        ...input.corpusCase.tags,
        'change-impact-corpus',
        'full-checkout',
        'forward-diff',
        input.corpusCase.split
      ])
    ]
  }
}

export type ChangeImpactCaseResult = {
  readonly id: string
  readonly split: string
  readonly state: 'hydrated' | 'repaired' | 'cached'
  readonly reviewedFileCount: number
  readonly expectedImpactCount: number
  readonly diffFingerprint: string
}

export type HydrateChangeImpactCorpusOptions = {
  readonly repositoryRoot: string
  readonly manifestPath?: string
  readonly outputRoot?: string
  readonly caseFilters?: readonly string[]
  readonly force?: boolean
  readonly runGit?: CorpusGitCommandRunner
  readonly log?: (message: string) => void
}

export type HydrateChangeImpactCorpusResult = {
  readonly manifestPath: string
  readonly outputRoot: string
  readonly datasetId: string
  readonly hydratedCaseCount: number
  readonly repairedCaseCount: number
  readonly cachedCaseCount: number
  readonly reviewedFileCount: number
  readonly expectedImpactCount: number
  readonly expectedImpactByReachability: ImpactReachabilityCounts
  readonly prunedCaseIds: readonly string[]
  readonly cases: readonly ChangeImpactCaseResult[]
}

// A stored case carries a copy of the case definition, so editing the manifest
// leaves every existing checkout describing the previous one. Spec 17 records what
// happens without this check: a corpus silently scored against a stale answer key,
// and a baseline that had to be voided.
const storedCaseMatchesDefinition = (input: {
  readonly stored: Record<string, unknown> | undefined
  readonly corpusCase: ChangeImpactCorpusCase
  readonly datasetId: string
}): boolean => {
  const storedDiff = storedDiffOf(input.stored)
  const storedChangedFiles = input.stored?.changedFiles

  if (storedDiff === undefined || !Array.isArray(storedChangedFiles)) {
    return false
  }

  try {
    return (
      JSON.stringify(input.stored) ===
      JSON.stringify(
        buildChangeImpactCase({
          corpusCase: input.corpusCase,
          datasetId: input.datasetId,
          diff: storedDiff,
          changedFiles: storedChangedFiles as readonly string[]
        })
      )
    )
  } catch {
    return false
  }
}

// Every expected dependent must exist in the checkout and must actually have the
// lines the answer key points at. A line range that fell off the end of a file
// would score a real prediction as wrong forever, silently.
const assertExpectedImpactResolves = async (input: {
  readonly corpusCase: ChangeImpactCorpusCase
  readonly workTreeDirectory: string
}): Promise<void> => {
  for (const expected of input.corpusCase.expectedImpact) {
    const filePath = path.join(
      input.workTreeDirectory,
      ...expected.path.split('/')
    )
    const content = await readOptionalText(filePath)

    if (content === undefined) {
      throw new Error(
        `Change-impact case "${input.corpusCase.id}": expected dependent "${expected.path}" does not exist at ${input.corpusCase.introducingCommit}.`
      )
    }

    const lineCount = content.split(/\r?\n/u).length

    const [startLine, endLine] = expected.lineRange

    if (endLine > lineCount) {
      throw new Error(
        `Change-impact case "${input.corpusCase.id}": expected dependent "${expected.path}" has ${lineCount} lines, but the answer key points at ${startLine}-${endLine}.`
      )
    }
  }
}

const hydrateCase = async (input: {
  readonly datasetId: string
  readonly corpusCase: ChangeImpactCorpusCase
  readonly caseDirectory: string
  readonly artifactPath: string
  readonly runGit: CorpusGitCommandRunner
  readonly log?: (message: string) => void
}): Promise<{ readonly reviewedFileCount: number; readonly diff: string }> => {
  const diff = await checkoutCorpusCase({
    caseLabel: `Change-impact case "${input.corpusCase.id}"`,
    caseDirectory: input.caseDirectory,
    repositoryUrl: input.corpusCase.repositoryUrl,
    fetchCommit: input.corpusCase.introducingCommit,
    declaredParentCommit: input.corpusCase.parentCommit,
    // The INTRODUCING commit is the working tree, because that is the state a
    // reviewer of this change would have and the state every expected line range
    // is written against.
    checkoutCommit: input.corpusCase.introducingCommit,
    reviewedDiffArgs: gitForwardDiffArgs({
      parentCommit: input.corpusCase.parentCommit,
      introducingCommit: input.corpusCase.introducingCommit,
      reviewedPaths: input.corpusCase.reviewedPaths
    }),
    runGit: input.runGit
  })
  const changedFiles = diffHeaderPaths(diff)
  const reviewed = new Set(input.corpusCase.reviewedPaths)
  const unexpectedPaths = changedFiles.filter(
    (changed) => !reviewed.has(changed)
  )

  // Q ⊄ P holds on the diff a measurement will actually score, and it holds
  // WITHOUT a third check here: the manifest refuses an expectation that is a
  // reviewed path, and the guard below refuses a diff path that is not one. A
  // reviewed-path set that drifted from upstream — a directory rename, say —
  // therefore surfaces as an undeclared path rather than as a silently swallowed
  // expectation.
  if (unexpectedPaths.length > 0) {
    throw new Error(
      `Change-impact case "${input.corpusCase.id}": reviewed diff touches undeclared path(s) ${unexpectedPaths.join(', ')}. Declare explicit file paths in reviewedPaths.`
    )
  }

  if (changedFiles.length === 0) {
    throw new Error(
      `Change-impact case "${input.corpusCase.id}": reviewed diff is empty. The manifest's reviewed paths do not cover anything the change touches.`
    )
  }

  assertReviewedDiffIsUncontaminated({
    corpusCase: input.corpusCase,
    diff,
    ...(input.log === undefined ? {} : { log: input.log })
  })

  await assertExpectedImpactResolves({
    corpusCase: input.corpusCase,
    workTreeDirectory: path.join(
      input.caseDirectory,
      CORPUS_WORK_TREE_DIRECTORY
    )
  })

  await mkdir(path.dirname(input.artifactPath), { recursive: true })
  await writeFile(
    input.artifactPath,
    `${JSON.stringify(
      buildChangeImpactCase({
        corpusCase: input.corpusCase,
        datasetId: input.datasetId,
        diff,
        changedFiles
      }),
      null,
      2
    )}\n`
  )

  return { reviewedFileCount: changedFiles.length, diff }
}

export const hydrateChangeImpactCorpus = async (
  options: HydrateChangeImpactCorpusOptions
): Promise<HydrateChangeImpactCorpusResult> => {
  const manifestPath = options.manifestPath ?? defaultChangeImpactManifestPath
  const outputRoot = options.outputRoot ?? defaultChangeImpactOutputRoot
  const manifest = parseChangeImpactCorpusManifestJson(
    await readCorpusManifestText(options.repositoryRoot, manifestPath)
  )
  const outcome = await hydrateGitCorpus<
    ChangeImpactCorpusCase,
    ChangeImpactCaseResult
  >({
    repositoryRoot: options.repositoryRoot,
    outputRoot,
    caseFilters: options.caseFilters ?? [],
    force: options.force === true,
    runGit: options.runGit ?? defaultCorpusGitRunner,
    ...(options.log === undefined ? {} : { log: options.log }),
    manifestCases: manifest.cases,
    artifactFileName: 'case.json',
    expectedCheckoutCommit: (corpusCase) => corpusCase.introducingCommit,
    storedArtifactMatchesCase: ({ stored, corpusCase }) =>
      storedCaseMatchesDefinition({
        stored,
        corpusCase,
        datasetId: manifest.datasetId
      }),
    assertDiffIsUncontaminated: assertReviewedDiffIsUncontaminated,
    countReviewedFiles: (diff) => diffHeaderPaths(diff).length,
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
      reviewedFileCount,
      expectedImpactCount: corpusCase.expectedImpact.length,
      diffFingerprint
    }),
    duplicateChangeMessage: ({ ownerCaseId, caseId }) =>
      `Change-impact cases "${ownerCaseId}" and "${caseId}" hydrate the same normalized change; remove the duplicate.`
  })

  return {
    manifestPath,
    outputRoot,
    datasetId: manifest.datasetId,
    hydratedCaseCount: outcome.hydratedCaseCount,
    repairedCaseCount: outcome.repairedCaseCount,
    cachedCaseCount: outcome.cachedCaseCount,
    reviewedFileCount: outcome.reviewedFileCount,
    expectedImpactCount: outcome.selectedCases.reduce(
      (total, corpusCase) => total + corpusCase.expectedImpact.length,
      0
    ),
    expectedImpactByReachability: countExpectedImpactByReachability(
      outcome.selectedCases
    ),
    prunedCaseIds: outcome.prunedCaseIds,
    cases: outcome.cases
  }
}
