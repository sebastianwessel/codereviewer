// Bounded, diff-seeded discovery of where the changed symbols are referenced.
//
// The whole control flow is code, not a model: which symbols to look for comes
// from `collectChangedSymbols`, how many lookups run is exactly the number of
// those symbols, and each lookup is capped independently. Spec 22 forbids
// unbounded repository search, and this is where that bound lives.
//
// This module owns POLICY. `context-retrieval`'s `lookupSymbolReferences` owns
// mechanism and reports every reference it finds, including those in the file
// that defines the symbol; deciding that a symbol's own file is not a dependent
// is a judgement about what change-impact means, so it is made here. So is the
// destination policy spec 22 added after its first run: which files can hold a
// dependent at all.
//
// Two filters apply, and they are not the same filter:
//
// 1. ELIGIBILITY — may this file be looked at? Owned by `context-retrieval`'s
//    gate and driven by the configured `paths.include`/`paths.exclude`, so the
//    reference search sees exactly the surface `review` sees. Nothing about that
//    definition is restated here; the config is passed through and the gate
//    prunes ineligible files during traversal, before they are ever read.
// 2. DESTINATION — can this file hold a dependent? A prose paragraph or a JSON
//    fixture can be eligible for review and still be textual coincidence.
//    Classified by `classifyReferenceDestination` after the search, because it is
//    a judgement about what "dependent" means rather than about what may be read.
//
// The classification runs after the per-symbol cap rather than inside the search.
// That keeps the mediated filesystem seam a pure mechanism with no policy hook,
// and it is what makes the withheld counts exact — a filter applied during
// traversal would skip files before anyone could count their matches, and a
// report that silently drops sites looks cleaner than the search actually was.
// The cost is that a heavily-referenced symbol can spend its cap on non-source
// matches; `referencesTruncated` is what tells the reader that happened.

import { truncateForContract } from '../../shared/text/truncate.js'
import { lookupSymbolReferences } from '../context-retrieval/index.js'
import type {
  ContextRetrievalEligibilityConfig,
  SymbolReferenceSite
} from '../context-retrieval/index.js'
import type { ChangedSymbol } from './changed-symbols.js'
import {
  MAX_REFERENCE_TEXT_LENGTH,
  type ChangedSymbolReferences,
  type SymbolReferenceSiteReport
} from './impact-report.js'
import { classifyReferenceDestination } from './reference-destination.js'

export type DiscoverDependentsInput = {
  readonly repositoryRoot: string
  readonly changedSymbols: readonly ChangedSymbol[]
  readonly maxReferencesPerSymbol: number
  readonly maxSearchDepth: number
  readonly paths?: ContextRetrievalEligibilityConfig
}

const toReportSite = (
  reference: SymbolReferenceSite
): SymbolReferenceSiteReport => ({
  path: reference.path,
  line: reference.line,
  text: truncateForContract(reference.text, MAX_REFERENCE_TEXT_LENGTH)
})

// The arrays are mutable because they land directly in a `ChangedSymbolReferences`,
// whose shape is inferred from the Zod schema.
type BucketedReferences = {
  readonly references: SymbolReferenceSiteReport[]
  readonly testReferences: SymbolReferenceSiteReport[]
  readonly nonSourceCount: number
}

// Splits the sites outside the defining file by what kind of file they landed in.
// Order within a bucket is the search's order, so a bucket reads the same way the
// unsplit list did.
const bucketByDestination = (
  references: readonly SymbolReferenceSite[]
): BucketedReferences => {
  const production: SymbolReferenceSiteReport[] = []
  const tests: SymbolReferenceSiteReport[] = []
  let nonSourceCount = 0

  for (const reference of references) {
    const destination = classifyReferenceDestination(reference.path)

    if (destination === 'non-source') {
      nonSourceCount += 1
      continue
    }

    if (destination === 'test') {
      tests.push(toReportSite(reference))
      continue
    }

    production.push(toReportSite(reference))
  }

  return {
    references: production,
    testReferences: tests,
    nonSourceCount
  }
}

export const discoverDependents = async (
  input: DiscoverDependentsInput
): Promise<readonly ChangedSymbolReferences[]> => {
  if (input.changedSymbols.length === 0) {
    return []
  }

  const results = await lookupSymbolReferences({
    repositoryRoot: input.repositoryRoot,
    queries: input.changedSymbols.map((symbol) => ({
      name: symbol.name,
      definitionPath: symbol.path
    })),
    maxReferencesPerSymbol: input.maxReferencesPerSymbol,
    maxSearchDepth: input.maxSearchDepth,
    ...(input.paths === undefined ? {} : { paths: input.paths })
  })
  // A repeated symbol name defined in the same file collapses to one lookup, so
  // results are keyed rather than zipped positionally with the input.
  const resultsByKey = new Map(
    results.map((result) => [
      `${result.query.name} ${result.query.definitionPath}`,
      result
    ] as const)
  )

  return input.changedSymbols.map((symbol) => {
    const result = resultsByKey.get(`${symbol.name} ${symbol.path}`)
    const references = result?.references ?? []
    const dependentReferences = references.filter(
      (reference) => !reference.inDefinitionFile
    )
    const bucketed = bucketByDestination(dependentReferences)

    return {
      name: symbol.name,
      kind: symbol.kind,
      language: symbol.language,
      definitionPath: symbol.path,
      definitionLine: symbol.line,
      changeKind: symbol.changeKind,
      references: bucketed.references,
      testReferences: bucketed.testReferences,
      // Counted, not listed. A symbol referenced only inside its own file is a
      // real and useful signal ("nothing outside this file uses it"), and hiding
      // the count entirely would lose it.
      referencesInDefinitionFile:
        references.length - dependentReferences.length,
      // Same reasoning, applied to the destinations spec 22 excluded: withheld is
      // reported, not hidden.
      referencesInNonSourceFiles: bucketed.nonSourceCount,
      referencesTruncated: result?.truncated ?? false
    }
  })
}
