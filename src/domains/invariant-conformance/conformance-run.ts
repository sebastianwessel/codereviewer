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
import {
  adjudicateDivergences,
  deterministicAdjudicationSummary
} from './adjudicate-divergences.js'
import type { ConformanceAdjudicationRunner } from './conformance-adjudication.js'
import {
  InvariantConformanceReportSchema,
  type ConformanceAdjudicationSummary,
  type ConformanceDivergence,
  type ConformanceUsage,
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
  readonly adjudicationUsage?: () => ConformanceUsage | undefined
  readonly signal?: AbortSignal
}

const DISABLED_WARNING =
  'Invariant-conformance review is disabled. Set invariantConformance.enabled to true to run it.'

const UNSUPPORTED_LANGUAGE_WARNING =
  'Some changed files are in a language the deterministic signal extractors do not cover; no declarations were seeded from them.'

const NO_PEERS_WARNING =
  'No changed declaration had a sibling declaration in its own file or directory, so no peer set could be built.'

const NO_ADJUDICATOR_WARNING =
  'Conformance adjudication is enabled but no model adjudicator was available; the deterministic divergences are reported unjudged.'

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

const diffMapsByPath = (
  intake: RepositoryIntake
): ReadonlyMap<string, DiffMap> =>
  new Map(intake.diffMaps.map((diffMap) => [diffMap.path, diffMap] as const))

type CollectedFiles = {
  readonly files: readonly ConformanceSourceFile[]
  readonly peerFileCount: number
  readonly peerFilesTruncated: boolean
  readonly unreadableFileCount: number
}

/**
 * Reads the changed files and the sibling files that can supply their peers.
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
  const candidates: string[] = []

  for (const directory of [...directories].sort()) {
    for (const entry of await input.listDirectoryFiles(directory)) {
      if (!seenPaths.has(entry) && wantedExtensions.has(extensionOf(entry))) {
        candidates.push(entry)
      }
    }
  }

  // Sorted before the cap so which peers a bounded run reads is reproducible
  // rather than dependent on directory iteration order.
  candidates.sort()

  let peerFileCount = 0

  for (const candidate of candidates.slice(0, maxPeerFiles)) {
    const content = await input.readRepositoryFile(candidate)

    if (content === undefined) {
      unreadableFileCount += 1
      continue
    }

    peerFileCount += 1
    files.push({ path: candidate, content })
  }

  return {
    files,
    peerFileCount,
    peerFilesTruncated: candidates.length > maxPeerFiles,
    unreadableFileCount
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
  const changedFileCount = collected.files.filter(
    (file) => file.hunks !== undefined
  ).length

  if (changedFileCount > 0 && derived.changedDeclarationCount === 0) {
    warnings.push(UNSUPPORTED_LANGUAGE_WARNING)
  }

  if (derived.changedDeclarationCount > 0 && derived.peerSets.length === 0) {
    warnings.push(NO_PEERS_WARNING)
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
