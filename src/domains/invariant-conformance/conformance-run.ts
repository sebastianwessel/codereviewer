// Composition for one `conformance check` run.
//
// It reuses repository intake and the mediated context retriever and adds nothing
// of its own to either: this domain performs no filesystem access, no git access
// and no provider call, which is what the import-boundary test in this folder
// enforces. The caller supplies two seams — a reader and a directory lister — and
// `conformance check` passes the mediated retriever's, so path containment,
// symlink re-checking, the eligibility gate and redaction all apply to every byte
// this domain sees.
//
// BOTH ARMS spec 24's evaluation requires run through this composition, and which
// one ran is stated in `summary.adjudication.mode`.
//
// With no adjudicator supplied it is the DETERMINISTIC BASELINE ARM: nothing calls
// a model, and a divergence is reported exactly as the fact it is, with no
// judgement about whether the shared pattern is a convention. Step 3 of spec 24's
// evaluation says the model layer must beat listing the divergences and letting a
// human read them, so that list has to be genuinely good and has to stay
// available.
//
// With an adjudicator supplied, the same divergences are filtered by design step
// 4: one call per divergence, and only a `convention` verdict is reported. The
// deterministic core is unchanged either way — the adjudicator cannot add a
// divergence, only remove one — so the two arms are comparable by construction.

import type { CodeReviewerConfig } from '../../shared/contracts/index.js'
import {
  collectRepositoryIntake,
  type DiffMap,
  type GitCommandRunner,
  type RepositoryIntake
} from '../repository-intake/index.js'
import type { LaneUsage } from '../costs/index.js'
import {
  isLanguageTestFile,
  supportedSignalLanguageForPath
} from '../deterministic-signals/index.js'
import { selectSpreadAcrossGroups } from './bounded-selection.js'
import {
  adjudicateDivergences,
  deterministicAdjudicationSummary
} from './adjudicate-divergences.js'
import type { ConformanceAdjudicationRunner } from './conformance-adjudication.js'
import {
  InvariantConformanceReportSchema,
  type ConformanceAdjudicationSummary,
  type ConformanceDivergence,
  type InvariantConformanceReport
} from './conformance-report.js'
import { collectDivergences } from './divergence.js'
import { derivePeerSets, type ConformanceSourceFile } from './peer-sets.js'

export type RunInvariantConformanceInput = {
  readonly repositoryRoot: string
  readonly config: CodeReviewerConfig
  readonly baseRef?: string
  readonly headRef?: string
  readonly generatedAt?: Date
  // Reads a repository file. Supplied by the caller so this domain never opens a
  // file handle.
  readonly readRepositoryFile: (path: string) => Promise<string | undefined>
  // Lists a directory, returning repository-relative paths of its FILE entries
  // only. Same reason: peer derivation needs to know what sits beside a changed
  // file, and it must learn that through the mediated seam.
  readonly listDirectoryFiles: (path: string) => Promise<readonly string[]>
  // Git seam, passed straight through to intake, which owns and validates every
  // git invocation. Present only so a test can drive this composition
  // hermetically; production leaves it unset. This domain never invokes git.
  readonly runGit?: GitCommandRunner
  // The conformance adjudicator (spec 24, design step 4). Absent runs the
  // deterministic baseline arm. A seam rather than a provider resolved in here,
  // because a composition that resolves its own provider cannot be driven
  // hermetically, and every control test for this layer has to be.
  readonly adjudicate?: ConformanceAdjudicationRunner
  // Token usage and cost of the adjudication calls, read ONCE after they finish.
  // Supplied by the same wiring that supplies the adjudicator, which owns the
  // usage recorder and the price table; this composition only places the result in
  // the report so there is exactly one place a report is assembled.
  readonly adjudicationUsage?: () => LaneUsage | undefined
  readonly signal?: AbortSignal
}

const DISABLED_WARNING =
  'Invariant-conformance review is disabled. Set invariantConformance.enabled to true to run it.'

const UNSUPPORTED_LANGUAGE_WARNING =
  'Some changed files are in a language the deterministic signal extractors do not cover; no declarations were seeded from them.'

// The same outcome — changed files, no seeded declarations — with the language
// explanation ruled out.
//
// This exists because the unsupported-language message used to be emitted for
// BOTH cases, on the strength of the outcome alone and without ever checking
// coverage. A real run over four TypeScript files (a fully covered language)
// reported that its files were in an uncovered language, which sends the reader
// to investigate the one thing that is definitely not the cause. A diagnostic
// that names a cause it has not established is worse than one that names none,
// so this message states what was observed and stops there.
const NO_SEEDED_DECLARATIONS_WARNING =
  'Changed files were in covered languages but seeded no declarations to compare; nothing in them was extracted as a declaration.'

const NO_PEERS_WARNING =
  'No changed declaration had a sibling declaration in its own file or directory, so no peer set could be built.'

const NO_ADJUDICATOR_WARNING =
  'Conformance adjudication is enabled but no model adjudicator was available; the deterministic divergences are reported unjudged.'

const excludedTestFilesWarning = (count: number): string =>
  `${count} changed test file(s) were excluded from conformance analysis: a test declaration's siblings are other tests, and what they share is test-harness vocabulary rather than a protective convention of the system under review.`

const directoryOf = (path: string): string => {
  const lastSlash = path.lastIndexOf('/')

  return lastSlash === -1 ? '.' : path.slice(0, lastSlash)
}

// Only files a language adapter recognises can contribute declarations, and the
// extension is the cheapest way to know that before spending a read. Derived from
// the changed file's own extension rather than from a list, so the rule needs no
// per-language table here: a peer of a `.go` declaration is in another `.go` file.
const extensionOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const lastDot = name.lastIndexOf('.')

  return lastDot <= 0 ? '' : name.slice(lastDot)
}

// Whether a file is a test file, by the engine's own predicate.
//
// WHY CONFORMANCE DROPS TEST FILES ENTIRELY — as a seed AND as a peer.
//
// A test function's siblings are other test functions, and what they have in
// common is the vocabulary of the test harness, not a protective convention of the
// system under review. "43 of 60 sibling declarations call `assertNoOutput`; this
// one does not" is factually true and worth nothing to a reviewer: nothing is
// protected by calling an assertion helper, and a test that does not call one is
// asserting something else. The first measurement of this capability on real
// repositories hand-judged every change-attributed divergence it produced and
// found each statement TRUE and NOT ONE of them naming a convention — the majority
// of them were test declarations measured against sibling test declarations,
// diverging on `Set`, `Equal`, `assertNoOutput`, `setUp` and `assert!`.
//
// Tests are also where near-duplicate structure is densest: dozens of functions of
// the same shape in one file. So they do not merely add noise to the report, they
// are the shape that produces the floods — the cases that fired 15 to 28 times all
// fired inside a test file.
//
// The predicate is `isLanguageTestFile`, the same one the impact report splits
// production dependents from test dependents with. A second definition of "test"
// written here would be a second thing to keep true.
const isTestSourceFile = (path: string, content?: string): boolean => {
  const language = supportedSignalLanguageForPath(path)

  if (language === undefined) {
    return false
  }

  return isLanguageTestFile(language, {
    path,
    ...(content === undefined ? {} : { content })
  })
}

const diffMapsByPath = (
  intake: RepositoryIntake
): ReadonlyMap<string, DiffMap> =>
  new Map(intake.diffMaps.map((diffMap) => [diffMap.path, diffMap] as const))

type CollectedFiles = {
  readonly files: readonly ConformanceSourceFile[]
  readonly peerFileCount: number
  readonly peerFilesTruncated: boolean
  readonly unreadableFileCount: number
  // Changed files dropped for being tests. Reported so a change made entirely of
  // tests reads as "excluded on purpose" rather than as an unexplained silence.
  readonly excludedTestFileCount: number
}

/**
 * Reads the changed files and the sibling files that can supply their peers.
 *
 * Test files are excluded on both sides — see `isTestSourceFile` for why. Doing it
 * here rather than inside peer derivation is what makes the exclusion complete: a
 * changed test file never becomes a seed, a sibling test file never becomes a
 * peer, and neither is ever read, so the peer-file budget is spent on files that
 * can carry a convention.
 *
 * Deleted files are deliberately NOT included. Spec 24 keys on declarations the
 * diff adds or modifies; a deleted declaration has no body left to compare and
 * cannot diverge from anything. That is the opposite of change-impact's choice,
 * for the opposite reason — there, a deleted export is the maximal contract
 * change.
 */
const collectFiles = async (
  intake: RepositoryIntake,
  input: RunInvariantConformanceInput
): Promise<CollectedFiles> => {
  const byPath = diffMapsByPath(intake)
  const files: ConformanceSourceFile[] = []
  const seenPaths = new Set<string>()
  const wantedExtensions = new Set<string>()
  const directories = new Set<string>()
  let unreadableFileCount = 0
  let excludedTestFileCount = 0

  for (const changedFile of intake.changedFiles) {
    const diffMap = byPath.get(changedFile.path)

    if (diffMap === undefined) {
      continue
    }

    const content = await input.readRepositoryFile(changedFile.path)

    if (content === undefined) {
      unreadableFileCount += 1
      continue
    }

    // After the read, because one language's test convention is a declaration in
    // the content rather than an affix in the name. A changed file is read either
    // way, so this costs nothing.
    if (isTestSourceFile(changedFile.path, content)) {
      excludedTestFileCount += 1
      // NOT added to `seenPaths`: the path is excluded from the peer candidates
      // below by the same predicate, so leaving it out cannot resurrect it.
      continue
    }

    seenPaths.add(changedFile.path)
    directories.add(directoryOf(changedFile.path))
    wantedExtensions.add(extensionOf(changedFile.path))
    files.push({
      path: changedFile.path,
      content,
      hunks: diffMap.hunks,
      isNewFile: diffMap.changeKind === 'new'
    })
  }

  const maxPeerFiles = input.config.invariantConformance.maxPeerFiles
  const candidatesByDirectory: string[][] = []
  let candidateCount = 0

  // Sorted at both levels so which peers a bounded run reads is reproducible
  // rather than dependent on directory iteration order.
  for (const directory of [...directories].sort()) {
    const entries = (await input.listDirectoryFiles(directory))
      .filter(
        (entry) =>
          !seenPaths.has(entry) &&
          wantedExtensions.has(extensionOf(entry)) &&
          // Path-only here: nothing has been read yet, and spending a slot of the
          // peer budget on a file the name already identifies as a test spends it
          // on noise. The content-aware re-check below catches the rest.
          !isTestSourceFile(entry)
      )
      .sort()

    if (entries.length > 0) {
      candidatesByDirectory.push(entries)
      candidateCount += entries.length
    }
  }

  // Spread across the touched DIRECTORIES rather than taken off the front of one
  // sorted list. A changed file whose directory sorts last would otherwise get no
  // peers at all once the cap binds, so the capability would report "nothing to
  // say" about it having never read a single sibling. Re-sorted afterwards so the
  // read order, and therefore the order peers appear in a set, stays stable.
  const selected = [
    ...selectSpreadAcrossGroups(candidatesByDirectory, maxPeerFiles)
  ].sort()

  let peerFileCount = 0

  for (const candidate of selected) {
    const content = await input.readRepositoryFile(candidate)

    if (content === undefined) {
      unreadableFileCount += 1
      continue
    }

    // The name-based filter above cannot see a test convention that lives in the
    // file's content, so the same predicate runs again now that there is content
    // to read. Not counted as a peer file: it supplies no peers.
    if (isTestSourceFile(candidate, content)) {
      continue
    }

    peerFileCount += 1
    files.push({ path: candidate, content })
  }

  return {
    files,
    peerFileCount,
    peerFilesTruncated: candidateCount > maxPeerFiles,
    unreadableFileCount,
    excludedTestFileCount
  }
}

const disabledReport = (input: {
  readonly baseRef: string
  readonly headRef: string
  readonly generatedAt: Date
}): InvariantConformanceReport =>
  InvariantConformanceReportSchema.parse({
    schemaVersion: '1.0',
    status: 'disabled',
    generatedAt: input.generatedAt.toISOString(),
    scope: {
      baseRef: input.baseRef,
      headRef: input.headRef,
      changedFileCount: 0,
      peerFileCount: 0,
      peerFilesTruncated: false
    },
    summary: {
      changedDeclarationCount: 0,
      changedDeclarationsTruncated: false,
      peerSetCount: 0,
      changeAttributedDivergenceCount: 0,
      preExistingDivergenceCount: 0,
      changeAttributedDivergencesTruncated: false,
      preExistingDivergencesTruncated: false,
      adjudication: deterministicAdjudicationSummary()
    },
    changeAttributedDivergences: [],
    preExistingDivergences: [],
    warnings: [DISABLED_WARNING]
  })

export const runInvariantConformance = async (
  input: RunInvariantConformanceInput
): Promise<InvariantConformanceReport> => {
  const baseRef = input.baseRef ?? input.config.review.baseRef
  const headRef = input.headRef ?? input.config.review.headRef
  const generatedAt = input.generatedAt ?? new Date()

  if (!input.config.invariantConformance.enabled) {
    return disabledReport({ baseRef, headRef, generatedAt })
  }

  const intake = await collectRepositoryIntake({
    repositoryRoot: input.repositoryRoot,
    baseRef,
    headRef,
    includePatterns: input.config.paths.include,
    excludePatterns: input.config.paths.exclude,
    maxFiles: input.config.review.maxFiles,
    maxFileBytes: input.config.review.maxFileBytes,
    ...(input.runGit === undefined ? {} : { runGit: input.runGit }),
    ...(input.signal === undefined ? {} : { signal: input.signal })
  })
  const collected = await collectFiles(intake, input)
  const derived = derivePeerSets({
    files: collected.files,
    maxChangedDeclarations:
      input.config.invariantConformance.maxChangedDeclarations,
    maxPeersPerDeclaration:
      input.config.invariantConformance.maxPeersPerDeclaration
  })
  const divergences = collectDivergences({
    peerSets: derived.peerSets,
    maxDivergences: input.config.invariantConformance.maxDivergences,
    maxPreExistingDivergences:
      input.config.invariantConformance.maxPreExistingDivergences
  })
  const adjudicationConfig = input.config.invariantConformance.adjudication
  // The adjudicated arm runs only when the capability is configured for it AND an
  // adjudicator was actually supplied. Both conditions are load-bearing: a
  // provider that could not be resolved must degrade to the baseline arm rather
  // than fail the run (spec 24, "Failure MUST be recoverable"), and an adjudicator
  // supplied against a configuration that did not ask for one must not spend.
  const adjudicated =
    adjudicationConfig.enabled && input.adjudicate !== undefined
      ? await adjudicateDivergences({
          changeAttributed: divergences.changeAttributed,
          preExisting: divergences.preExisting,
          adjudicationInputsById: divergences.adjudicationInputsById,
          adjudicate: input.adjudicate,
          maxAdjudications: adjudicationConfig.maxAdjudications,
          ...(input.signal === undefined ? {} : { signal: input.signal })
        })
      : undefined
  const reportedChangeAttributed: readonly ConformanceDivergence[] =
    adjudicated?.changeAttributed ?? divergences.changeAttributed
  const reportedPreExisting: readonly ConformanceDivergence[] =
    adjudicated?.preExisting ?? divergences.preExisting
  const adjudicationSummary: ConformanceAdjudicationSummary =
    adjudicated?.summary ?? deterministicAdjudicationSummary()
  const usage =
    adjudicated === undefined ? undefined : input.adjudicationUsage?.()
  const warnings: string[] = []
  const changedFiles = collected.files.filter(
    (file) => file.hunks !== undefined
  )
  const changedFileCount = changedFiles.length

  if (changedFileCount > 0 && derived.changedDeclarationCount === 0) {
    // Which of the two explanations applies is decided by asking the language
    // router, not inferred from the outcome. See the constants above.
    const hasUncoveredChangedFile = changedFiles.some(
      (file) => supportedSignalLanguageForPath(file.path) === undefined
    )

    warnings.push(
      hasUncoveredChangedFile
        ? UNSUPPORTED_LANGUAGE_WARNING
        : NO_SEEDED_DECLARATIONS_WARNING
    )
  }

  if (derived.changedDeclarationCount > 0 && derived.peerSets.length === 0) {
    warnings.push(NO_PEERS_WARNING)
  }

  // Placed after the two "nothing was seeded" messages and before the read
  // failures: it is the explanation for an empty report on a change that touched
  // only tests, where `changedFileCount` is zero and neither message above fires.
  if (collected.excludedTestFileCount > 0) {
    warnings.push(excludedTestFilesWarning(collected.excludedTestFileCount))
  }

  if (collected.unreadableFileCount > 0) {
    warnings.push(
      `${collected.unreadableFileCount} file(s) could not be read for declaration extraction and were skipped.`
    )
  }

  if (adjudicationConfig.enabled && input.adjudicate === undefined) {
    warnings.push(NO_ADJUDICATOR_WARNING)
  }

  // Why the report is short. A filtered divergence leaves no entry behind, so
  // without these lines an empty report reads the same whether the peers agreed
  // with the change, the adjudicator called every pattern incidental, or the bound
  // ran out before it looked. The counts are in the summary either way; these
  // warnings surface the two cases a reader would otherwise have to go looking for.
  if (adjudicationSummary.unadjudicatedCount > 0) {
    warnings.push(
      `${adjudicationSummary.unadjudicatedCount} divergence(s) were not adjudicated because the adjudication bound of ${adjudicationConfig.maxAdjudications} was reached, and are not reported.`
    )
  }

  if (adjudicationSummary.failedCount > 0) {
    warnings.push(
      `${adjudicationSummary.failedCount} adjudication call(s) did not complete; those divergences are not reported.`
    )
  }

  return InvariantConformanceReportSchema.parse({
    schemaVersion: '1.0',
    status: 'completed',
    generatedAt: generatedAt.toISOString(),
    scope: {
      baseRef,
      headRef,
      ...(intake.repositorySnapshot.mergeBaseRef === undefined
        ? {}
        : { mergeBaseRef: intake.repositorySnapshot.mergeBaseRef }),
      changedFileCount,
      peerFileCount: collected.peerFileCount,
      peerFilesTruncated: collected.peerFilesTruncated
    },
    summary: {
      changedDeclarationCount: derived.changedDeclarationCount,
      changedDeclarationsTruncated: derived.changedDeclarationsTruncated,
      peerSetCount: derived.peerSets.length,
      // The counts describe what is REPORTED, so they always match the arrays
      // below. What the adjudicator filtered out is in `adjudication`, where it
      // cannot be mistaken for a divergence.
      changeAttributedDivergenceCount: reportedChangeAttributed.length,
      preExistingDivergenceCount: reportedPreExisting.length,
      changeAttributedDivergencesTruncated:
        divergences.changeAttributedTruncated,
      preExistingDivergencesTruncated: divergences.preExistingTruncated,
      adjudication: adjudicationSummary
    },
    changeAttributedDivergences: reportedChangeAttributed,
    preExistingDivergences: reportedPreExisting,
    warnings,
    ...(usage === undefined ? {} : { usage })
  })
}
