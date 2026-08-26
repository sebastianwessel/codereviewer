import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  resolveExistingPathInsideRoot,
  resolveWritePathInsideRoot
} from '../../../platform/path-service.js'
import { isFileNotFoundError } from '../../../shared/errors/error-normalizer.js'
import {
  removedProseCommentsIn,
  resolveRemovedCommentDisclosures
} from './real-repo-diff-comment-disclosure.js'
import {
  answerKeyLeakIn,
  selectCorpusCases,
  tokenNormalizedDiffFingerprint,
  type RemovedCommentDisclosureReview
} from './real-repo-corpus.schema.js'
import {
  CORPUS_WORK_TREE_DIRECTORY,
  readHeadCommit,
  type CorpusGitCommandRunner
} from './git-corpus-plumbing.js'

// The hydration LOOP every git-backed corpus runs, and the decisions it makes on
// the way: is a case already hydrated, is its stored artefact still the one the
// manifest describes, is the diff a run will score free of the answer key, and
// what is left over on disk that no case claims.
//
// Spec 17's, spec 22's and spec 23's corpora differ in orientation, artefact
// shape and answer key, not in this sequence. Each corpus supplies those
// differences as a spec object; nobody re-implements the loop.

export const readOptionalText = async (
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

export const readCorpusManifestText = async (
  repositoryRoot: string,
  manifestPath: string
): Promise<string> =>
  readFile(
    await resolveExistingPathInsideRoot(repositoryRoot, manifestPath),
    'utf8'
  )

const readStoredArtifact = async (
  artifactPath: string
): Promise<Record<string, unknown> | undefined> => {
  const text = await readOptionalText(artifactPath)

  if (text === undefined) {
    return undefined
  }

  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    // An unreadable artefact is rebuilt, exactly like a missing one.
    return undefined
  }
}

export const storedDiffOf = (
  stored: Record<string, unknown> | undefined
): string | undefined =>
  typeof stored?.diff === 'string' ? stored.diff : undefined

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

// CONTAMINATION GUARD. Everything the reviewed diff must not contain, checked on
// the diff a run will actually score. It runs for a rebuilt case AND for a reused
// one: a slice hydrated before a rule existed would otherwise be served from
// cache forever, and the disclosure record is not part of the slice, so editing
// it does not invalidate the cache either.
//
// An answer key inside the model's input inflates every recall number the corpus
// ever produces, silently, so each corpus keeps its own wrapper naming its own
// cases and its own reason — but the RULES are one implementation, because a rule
// that only half the corpora enforce is a hole nobody would see.
export const assertCorpusDiffIsUncontaminated = (input: {
  // Message prefix identifying the case in its corpus's own wording, e.g.
  // `Corpus case "x"` or `Change-impact case "x"`.
  readonly caseLabel: string
  readonly caseId: string
  readonly diff: string
  readonly disclosureReview: RemovedCommentDisclosureReview | undefined
  // Corpus-specific clause naming why an unjudged removed comment is dangerous
  // for THIS orientation. Empty where the generic sentence says enough.
  readonly unjudgedCommentNote: string
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
      `${input.caseLabel}: the reviewed diff names the defect, so the answer key is inside the model's input ("${diffLeak}"). Drop the case or choose reviewed paths that exclude the disclosure.`
    )
  }

  // Prose comments are too fuzzy to reject outright, so each one must be judged
  // by a curator and the judgement recorded in the manifest; an unjudged one
  // fails the case rather than scoring against an answer key the model was shown
  // in English.
  const flaggedComments = removedProseCommentsIn(input.diff)
  const acknowledgedComments = input.disclosureReview?.acknowledgedComments ?? []
  const { unresolvedComments, staleAcknowledgements } =
    resolveRemovedCommentDisclosures({ flaggedComments, acknowledgedComments })

  if (unresolvedComments.length > 0) {
    throw new Error(
      `${input.caseLabel}: the reviewed diff removes ${unresolvedComments.length} prose comment(s) no curator has judged${input.unjudgedCommentNote}. Read each one against the case's expectations, then either drop the case or record it under removedCommentDisclosureReview.acknowledgedComments: ${unresolvedComments.map((comment) => `"${comment}"`).join(', ')}.`
    )
  }

  if (staleAcknowledgements.length > 0) {
    throw new Error(
      `${input.caseLabel}: removedCommentDisclosureReview acknowledges comment(s) the reviewed diff no longer removes, so the resolution would blanket-cover whatever appears next. Remove them: ${staleAcknowledgements.map((comment) => `"${comment}"`).join(', ')}.`
    )
  }

  if (flaggedComments.length > 0) {
    input.log?.(
      `${input.caseId}: ${flaggedComments.length} removed prose comment(s) reviewed as non-disclosing on ${input.disclosureReview?.reviewedAt ?? 'an unrecorded date'}`
    )
  }
}

export type GitCorpusCaseState = 'hydrated' | 'repaired' | 'cached'

// What one corpus must say for the shared loop to hydrate it. Everything here is
// a difference between corpora that was measured to matter; anything a corpus
// does NOT vary lives in the loop itself.
export type GitCorpusHydrationSpec<
  TCase extends { readonly id: string },
  TCaseResult
> = {
  readonly repositoryRoot: string
  // Repository-relative root the case directories live under.
  readonly outputRoot: string
  readonly caseFilters: readonly string[]
  readonly force: boolean
  readonly runGit: CorpusGitCommandRunner
  readonly log?: (message: string) => void
  // EVERY case the manifest defines, not the selected subset: pruning asks what
  // is still curated, and a filtered run must not read its filter as the answer.
  readonly manifestCases: readonly TCase[]
  // The stored artefact's filename inside a case directory (`slice.json`,
  // `case.json`).
  readonly artifactFileName: string
  readonly expectedCheckoutCommit: (corpusCase: TCase) => string
  readonly storedArtifactMatchesCase: (input: {
    readonly stored: Record<string, unknown> | undefined
    readonly corpusCase: TCase
  }) => boolean
  readonly assertDiffIsUncontaminated: (input: {
    readonly corpusCase: TCase
    readonly diff: string
    readonly log?: (message: string) => void
  }) => void
  // How many reviewed files a stored diff carries. Deliberately per corpus: spec
  // 17 counts new-side content, spec 22 counts both sides of every header so a
  // pure deletion still counts.
  readonly countReviewedFiles: (diff: string) => number
  readonly hydrateCase: (input: {
    readonly corpusCase: TCase
    readonly caseDirectory: string
    readonly artifactPath: string
    readonly runGit: CorpusGitCommandRunner
    readonly log?: (message: string) => void
  }) => Promise<{
    readonly reviewedFileCount: number
    readonly diff: string
  }>
  readonly buildCaseResult: (input: {
    readonly corpusCase: TCase
    readonly state: GitCorpusCaseState
    readonly reviewedFileCount: number
    readonly diffFingerprint: string
  }) => TCaseResult
  readonly duplicateChangeMessage: (input: {
    readonly ownerCaseId: string
    readonly caseId: string
  }) => string
}

export type GitCorpusHydrationOutcome<
  TCase extends { readonly id: string },
  TCaseResult
> = {
  // The absolute, root-checked output root the cases were written under.
  readonly resolvedOutputRoot: string
  readonly selectedCases: readonly TCase[]
  readonly hydratedCaseCount: number
  readonly repairedCaseCount: number
  readonly cachedCaseCount: number
  readonly reviewedFileCount: number
  readonly prunedCaseIds: readonly string[]
  readonly cases: readonly TCaseResult[]
}

export const hydrateGitCorpus = async <
  TCase extends { readonly id: string },
  TCaseResult
>(
  spec: GitCorpusHydrationSpec<TCase, TCaseResult>
): Promise<GitCorpusHydrationOutcome<TCase, TCaseResult>> => {
  const selectedCases = selectCorpusCases(spec.manifestCases, spec.caseFilters)
  const outputRoot = await resolveWritePathInsideRoot(
    spec.repositoryRoot,
    spec.outputRoot
  )

  // Forcing removes only what this run rebuilds. Clearing the whole root while
  // case filters are in effect would destroy the checkouts of every unselected
  // case, which the run then does not restore — the same reason pruning is
  // skipped for a filtered run.
  if (spec.force) {
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

  const results: TCaseResult[] = []
  // Kept beside the per-corpus results because the dedup check below must read
  // the fingerprint of every case this run produced, and the result objects
  // themselves are the corpus's shape, not this loop's.
  const hydratedFingerprints: {
    readonly caseId: string
    readonly fingerprint: string
  }[] = []
  const fingerprintOwners = new Map<string, string>()
  let hydratedCaseCount = 0
  let repairedCaseCount = 0
  let cachedCaseCount = 0
  let reviewedFileCount = 0

  for (const corpusCase of selectedCases) {
    const caseDirectory = path.join(outputRoot, corpusCase.id)
    const artifactPath = path.join(caseDirectory, spec.artifactFileName)
    const [headCommit, stored] = await Promise.all([
      readHeadCommit({
        runGit: spec.runGit,
        workTreeDirectory: path.join(caseDirectory, CORPUS_WORK_TREE_DIRECTORY)
      }),
      readStoredArtifact(artifactPath)
    ])
    const storedDiff = storedDiffOf(stored)
    const state = resolveCaseHydrationState({
      headCommit,
      expectedCheckoutCommit: spec.expectedCheckoutCommit(corpusCase),
      sliceDiff: storedDiff,
      sliceMatchesCaseDefinition: spec.storedArtifactMatchesCase({
        stored,
        corpusCase
      })
    })

    if (state === 'hydrated' && storedDiff !== undefined) {
      spec.assertDiffIsUncontaminated({
        corpusCase,
        diff: storedDiff,
        ...(spec.log === undefined ? {} : { log: spec.log })
      })

      const reusedFileCount = spec.countReviewedFiles(storedDiff)
      const fingerprint = tokenNormalizedDiffFingerprint(storedDiff)

      cachedCaseCount += 1
      reviewedFileCount += reusedFileCount
      hydratedFingerprints.push({ caseId: corpusCase.id, fingerprint })
      results.push(
        spec.buildCaseResult({
          corpusCase,
          state: 'cached',
          reviewedFileCount: reusedFileCount,
          diffFingerprint: fingerprint
        })
      )
      continue
    }

    // A stale case is repaired by rebuilding it; `checkoutCorpusCase` clears the
    // case directory for every case it builds, so no separate removal is needed
    // here.
    spec.log?.(`${state === 'stale' ? 'Repairing' : 'Hydrating'} ${corpusCase.id}`)

    const hydrated = await spec.hydrateCase({
      corpusCase,
      caseDirectory,
      artifactPath,
      runGit: spec.runGit,
      ...(spec.log === undefined ? {} : { log: spec.log })
    })

    if (state === 'stale') {
      repairedCaseCount += 1
    } else {
      hydratedCaseCount += 1
    }

    const fingerprint = tokenNormalizedDiffFingerprint(hydrated.diff)

    reviewedFileCount += hydrated.reviewedFileCount
    hydratedFingerprints.push({ caseId: corpusCase.id, fingerprint })
    results.push(
      spec.buildCaseResult({
        corpusCase,
        state: state === 'stale' ? 'repaired' : 'hydrated',
        reviewedFileCount: hydrated.reviewedFileCount,
        diffFingerprint: fingerprint
      })
    )
  }

  // Dedup is enforced on the hydrated material, not on a curator's promise: two
  // cases carrying the same normalized change would double-count one defect.
  for (const { caseId, fingerprint } of hydratedFingerprints) {
    const owner = fingerprintOwners.get(fingerprint)

    if (owner !== undefined) {
      throw new Error(spec.duplicateChangeMessage({ ownerCaseId: owner, caseId }))
    }

    fingerprintOwners.set(fingerprint, caseId)
  }

  // Drop checkouts whose case the manifest no longer defines. Only done for a full
  // hydration: with `--case` filters the un-selected cases are legitimately absent
  // from this run and must not be deleted.
  const prunedCaseIds =
    spec.caseFilters.length > 0
      ? []
      : await pruneUnknownCaseDirectories(
          outputRoot,
          new Set(spec.manifestCases.map((corpusCase) => corpusCase.id))
        )

  return {
    resolvedOutputRoot: outputRoot,
    selectedCases,
    hydratedCaseCount,
    repairedCaseCount,
    cachedCaseCount,
    reviewedFileCount,
    prunedCaseIds,
    cases: results
  }
}
