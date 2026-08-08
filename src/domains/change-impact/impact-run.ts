// Composition for one `impact check` run.
//
// It reuses repository intake and the mediated context retriever and adds nothing
// of its own to either: this domain performs no filesystem access and no git
// access, which is what the import-boundary test in this folder enforces. The one
// provider call it can make arrives as a SEAM the caller supplies, so this
// composition is drivable hermetically and cannot resolve a provider of its own.
//
// The shape is deterministic-first throughout: intake, symbols, contract delta and
// discovery all run before anything is adjudicated, and adjudication itself settles
// every structural case in code before spending a call on the residue. See
// `adjudication.ts` for why that line is drawn where it is.

import type { CodeReviewerConfig } from '../../shared/contracts/index.js'
import type { LaneUsage } from '../costs/index.js'
import {
  collectRepositoryIntake,
  type DiffMap,
  type GitCommandRunner,
  type RepositoryIntake
} from '../repository-intake/index.js'
import {
  collectAdjudicationPairs,
  runAdjudication,
  type AdjudicationOutcome
} from './adjudication.js'
import {
  collectChangedSymbols,
  type ChangedSymbolSourceFile
} from './changed-symbols.js'
import { collectContractChanges } from './contract-changes.js'
import type { ContractChange } from './contract-delta.js'
import { discoverDependents } from './dependent-discovery.js'
import { admitImpactFinding } from './impact-admission.js'
import { groupImpactedFiles, type GroupedImpact } from './impacted-files.js'
import {
  ChangeImpactReferenceReportSchema,
  impactedSymbolKey,
  type AdjudicationStatus,
  type ChangeImpactReferenceReport,
  type ImpactedFile,
  type ImpactFinding,
  type ModelVerdictCounts
} from './impact-report.js'
import {
  NO_RELIANCE_VERDICTS,
  type RelianceJudgementRunner
} from './reliance-judgement.js'

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
  // The adjudication model seam. Absent runs no call at all: the deterministic
  // tier still produces its findings and everything that needed a model is
  // counted as unadjudicated, never reported as a maybe. A seam rather than a
  // provider resolved in here, because a composition that resolves its own
  // provider cannot be driven hermetically, and every control test for this layer
  // has to be.
  readonly agents?: ChangeImpactAgents
  // Token usage and cost, read ONCE after the calls finish. Supplied by the same
  // wiring that supplies the agents, which owns the usage recorder and the price
  // table.
  readonly usage?: () => LaneUsage | undefined
  // Git seam, passed straight through to intake, which owns and validates every
  // git invocation. Present only so a test can drive this composition
  // hermetically; production leaves it unset and intake uses its own read-only
  // runner. This domain never invokes git itself.
  readonly runGit?: GitCommandRunner
  readonly signal?: AbortSignal
}

export type ChangeImpactAgents = {
  readonly judgeReliance: RelianceJudgementRunner
}

// Deliberately states what was observed, not a cause.
//
// The previous wording asserted "a language the extractors do not cover" whenever
// zero symbols were seeded, whatever the actual reason. That is a diagnostic naming
// a cause it never checked, and it sent a real investigation down the wrong path:
// Ruby and TypeScript files — both fully covered — reported themselves unsupported
// when the true cause was that no changed line fell inside any symbol's span.
const NO_SYMBOLS_SEEDED_WARNING =
  'No changed symbols were seeded from the changed files. Either the files are in a language the deterministic signal extractors do not cover, or none of the changed lines fall inside a symbol this engine can name.'

// The other way to reach zero reference files, and it calls for the opposite work.
//
// A run that seeds symbols and finds nothing referencing them has done its job: the
// dependent may be reached by a relation no name-based search can follow (an
// attribute owner, a dynamic dispatch), which spec 22 documents as this lane's
// reachability ceiling. A run that seeds NOTHING has not looked at all.
//
// Both end at `referenceCount: 0`, so without this line a reader — and this
// project's own ledger, which recorded three corpus cases as seeding defects when
// two of them were correctly seeded and structurally unreachable — cannot tell a
// limit from a defect.
const NO_REFERENCES_FOUND_WARNING =
  'Changed symbols were seeded, but the search found no reference to any of them. This is a limit of name-based search, not a failure to seed: a dependent linked by a relation no textual search can follow is invisible here. It is NOT evidence that nothing depends on the change.'

// Skip reasons that mean a changed file's head side was NOT seen. `deleted` and
// `excluded` are absent on purpose: a deleted file has no head side to miss, and
// an excluded one is a deliberate scope decision rather than a failure to look.
// Everything here is a file the change wrote and this run could not read, which
// is exactly when "no replacement declaration exists" stops being provable.
const OPAQUE_SKIP_REASONS: ReadonlySet<string> = new Set([
  'binary',
  'too-large',
  'too-many-files',
  'unsupported',
  'error'
])

// Why the head side of this change is incomplete, or undefined when it is whole.
//
// This is the input that stops an unpaired removal from being reported as a
// confident deletion when the file holding its replacement was never read. The
// codebase has a documented defect class where a missing input yields the
// optimistic answer instead of an error; a removal is the severe direction here,
// so the answer is not optimistic — but it is still a confident claim made
// without the evidence, and the reader is told which one they are looking at.
const additionsIncompleteReason = (
  intake: RepositoryIntake,
  unreadableFileCount: number
): string | undefined => {
  const opaque = intake.skippedFiles.filter((file) =>
    OPAQUE_SKIP_REASONS.has(file.reason)
  ).length
  const unseen = opaque + unreadableFileCount

  return unseen === 0
    ? undefined
    : `${unseen} changed file(s) could not be read, so the declarations this change adds were not all searched.`
}

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

  // Every read is independent of every other, so they are issued together and
  // folded back IN FILE ORDER below. The fold, not the issue order, is what fixes
  // `files` and `unreadableFileCount`, so the result is identical to reading them
  // one at a time.
  const reads = await Promise.all(
    intake.changedFiles.map(async (changedFile) => {
      const diffMap = byPath.get(changedFile.path)

      if (diffMap === undefined) {
        return undefined
      }

      return {
        path: changedFile.path,
        diffMap,
        content: await readChangedFile(changedFile.path)
      }
    })
  )

  for (const read of reads) {
    if (read === undefined) {
      continue
    }

    if (read.content === undefined) {
      unreadableFileCount += 1
      continue
    }

    files.push({
      path: read.path,
      content: read.content,
      changeKind: read.diffMap.changeKind,
      hunks: read.diffMap.hunks
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
    schemaVersion: '3.0',
    status: 'disabled',
    adjudicationStatus: 'disabled',
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
      impactedFileCount: 0,
      impactedTestFileCount: 0,
      referenceCount: 0,
      testReferenceCount: 0,
      nonSourceReferenceCount: 0,
      impactFindingCount: 0,
      reliedUponPairCount: 0,
      deterministicNoImpactPairCount: 0,
      unadjudicatedPairCount: 0,
      adjudicationCallCount: 0,
      failedAdjudicationCallCount: 0,
      modelVerdictCounts: NO_RELIANCE_VERDICTS,
      adjudicationCallsTruncated: false,
      rejectedFindingCount: 0
    },
    changedSymbols: [],
    impactFindings: [],
    impactedFiles: [],
    impactedTestFiles: [],
    warnings: [
      'Change-impact review is disabled. Set changeImpact.enabled to true to run it.'
    ]
  })

// Keeps `usage` absent rather than `undefined` when the run made no call, so a
// report never carries an all-zero usage block that reads as "a provider ran and
// cost nothing". The deterministic path is free and says so by omission.
const withUsage = (
  usage: LaneUsage | undefined
): { readonly usage?: LaneUsage } => (usage === undefined ? {} : { usage })

const siteCount = (files: readonly ImpactedFile[]): number =>
  files.reduce(
    (total, file) =>
      total +
      file.symbols.reduce(
        (fileTotal, symbol) => fileTotal + symbol.sites.length,
        0
      ),
    0
  )

// Every count here is derived from the two lists it summarises, so a summary can
// never disagree with the report it heads.
const summarize = (
  grouped: GroupedImpact
): {
  readonly referencedSymbolCount: number
  readonly impactedFileCount: number
  readonly impactedTestFileCount: number
  readonly referenceCount: number
  readonly testReferenceCount: number
  readonly nonSourceReferenceCount: number
} => {
  // A symbol counts as referenced when something LISTED refers to it. Counting a
  // symbol whose only matches were prose would restate the noise the destination
  // filter exists to remove.
  const referencedSymbols = new Set(
    [...grouped.impactedFiles, ...grouped.impactedTestFiles].flatMap((file) =>
      file.symbols.map((symbol) => impactedSymbolKey(symbol))
    )
  )

  return {
    referencedSymbolCount: referencedSymbols.size,
    impactedFileCount: grouped.impactedFiles.length,
    impactedTestFileCount: grouped.impactedTestFiles.length,
    referenceCount: siteCount(grouped.impactedFiles),
    testReferenceCount: siteCount(grouped.impactedTestFiles),
    nonSourceReferenceCount: grouped.changedSymbols.reduce(
      (total, symbol) => total + symbol.referencesInNonSourceFiles,
      0
    )
  }
}

const ADJUDICATION_DISABLED_WARNING =
  'Change-impact adjudication is disabled, so no dependent was checked against the part of the contract that changed. The lists below are references, not findings. Set changeImpact.adjudication.enabled to true to run it.'

const NO_ADJUDICATION_MODEL_WARNING =
  'No model was available for change-impact adjudication, so only the dependents that need none were checked. Everything else is counted as unadjudicated and is reported nowhere as a finding.'

type AdjudicationResult = {
  readonly status: AdjudicationStatus
  readonly findings: readonly ImpactFinding[]
  readonly counts: AdjudicationOutcome
  readonly rejectedFindingCount: number
  readonly warnings: readonly string[]
}

const NOTHING_ADJUDICATED: AdjudicationOutcome = {
  candidates: [],
  reliedUponPairCount: 0,
  deterministicNoImpactPairCount: 0,
  unadjudicatedPairCount: 0,
  callsTruncated: false,
  failedCallCount: 0,
  modelCallCount: 0,
  modelVerdictCounts: NO_RELIANCE_VERDICTS
}

// Adjudicates, then GATES. The two are deliberately separate calls rather than one
// step: `adjudication.ts` decides what it believes, and `admitImpactFinding`
// decides what may be said out loud. Spec 22's "a finding without a named
// dependent MUST be rejected" cannot be enforced honestly by the module that would
// be producing the bad finding.
const adjudicate = async (input: {
  readonly config: CodeReviewerConfig
  readonly grouped: GroupedImpact
  readonly contractChanges: ReadonlyMap<string, readonly ContractChange[]>
  readonly agents?: ChangeImpactAgents
  readonly signal?: AbortSignal
}): Promise<AdjudicationResult> => {
  const { adjudication } = input.config.changeImpact

  if (!adjudication.enabled) {
    return {
      status: 'disabled',
      findings: [],
      counts: NOTHING_ADJUDICATED,
      rejectedFindingCount: 0,
      warnings: [ADJUDICATION_DISABLED_WARNING]
    }
  }

  const outcome = await runAdjudication({
    pairs: collectAdjudicationPairs({
      impactedFiles: input.grouped.impactedFiles,
      impactedTestFiles: input.grouped.impactedTestFiles,
      changedSymbols: input.grouped.changedSymbols
    }),
    contractChanges: input.contractChanges,
    maxCalls: adjudication.maxCalls,
    ...(input.agents === undefined
      ? {}
      : { judge: input.agents.judgeReliance }),
    ...(input.signal === undefined ? {} : { signal: input.signal })
  })
  const findings: ImpactFinding[] = []
  let rejectedFindingCount = 0

  for (const candidate of outcome.candidates) {
    const admitted = admitImpactFinding({
      candidate,
      policy: {
        impactedFiles: input.grouped.impactedFiles,
        impactedTestFiles: input.grouped.impactedTestFiles,
        admittedFindings: findings
      }
    })

    if (admitted.status === 'admitted') {
      findings.push(admitted.finding)
    } else {
      rejectedFindingCount += 1
    }
  }

  const warnings: string[] = []

  if (input.agents === undefined) {
    warnings.push(NO_ADJUDICATION_MODEL_WARNING)
  }

  if (outcome.failedCallCount > 0) {
    warnings.push(
      `${outcome.failedCallCount} adjudication call(s) did not complete; those dependents are counted as unadjudicated and are not reported as findings.`
    )
  }

  if (outcome.callsTruncated) {
    warnings.push(
      `The adjudication call cap (changeImpact.adjudication.maxCalls = ${adjudication.maxCalls}) was reached, so some dependents were never checked. They are counted as unadjudicated.`
    )
  }

  if (rejectedFindingCount > 0) {
    warnings.push(
      `${rejectedFindingCount} adjudicated dependent(s) did not pass the impact admission gate and were not reported.`
    )
  }

  return {
    // `no-model` even when the residue happened to be empty. The status describes
    // what this run was EQUIPPED to do, not what it happened to encounter: a
    // reader deciding whether an empty finding list is an answer needs to know
    // whether the model tier could have run at all.
    status: input.agents === undefined ? 'no-model' : 'completed',
    findings,
    counts: outcome,
    rejectedFindingCount,
    warnings
  }
}

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
  const incompleteReason = additionsIncompleteReason(
    intake,
    unreadableFileCount
  )
  const changed = collectChangedSymbols({
    files,
    maxChangedSymbols: input.config.changeImpact.maxChangedSymbols,
    // Pairing a removal against the declarations this change adds needs to know
    // whether it saw them all. Spec 22 requires the pairing to run before a
    // removal is reported; this is what keeps its answer honest when it could not.
    ...(incompleteReason === undefined
      ? {}
      : { additionsIncompleteReason: incompleteReason })
  })
  // Derived from the diff text intake already fetched, not from a second
  // checkout of the base revision: reconstructing and re-parsing the base tree
  // would cost a full extra parse of every changed file to answer a question the
  // diff already contains.
  const contractChanges = collectContractChanges({
    changedSymbols: changed.symbols,
    rawDiff: intake.rawDiff
  })
  const dependents = await discoverDependents({
    repositoryRoot: input.repositoryRoot,
    changedSymbols: changed.symbols,
    maxReferencesPerSymbol: input.config.changeImpact.maxReferencesPerSymbol,
    maxReferenceCandidatesPerSymbol:
      input.config.changeImpact.maxReferenceCandidatesPerSymbol,
    maxSearchDepth: input.config.changeImpact.maxSearchDepth,
    paths: {
      include: input.config.paths.include,
      exclude: input.config.paths.exclude
    }
  })
  // The search runs per symbol; the report is read per file. Spec 22 requires the
  // second, on measured grounds, and this is where the one becomes the other.
  const grouped = groupImpactedFiles({ dependents, contractChanges })
  // Design step 3. Everything above it is deterministic and free; this is the only
  // place a provider can be reached, and it is reached for the residue only.
  const adjudicated = await adjudicate({
    config: input.config,
    grouped,
    contractChanges,
    ...(input.agents === undefined ? {} : { agents: input.agents }),
    ...(input.signal === undefined ? {} : { signal: input.signal })
  })
  const warnings: string[] = []

  if (files.length > 0 && changed.symbols.length === 0) {
    warnings.push(NO_SYMBOLS_SEEDED_WARNING)
  } else if (changed.symbols.length > 0 && siteCount(grouped.impactedFiles) === 0) {
    warnings.push(NO_REFERENCES_FOUND_WARNING)
  }

  if (unreadableFileCount > 0) {
    warnings.push(
      `${unreadableFileCount} changed file(s) could not be read for symbol extraction and were skipped.`
    )
  }

  warnings.push(...adjudicated.warnings)

  return ChangeImpactReferenceReportSchema.parse({
    schemaVersion: '3.0',
    status: 'completed',
    adjudicationStatus: adjudicated.status,
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
      ...summarize(grouped),
      impactFindingCount: adjudicated.findings.length,
      reliedUponPairCount: adjudicated.counts.reliedUponPairCount,
      deterministicNoImpactPairCount:
        adjudicated.counts.deterministicNoImpactPairCount,
      unadjudicatedPairCount: adjudicated.counts.unadjudicatedPairCount,
      adjudicationCallCount: adjudicated.counts.modelCallCount,
      failedAdjudicationCallCount: adjudicated.counts.failedCallCount,
      // Typed on the way through, so renaming a verdict in the model seam's
      // vocabulary breaks the compile here rather than the report's schema at
      // runtime.
      modelVerdictCounts: adjudicated.counts
        .modelVerdictCounts satisfies ModelVerdictCounts,
      adjudicationCallsTruncated: adjudicated.counts.callsTruncated,
      rejectedFindingCount: adjudicated.rejectedFindingCount
    },
    changedSymbols: grouped.changedSymbols,
    impactFindings: adjudicated.findings,
    impactedFiles: grouped.impactedFiles,
    impactedTestFiles: grouped.impactedTestFiles,
    warnings,
    ...withUsage(input.usage?.())
  })
}
