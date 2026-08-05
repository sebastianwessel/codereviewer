// Regrouping the search's per-symbol results into the report's per-FILE shape.
//
// WHY THE REPORT IS FILE-GRANULAR. Spec 22's prior-art section records the one
// measured, free precision win available to this capability: scoring the
// IDENTICAL predictions at file granularity rather than at method granularity
// moved precision 28.2% -> 60.9% and F1 25.0 -> 54.6. Nothing about the search
// changes; only what a unit of the answer is. A reviewer opens files, and three
// sites in one file is one thing to look at rather than three.
//
// Discovery searches per symbol because that is what it queries for. This module
// is the seam between that and what a reader works through, and it is deliberately
// pure: symbols and sites in, report records out, no filesystem and no clock.

import type { ChangedSymbol } from './changed-symbols.js'
import { changedSymbolKey } from './contract-changes.js'
import type { ContractChange } from './contract-delta.js'
import type {
  DiscoveredReferenceSite,
  SymbolDependents
} from './dependent-discovery.js'
import type {
  ChangedSymbolReport,
  ImpactedFile,
  ImpactedFileSymbol,
  ReferenceSite
} from './impact-report.js'

export type GroupImpactedFilesInput = {
  readonly dependents: readonly SymbolDependents[]
  // What changed about each symbol's contract, keyed by `changedSymbolKey`.
  //
  // A symbol absent from the map reports no contract change, which is the same
  // statement as an empty list and never means "safe".
  readonly contractChanges?: ReadonlyMap<string, readonly ContractChange[]>
}

export type GroupedImpact = {
  readonly changedSymbols: readonly ChangedSymbolReport[]
  readonly impactedFiles: readonly ImpactedFile[]
  readonly impactedTestFiles: readonly ImpactedFile[]
}

type PendingFile = {
  readonly path: string
  // Keyed by `changedSymbolKey`, so two same-named symbols defined in different
  // files stay distinct inside one destination.
  readonly symbols: Map<string, { readonly symbol: ChangedSymbol; readonly sites: ReferenceSite[] }>
}

const toReferenceSite = (site: DiscoveredReferenceSite): ReferenceSite => ({
  line: site.line,
  text: site.text
})

const toImpactedFileSymbol = (input: {
  readonly symbol: ChangedSymbol
  readonly sites: readonly ReferenceSite[]
}): ImpactedFileSymbol => ({
  name: input.symbol.name,
  definitionPath: input.symbol.path,
  definitionLine: input.symbol.line,
  // Line order inside a file: a reader works down a file, and the search's own
  // order carries no meaning once the sites sit under the file they are in.
  sites: [...input.sites].sort((left, right) => left.line - right.line)
})

// Groups one bucket of sites by the file they landed in, preserving the order
// files were first seen. That order is not arbitrary: discovery has already
// ranked sites so that files this change ALSO touched come first, and re-sorting
// here — alphabetically, by site count — would silently discard the only
// relevance signal the engine has.
const groupSites = (
  buckets: readonly {
    readonly symbol: ChangedSymbol
    readonly sites: readonly DiscoveredReferenceSite[]
  }[],
  changedPaths: ReadonlySet<string>
): readonly ImpactedFile[] => {
  const byPath = new Map<string, PendingFile>()

  for (const bucket of buckets) {
    for (const site of bucket.sites) {
      const file = byPath.get(site.path) ?? {
        path: site.path,
        symbols: new Map()
      }

      byPath.set(site.path, file)

      const key = changedSymbolKey(bucket.symbol)
      const entry = file.symbols.get(key) ?? { symbol: bucket.symbol, sites: [] }

      file.symbols.set(key, entry)
      entry.sites.push(toReferenceSite(site))
    }
  }

  const files = [...byPath.values()]
  // The file-level form of discovery's ranking: a destination this change also
  // touched moved alongside the symbol it depends on, which is where a contract
  // mismatch is most likely to have been introduced and least likely to have been
  // noticed. Stable within each group, so first-seen order still decides the rest.
  const alsoChanged = files.filter((file) => changedPaths.has(file.path))
  const rest = files.filter((file) => !changedPaths.has(file.path))

  return [...alsoChanged, ...rest].map((file) => ({
    path: file.path,
    symbols: [...file.symbols.values()].map(toImpactedFileSymbol)
  }))
}

const toChangedSymbolReport = (
  dependents: SymbolDependents,
  contractChanges: ReadonlyMap<string, readonly ContractChange[]> | undefined
): ChangedSymbolReport => {
  const { symbol } = dependents

  return {
    name: symbol.name,
    kind: symbol.kind,
    language: symbol.language,
    definitionPath: symbol.path,
    definitionLine: symbol.line,
    changeKind: symbol.changeKind,
    ...(symbol.removalPairing === undefined
      ? {}
      : { removalPairing: symbol.removalPairing }),
    // The report carries the STATEMENT only. The structured dimension stays
    // internal, where adjudication branches on it: publishing it would invite a
    // consumer to build policy on an id this engine reserves the right to change,
    // and the sentence is what a reader needs.
    contractChanges: (contractChanges?.get(changedSymbolKey(symbol)) ?? []).map(
      (change) => change.statement
    ),
    referencesInDefinitionFile: dependents.referencesInDefinitionFile,
    referencesInNonSourceFiles: dependents.referencesInNonSourceFiles,
    referencesTruncated: dependents.referencesTruncated
  }
}

/**
 * The report's two halves: the symbol-side table of what changed, and the
 * file-side list of where it is used.
 *
 * Nothing is invented and nothing is dropped. Every site discovery returned lands
 * on exactly one file entry, and every changed symbol appears in `changedSymbols`
 * whether or not anything references it — a symbol with no dependent is a real
 * result, and omitting it would turn "nothing uses this" into silence.
 */
export const groupImpactedFiles = (
  input: GroupImpactedFilesInput
): GroupedImpact => {
  const changedPaths = new Set(
    input.dependents.map((dependents) => dependents.symbol.path)
  )

  return {
    changedSymbols: input.dependents.map((dependents) =>
      toChangedSymbolReport(dependents, input.contractChanges)
    ),
    impactedFiles: groupSites(
      input.dependents.map((dependents) => ({
        symbol: dependents.symbol,
        sites: dependents.references
      })),
      changedPaths
    ),
    impactedTestFiles: groupSites(
      input.dependents.map((dependents) => ({
        symbol: dependents.symbol,
        sites: dependents.testReferences
      })),
      changedPaths
    )
  }
}
