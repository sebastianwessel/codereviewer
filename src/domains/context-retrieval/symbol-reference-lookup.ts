// Bounded, directed lookup of where named symbols are referenced.
//
// This is the first genuinely new retrieval capability in this domain, and it
// lives here rather than in the domain that needs it (spec 22's change-impact
// review) for one reason: `createContextRetriever` is the only place in the
// codebase that combines path containment, symlink-realpath re-checking, the
// eligibility gate, redaction, ledger entries and evidence records. Reproducing
// any part of that outside this domain would be a security regression, so a
// caller gets this composition instead of a filesystem seam of its own. Nothing
// here opens a file handle; every read goes through the retriever.
//
// The lookup is deliberately NOT model-driven. The queries are a pure function
// of the caller's symbol list, the number of searches is exactly the number of
// symbols, and each search is capped independently. That is what makes the cost
// predictable without a tool-call budget.

import { createContextRetriever, type ContextRetrievalMatch } from './context-retriever.js'
import type { ContextRetrievalEligibilityConfig } from './eligibility.js'

// A symbol to locate, plus where it is defined. The definition path is carried
// through (not used to filter) so the CALLER decides whether a reference in the
// defining file counts as a dependent: that is a policy question, and this module
// owns mechanism only.
export type SymbolReferenceQuery = {
  readonly name: string
  readonly definitionPath: string
}

export type SymbolReferenceSite = {
  readonly path: string
  readonly line: number
  readonly text: string
  // True when the reference sits in the file that defines the symbol.
  readonly inDefinitionFile: boolean
}

export type SymbolReferenceResult = {
  readonly query: SymbolReferenceQuery
  readonly references: readonly SymbolReferenceSite[]
  // True when the symbol had more matches than `maxMatchesPerSymbol` allowed.
  // Reported rather than dropped, so a caller can never understate how widely a
  // symbol is used without saying so.
  readonly truncated: boolean
}

export type LookupSymbolReferencesInput = {
  readonly repositoryRoot: string
  readonly queries: readonly SymbolReferenceQuery[]
  // How many matches this lookup COLLECTS per symbol. It bounds the search, and
  // it is deliberately not named after any caller's reporting cap: what a caller
  // shows a reader is a selection made from these matches, decided by policy this
  // module does not own. Conflating the two is what let a caller's report cap be
  // spent, in traversal order, on matches the caller then discarded.
  readonly maxMatchesPerSymbol: number
  readonly maxSearchDepth: number
  // Repository-relative roots to search. Defaults to the whole repository.
  readonly searchPaths?: readonly string[]
  readonly paths?: ContextRetrievalEligibilityConfig
}

// Longest-first with a stable tiebreak on the definition path, so a repeated
// symbol name defined in two files still produces one search rather than two.
const uniqueQueries = (
  queries: readonly SymbolReferenceQuery[]
): readonly SymbolReferenceQuery[] => {
  const seen = new Set<string>()

  return queries.filter((query) => {
    const key = `${query.name}\u0000${query.definitionPath}`

    if (seen.has(key)) {
      return false
    }

    seen.add(key)

    return true
  })
}

const toReferenceSite = (
  match: ContextRetrievalMatch,
  definitionPath: string
): SymbolReferenceSite => ({
  path: match.path,
  line: match.line,
  text: match.text,
  inDefinitionFile: match.path === definitionPath
})

export const lookupSymbolReferences = async (
  input: LookupSymbolReferencesInput
): Promise<readonly SymbolReferenceResult[]> => {
  const queries = uniqueQueries(input.queries)

  if (queries.length === 0) {
    return []
  }

  const retriever = createContextRetriever({
    repositoryRoot: input.repositoryRoot,
    budget: {
      // Exactly one search per symbol, and no reads at all: this lookup never
      // calls `readRepositoryFile`, so a non-zero read budget would only be
      // misleading about what the component can do.
      maxReads: 0,
      maxSearches: queries.length,
      // One MORE than the per-symbol cap, so the per-query limit is what stops
      // the search and the extra match is the evidence that it was truncated.
      maxMatches: input.maxMatchesPerSymbol + 1,
      maxDepth: input.maxSearchDepth
    },
    ...(input.paths === undefined ? {} : { paths: input.paths })
  })

  // ONE traversal for every symbol, not one per symbol. The queries are known up
  // front, so re-walking the repository and re-reading every eligible file once
  // per symbol was pure repetition: on a 1,200-file repository a 50-symbol lookup
  // performed ~53,000 file reads and decoded ~356 MB to answer questions about
  // 7 MB of source, and that repetition was ~74% of `impact check`'s wall clock.
  // Each query is still budgeted, capped and ledgered separately, and the results
  // are identical — traversal order and per-query caps are unchanged.
  const searched = await retriever.grepRepositoryBatch({
    queries: queries.map((query) => ({
      query: query.name,
      // Identifier mode is the whole point: a literal search seeded from a short
      // exported name such as `get` would report every `forget` and `widget` in
      // the repository as a dependent.
      matchMode: 'identifier' as const,
      maxMatchesPerQuery: input.maxMatchesPerSymbol + 1
    })),
    ...(input.searchPaths === undefined ? {} : { paths: input.searchPaths })
  })

  return queries.map((query, index) => {
    const matches = searched[index]?.matches ?? []

    return {
      query,
      references: matches
        .slice(0, input.maxMatchesPerSymbol)
        .map((match) => toReferenceSite(match, query.definitionPath)),
      truncated: matches.length > input.maxMatchesPerSymbol
    }
  })
}
