import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  resolveExistingPathInsideRoot,
  resolveWritePathInsideRoot
} from '../../../platform/path-service.js'
import { isFileNotFoundError } from '../../../shared/errors/error-normalizer.js'
import {
  countExpectedImpactByReachability,
  parseChangeImpactCorpusManifestJson,
  type ChangeImpactCorpusCase,
  type ChangeImpactCorpusManifest,
  type ImpactReachabilityCounts
} from './change-impact-corpus.schema.js'
import {
  removedProseCommentsIn,
  resolveRemovedCommentDisclosures
} from '../corpus/real-repo-diff-comment-disclosure.js'
import {
  answerKeyLeakIn,
  selectCorpusCases,
  tokenNormalizedDiffFingerprint
} from '../corpus/real-repo-corpus.schema.js'
import {
  gitDisableAutoCrlfArgs,
  gitFetchArgs,
  gitCheckoutArgs,
  gitInitArgs,
  gitParentOfArgs,
  gitRemoteArgs,
  pruneUnknownCaseDirectories,
  resolveCaseHydrationState,
  type CorpusGitCommandRunner
} from '../corpus/real-repo-corpus-hydration.js'

// Hydration for the change-impact corpus (spec 22 §Evaluation).
//
// The git plumbing, the integrity decision and the pruning rule are spec 17's and
// are imported rather than re-implemented. What does NOT carry over is the
// ORIENTATION: spec 17 checks out the fix's parent and reads the fix backwards,
// while a change-impact case checks out the INTRODUCING commit and reads the
// change forwards, exactly as it was made. Everything below that differs from
// spec 17 differs because of that one fact.

const execFileAsync = promisify(execFile)

export const defaultChangeImpactManifestPath =
  'eval/corpora/change-impact-dependents/manifest.json'

// Deliberately NOT a sibling of the spec 17 slice root. An eval loads a slice root
// by directory, and these cases answer a different question; a shared parent
// directory is one `--slice-root` typo away from pooling the two corpora, which is
// the measurement error spec 22 exists to prevent.
export const defaultChangeImpactOutputRoot =
  '.codereviewer/eval/change-impact-cases/change-impact-dependents'

export const changeImpactHydrationSource = 'change-impact-forward-checkout-v1'

const gitOutputByteCap = 64 * 1024 * 1024

const defaultGitRunner: CorpusGitCommandRunner = async ({ args, cwd }) => {
  const { stdout } = await execFileAsync('git', [...args], {
    cwd,
    maxBuffer: gitOutputByteCap,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  })

  return stdout
}

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

export const assertReviewedDiffIsUncontaminated = (input: {
  readonly corpusCase: ChangeImpactCorpusCase
  readonly diff: string
  readonly log?: (message: string) => void
}): void => {
  const diffLeak = answerKeyLeakIn(input.diff)

  if (diffLeak !== undefined) {
    throw new Error(
      `Change-impact case "${input.corpusCase.id}": the reviewed diff names the defect, so the answer key is inside the model's input ("${diffLeak}"). Drop the case or choose reviewed paths that exclude the disclosure.`
    )
  }

  // The forward orientation removes spec 17's dominant leak — a comment the FIX
  // added showing up as a removed line — but not the rule's reason to exist. A
  // change that DELETES an explanatory comment still shows the reviewer prose that
  // may state the contract it is about to move, and a curator still has to judge
  // each one.
  const flaggedComments = removedProseCommentsIn(input.diff)
  const acknowledgedComments =
    input.corpusCase.removedCommentDisclosureReview?.acknowledgedComments ?? []
  const { unresolvedComments, staleAcknowledgements } =
    resolveRemovedCommentDisclosures({ flaggedComments, acknowledgedComments })

  if (unresolvedComments.length > 0) {
    throw new Error(
      `Change-impact case "${input.corpusCase.id}": the reviewed diff removes ${unresolvedComments.length} prose comment(s) no curator has judged. Read each one against the case's expectations, then either drop the case or record it under removedCommentDisclosureReview.acknowledgedComments: ${unresolvedComments.map((comment) => `"${comment}"`).join(', ')}.`
    )
  }

  if (staleAcknowledgements.length > 0) {
    throw new Error(
      `Change-impact case "${input.corpusCase.id}": removedCommentDisclosureReview acknowledges comment(s) the reviewed diff no longer removes, so the resolution would blanket-cover whatever appears next. Remove them: ${staleAcknowledgements.map((comment) => `"${comment}"`).join(', ')}.`
    )
  }

  if (flaggedComments.length > 0) {
    input.log?.(
      `${input.corpusCase.id}: ${flaggedComments.length} removed prose comment(s) reviewed as non-disclosing on ${input.corpusCase.removedCommentDisclosureReview?.reviewedAt ?? 'an unrecorded date'}`
    )
  }
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

const readStoredCase = async (
  casePath: string
): Promise<Record<string, unknown> | undefined> => {
  const text = await readOptionalText(casePath)

  if (text === undefined) {
    return undefined
  }

  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return undefined
  }
}

const storedDiffOf = (
  stored: Record<string, unknown> | undefined
): string | undefined =>
  typeof stored?.diff === 'string' ? stored.diff : undefined

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

const readHeadCommit = async (input: {
  readonly runGit: CorpusGitCommandRunner
  readonly workTreeDirectory: string
}): Promise<string | undefined> => {
  try {
    return (
      await input.runGit({
        args: ['rev-parse', '--verify', 'HEAD'],
        cwd: input.workTreeDirectory
      })
    ).trim()
  } catch {
    return undefined
  }
}

const checkoutCase = async (input: {
  readonly corpusCase: ChangeImpactCorpusCase
  readonly caseDirectory: string
  readonly runGit: CorpusGitCommandRunner
}): Promise<string> => {
  const workTreeDirectory = path.join(input.caseDirectory, 'repo')
  const gitDirectory = path.join(input.caseDirectory, 'git')

  await rm(input.caseDirectory, { recursive: true, force: true })
  await mkdir(workTreeDirectory, { recursive: true })
  await input.runGit({
    args: gitInitArgs({ gitDirectory, workTreeDirectory }),
    cwd: input.caseDirectory
  })
  await input.runGit({ args: gitDisableAutoCrlfArgs(), cwd: workTreeDirectory })
  await input.runGit({
    args: gitRemoteArgs(input.corpusCase.repositoryUrl),
    cwd: workTreeDirectory
  })
  await input.runGit({
    args: gitFetchArgs({ commit: input.corpusCase.introducingCommit }),
    cwd: workTreeDirectory
  })

  const parentCommit = (
    await input.runGit({
      args: gitParentOfArgs(input.corpusCase.introducingCommit),
      cwd: workTreeDirectory
    })
  ).trim()

  if (parentCommit !== input.corpusCase.parentCommit) {
    throw new Error(
      `Change-impact case "${input.corpusCase.id}": upstream parent of ${input.corpusCase.introducingCommit} is ${parentCommit}, but the manifest declares ${input.corpusCase.parentCommit}.`
    )
  }

  // The INTRODUCING commit is the working tree, because that is the state a
  // reviewer of this change would have and the state every expected line range
  // is written against.
  await input.runGit({
    args: gitCheckoutArgs(input.corpusCase.introducingCommit),
    cwd: workTreeDirectory
  })

  const headCommit = await readHeadCommit({
    runGit: input.runGit,
    workTreeDirectory
  })

  if (headCommit !== input.corpusCase.introducingCommit) {
    throw new Error(
      `Change-impact case "${input.corpusCase.id}": checkout landed on ${headCommit ?? 'an unknown commit'} instead of ${input.corpusCase.introducingCommit}.`
    )
  }

  return input.runGit({
    args: gitForwardDiffArgs({
      parentCommit: input.corpusCase.parentCommit,
      introducingCommit: input.corpusCase.introducingCommit,
      reviewedPaths: input.corpusCase.reviewedPaths
    }),
    cwd: workTreeDirectory
  })
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
  readonly manifest: ChangeImpactCorpusManifest
  readonly corpusCase: ChangeImpactCorpusCase
  readonly caseDirectory: string
  readonly casePath: string
  readonly runGit: CorpusGitCommandRunner
  readonly log?: (message: string) => void
}): Promise<{ readonly reviewedFileCount: number; readonly diff: string }> => {
  const diff = await checkoutCase({
    corpusCase: input.corpusCase,
    caseDirectory: input.caseDirectory,
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
    workTreeDirectory: path.join(input.caseDirectory, 'repo')
  })

  await mkdir(path.dirname(input.casePath), { recursive: true })
  await writeFile(
    input.casePath,
    `${JSON.stringify(
      buildChangeImpactCase({
        corpusCase: input.corpusCase,
        datasetId: input.manifest.datasetId,
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
  const runGit = options.runGit ?? defaultGitRunner
  const manifest = parseChangeImpactCorpusManifestJson(
    await readFile(
      await resolveExistingPathInsideRoot(options.repositoryRoot, manifestPath),
      'utf8'
    )
  )
  const selectedCases = selectCorpusCases(
    manifest.cases,
    options.caseFilters ?? []
  )
  const resolvedOutputRoot = await resolveWritePathInsideRoot(
    options.repositoryRoot,
    outputRoot
  )

  if (options.force === true) {
    await Promise.all(
      selectedCases.map(async (corpusCase) =>
        rm(path.join(resolvedOutputRoot, corpusCase.id), {
          recursive: true,
          force: true
        })
      )
    )
  }

  await mkdir(resolvedOutputRoot, { recursive: true })

  const results: ChangeImpactCaseResult[] = []
  const fingerprintOwners = new Map<string, string>()
  let hydratedCaseCount = 0
  let repairedCaseCount = 0
  let cachedCaseCount = 0
  let reviewedFileCount = 0

  for (const corpusCase of selectedCases) {
    const caseDirectory = path.join(resolvedOutputRoot, corpusCase.id)
    const casePath = path.join(caseDirectory, 'case.json')
    const [headCommit, stored] = await Promise.all([
      readHeadCommit({
        runGit,
        workTreeDirectory: path.join(caseDirectory, 'repo')
      }),
      readStoredCase(casePath)
    ])
    const storedDiff = storedDiffOf(stored)
    const state = resolveCaseHydrationState({
      headCommit,
      expectedCheckoutCommit: corpusCase.introducingCommit,
      sliceDiff: storedDiff,
      sliceMatchesCaseDefinition: storedCaseMatchesDefinition({
        stored,
        corpusCase,
        datasetId: manifest.datasetId
      })
    })

    if (state === 'hydrated' && storedDiff !== undefined) {
      assertReviewedDiffIsUncontaminated({
        corpusCase,
        diff: storedDiff,
        ...(options.log === undefined ? {} : { log: options.log })
      })

      const reusedFileCount = diffHeaderPaths(storedDiff).length

      cachedCaseCount += 1
      reviewedFileCount += reusedFileCount
      results.push({
        id: corpusCase.id,
        split: corpusCase.split,
        state: 'cached',
        reviewedFileCount: reusedFileCount,
        expectedImpactCount: corpusCase.expectedImpact.length,
        diffFingerprint: tokenNormalizedDiffFingerprint(storedDiff)
      })
      continue
    }

    options.log?.(
      `${state === 'stale' ? 'Repairing' : 'Hydrating'} ${corpusCase.id}`
    )

    const hydrated = await hydrateCase({
      manifest,
      corpusCase,
      caseDirectory,
      casePath,
      runGit,
      ...(options.log === undefined ? {} : { log: options.log })
    })

    if (state === 'stale') {
      repairedCaseCount += 1
    } else {
      hydratedCaseCount += 1
    }

    reviewedFileCount += hydrated.reviewedFileCount
    results.push({
      id: corpusCase.id,
      split: corpusCase.split,
      state: state === 'stale' ? 'repaired' : 'hydrated',
      reviewedFileCount: hydrated.reviewedFileCount,
      expectedImpactCount: corpusCase.expectedImpact.length,
      diffFingerprint: tokenNormalizedDiffFingerprint(hydrated.diff)
    })
  }

  for (const result of results) {
    const owner = fingerprintOwners.get(result.diffFingerprint)

    if (owner !== undefined) {
      throw new Error(
        `Change-impact cases "${owner}" and "${result.id}" hydrate the same normalized change; remove the duplicate.`
      )
    }

    fingerprintOwners.set(result.diffFingerprint, result.id)
  }

  const prunedCaseIds =
    (options.caseFilters ?? []).length > 0
      ? []
      : await pruneUnknownCaseDirectories(
          resolvedOutputRoot,
          new Set(manifest.cases.map((corpusCase) => corpusCase.id))
        )

  return {
    manifestPath,
    outputRoot,
    datasetId: manifest.datasetId,
    hydratedCaseCount,
    repairedCaseCount,
    cachedCaseCount,
    reviewedFileCount,
    expectedImpactCount: selectedCases.reduce(
      (total, corpusCase) => total + corpusCase.expectedImpact.length,
      0
    ),
    expectedImpactByReachability:
      countExpectedImpactByReachability(selectedCases),
    prunedCaseIds,
    cases: results
  }
}
