// Composition for one `impact check` run.
//
// It reuses repository intake and the mediated context retriever and adds
// nothing of its own to either: this domain performs no filesystem access, no
// git access, and no provider call, which is what the import-boundary test in
// this folder enforces.

import type { CodeReviewerConfig } from '../../shared/contracts/index.js'
import {
  collectRepositoryIntake,
  type DiffMap,
  type GitCommandRunner,
  type RepositoryIntake
} from '../repository-intake/index.js'
import {
  collectChangedSymbols,
  type ChangedSymbolSourceFile
} from './changed-symbols.js'
import { discoverDependents } from './dependent-discovery.js'
import {
  ChangeImpactReferenceReportSchema,
  type ChangeImpactReferenceReport,
  type ChangedSymbolReferences
} from './impact-report.js'

export type RunChangeImpactInput = {
  readonly repositoryRoot: string
  readonly config: CodeReviewerConfig
  readonly baseRef?: string
  readonly headRef?: string
  readonly generatedAt?: Date
  // Reads the head-side content of a changed file. Supplied by the caller so this
  // domain never opens a file handle; `impact check` passes the mediated
  // context retriever's read.
  readonly readChangedFile: (path: string) => Promise<string | undefined>
  // Git seam, passed straight through to intake, which owns and validates every
  // git invocation. Present only so a test can drive this composition
  // hermetically; production leaves it unset and intake uses its own read-only
  // runner. This domain never invokes git itself.
  readonly runGit?: GitCommandRunner
  readonly signal?: AbortSignal
}

const UNSUPPORTED_LANGUAGE_WARNING =
  'Some changed files are in a language the deterministic signal extractors do not cover; no symbols were seeded from them.'

const diffMapsByPath = (
  intake: RepositoryIntake
): ReadonlyMap<string, DiffMap> =>
  new Map(intake.diffMaps.map((diffMap) => [diffMap.path, diffMap] as const))

// Builds the per-file input for symbol extraction. Modified and added files are
// read from the working tree through the caller's mediated reader; deleted files
// carry the pre-change content intake reconstructed from the deletion hunk,
// because there is nothing left on disk to read.
const collectSourceFiles = async (
  intake: RepositoryIntake,
  readChangedFile: RunChangeImpactInput['readChangedFile']
): Promise<{
  readonly files: readonly ChangedSymbolSourceFile[]
  readonly unreadableFileCount: number
}> => {
  const byPath = diffMapsByPath(intake)
  const files: ChangedSymbolSourceFile[] = []
  let unreadableFileCount = 0

  for (const changedFile of intake.changedFiles) {
    const diffMap = byPath.get(changedFile.path)

    if (diffMap === undefined) {
      continue
    }

    const content = await readChangedFile(changedFile.path)

    if (content === undefined) {
      unreadableFileCount += 1
      continue
    }

    files.push({
      path: changedFile.path,
      content,
      changeKind: diffMap.changeKind,
      hunks: diffMap.hunks
    })
  }

  for (const deletedFile of intake.deletedFiles) {
    files.push({
      path: deletedFile.path,
      content: deletedFile.content,
      changeKind: 'deleted',
      // A deleted file has no surviving lines to intersect, so every symbol it
      // declared counts as changed and the hunks are not consulted.
      hunks: []
    })
  }

  return { files, unreadableFileCount }
}

const disabledReport = (input: {
  readonly baseRef: string
  readonly headRef: string
  readonly generatedAt: Date
}): ChangeImpactReferenceReport =>
  ChangeImpactReferenceReportSchema.parse({
    schemaVersion: '1.1',
    status: 'disabled',
    generatedAt: input.generatedAt.toISOString(),
    scope: {
      baseRef: input.baseRef,
      headRef: input.headRef,
      changedFileCount: 0,
      deletedFileCount: 0
    },
    summary: {
      changedSymbolCount: 0,
      changedSymbolsTruncated: false,
      referencedSymbolCount: 0,
      referenceCount: 0,
      testReferenceCount: 0,
      nonSourceReferenceCount: 0
    },
    symbols: [],
    warnings: [
      'Change-impact review is disabled. Set changeImpact.enabled to true to run it.'
    ]
  })

const sumOver = (
  symbols: readonly ChangedSymbolReferences[],
  select: (symbol: ChangedSymbolReferences) => number
): number => symbols.reduce((total, symbol) => total + select(symbol), 0)

const summarize = (
  symbols: readonly ChangedSymbolReferences[]
): {
  readonly referencedSymbolCount: number
  readonly referenceCount: number
  readonly testReferenceCount: number
  readonly nonSourceReferenceCount: number
} => ({
  // A symbol counts as referenced when something LISTED refers to it. Counting a
  // symbol whose only matches were prose would restate the noise this filter
  // exists to remove.
  referencedSymbolCount: symbols.filter(
    (symbol) =>
      symbol.references.length > 0 || symbol.testReferences.length > 0
  ).length,
  referenceCount: sumOver(symbols, (symbol) => symbol.references.length),
  testReferenceCount: sumOver(
    symbols,
    (symbol) => symbol.testReferences.length
  ),
  nonSourceReferenceCount: sumOver(
    symbols,
    (symbol) => symbol.referencesInNonSourceFiles
  )
})

export const runChangeImpact = async (
  input: RunChangeImpactInput
): Promise<ChangeImpactReferenceReport> => {
  const baseRef = input.baseRef ?? input.config.review.baseRef
  const headRef = input.headRef ?? input.config.review.headRef
  const generatedAt = input.generatedAt ?? new Date()

  if (!input.config.changeImpact.enabled) {
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
    // The point of the opt-in: a deleted exported symbol is the maximal contract
    // change, and without this it would be invisible here.
    includeDeletedPaths: true,
    ...(input.runGit === undefined ? {} : { runGit: input.runGit }),
    ...(input.signal === undefined ? {} : { signal: input.signal })
  })
  const { files, unreadableFileCount } = await collectSourceFiles(
    intake,
    input.readChangedFile
  )
  const changed = collectChangedSymbols({
    files,
    maxChangedSymbols: input.config.changeImpact.maxChangedSymbols
  })
  const symbols = await discoverDependents({
    repositoryRoot: input.repositoryRoot,
    changedSymbols: changed.symbols,
    maxReferencesPerSymbol: input.config.changeImpact.maxReferencesPerSymbol,
    maxSearchDepth: input.config.changeImpact.maxSearchDepth,
    paths: {
      include: input.config.paths.include,
      exclude: input.config.paths.exclude
    }
  })
  const warnings: string[] = []

  if (files.length > 0 && changed.symbols.length === 0) {
    warnings.push(UNSUPPORTED_LANGUAGE_WARNING)
  }

  if (unreadableFileCount > 0) {
    warnings.push(
      `${unreadableFileCount} changed file(s) could not be read for symbol extraction and were skipped.`
    )
  }

  return ChangeImpactReferenceReportSchema.parse({
    schemaVersion: '1.1',
    status: 'completed',
    generatedAt: generatedAt.toISOString(),
    scope: {
      baseRef,
      headRef,
      ...(intake.repositorySnapshot.mergeBaseRef === undefined
        ? {}
        : { mergeBaseRef: intake.repositorySnapshot.mergeBaseRef }),
      changedFileCount: intake.changedFiles.length,
      deletedFileCount: intake.deletedFiles.length
    },
    summary: {
      changedSymbolCount: changed.symbols.length,
      changedSymbolsTruncated: changed.truncated,
      ...summarize(symbols)
    },
    symbols,
    warnings
  })
}
