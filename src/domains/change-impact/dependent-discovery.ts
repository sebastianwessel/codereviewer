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
// is a judgement about what change-impact means, so it is made here.

import { truncateForContract } from '../../shared/text/truncate.js'
import { lookupSymbolReferences } from '../context-retrieval/index.js'
import type { ContextRetrievalEligibilityConfig } from '../context-retrieval/index.js'
import type { ChangedSymbol } from './changed-symbols.js'
import {
  MAX_REFERENCE_TEXT_LENGTH,
  type ChangedSymbolReferences
} from './impact-report.js'

export type DiscoverDependentsInput = {
  readonly repositoryRoot: string
  readonly changedSymbols: readonly ChangedSymbol[]
  readonly maxReferencesPerSymbol: number
  readonly maxSearchDepth: number
  readonly paths?: ContextRetrievalEligibilityConfig
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

    return {
      name: symbol.name,
      kind: symbol.kind,
      language: symbol.language,
      definitionPath: symbol.path,
      definitionLine: symbol.line,
      changeKind: symbol.changeKind,
      references: dependentReferences.map((reference) => ({
        path: reference.path,
        line: reference.line,
        text: truncateForContract(reference.text, MAX_REFERENCE_TEXT_LENGTH)
      })),
      // Counted, not listed. A symbol referenced only inside its own file is a
      // real and useful signal ("nothing outside this file uses it"), and hiding
      // the count entirely would lose it.
      referencesInDefinitionFile:
        references.length - dependentReferences.length,
      referencesTruncated: result?.truncated ?? false
    }
  })
}
