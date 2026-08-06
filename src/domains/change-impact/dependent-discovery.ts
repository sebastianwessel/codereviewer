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
// The classification runs after the search rather than inside it. That keeps the
// mediated filesystem seam a pure mechanism with no policy hook, and it is what
// makes the withheld counts exact — a filter applied during traversal would skip
// files before anyone could count their matches, and a report that silently drops
// sites looks cleaner than the search actually was.
//
// TWO BOUNDS, NOT ONE. They answer different questions and were one number until
// 2026-08-06, which was a defect rather than an economy:
//
// - `maxReferenceCandidatesPerSymbol` bounds what the SEARCH COLLECTS. It is a
//   cost bound on traversal and memory, and it is spent in traversal order
//   because a search cannot know what it has not read yet.
// - `maxReferencesPerSymbol` bounds what the REPORT LISTS. It exists so a
//   heavily-referenced symbol cannot flood the page.
//
// With one number the report cap was spent, in filesystem order, on matches this
// module then discarded — comments, prose, the symbol's own file — so which sites
// a reviewer saw was decided by directory names, and the ranking below sorted a
// set that had already thrown its best candidates away. Measured on the
// change-impact corpus: 18.1% of the matches the cap admitted were discarded
// straight afterwards, and on two symbols 20 of 25 and 21 of 25 were, in both
// cases while the search reported that further matches existed. Splitting the
// bounds makes the report cap a SELECTION over candidates that could actually be
// dependents, without widening what the report shows.
//
// It does NOT own the report's shape. The report groups by destination FILE
// (spec 22); this module answers per symbol, because one symbol is what one query
// searches for. `impacted-files.ts` is the seam between the two.

import { truncateForContract } from '../../shared/text/truncate.js'
import { lookupSymbolReferences } from '../context-retrieval/index.js'
import type {
  ContextRetrievalEligibilityConfig,
  SymbolReferenceSite
} from '../context-retrieval/index.js'
import type { ChangedSymbol } from './changed-symbols.js'
import { isCommentLine } from './comment-lines.js'
import { MAX_REFERENCE_TEXT_LENGTH } from './impact-report.js'
import { classifyReferenceDestination } from './reference-destination.js'

export type DiscoverDependentsInput = {
  readonly repositoryRoot: string
  readonly changedSymbols: readonly ChangedSymbol[]
  // How many sites the report lists per symbol.
  readonly maxReferencesPerSymbol: number
  // How many raw matches the search collects per symbol before this module
  // selects from them. A value below `maxReferencesPerSymbol` simply becomes the
  // binding bound — the two only ever tighten each other, never widen.
  readonly maxReferenceCandidatesPerSymbol: number
  readonly maxSearchDepth: number
  readonly paths?: ContextRetrievalEligibilityConfig
}

// A located reference, before it is grouped by destination file. The path stays
// on the site here because grouping is what removes it: once a site sits under
// its file, repeating the path on every site would be a second copy of the same
// fact.
export type DiscoveredReferenceSite = {
  readonly path: string
  readonly line: number
  readonly text: string
}

// What the search found for one changed symbol. This is the domain's INTERNAL
// shape, not the report's: the report groups by destination file (spec 22), and
// `impacted-files.ts` performs that regrouping. Discovery emits per symbol
// because that is what it searched for, one query per symbol.
export type SymbolDependents = {
  readonly symbol: ChangedSymbol
  readonly references: readonly DiscoveredReferenceSite[]
  readonly testReferences: readonly DiscoveredReferenceSite[]
  readonly referencesInDefinitionFile: number
  readonly referencesInNonSourceFiles: number
  // More candidate dependents were found than the report lists. The listed ones
  // are the ranked head of that set.
  readonly referencesTruncated: boolean
  // The SEARCH stopped collecting before it ran out of matches, so matches exist
  // that were never classified, ranked or counted. A different and worse claim
  // than the one above — "there are places I did not look" rather than "there is
  // more of what you can see" — so the two are reported apart rather than under
  // one boolean that would hide the worse of them behind the milder.
  readonly referenceSearchTruncated: boolean
}

const toDiscoveredSite = (
  reference: SymbolReferenceSite
): DiscoveredReferenceSite => ({
  path: reference.path,
  line: reference.line,
  text: truncateForContract(reference.text, MAX_REFERENCE_TEXT_LENGTH)
})

type SelectedReferences = {
  readonly references: readonly DiscoveredReferenceSite[]
  readonly testReferences: readonly DiscoveredReferenceSite[]
  readonly nonSourceCount: number
  readonly capReached: boolean
}

// A match that survived the destination policy, still carrying which list it
// belongs in. Kept as the raw site: the text is truncated for the contract only
// once selection has decided which sites a reader will actually see.
type CandidateReference = {
  readonly reference: SymbolReferenceSite
  readonly bucket: 'production' | 'test'
}

/**
 * Decides WHICH candidates survive the report cap, and in what order.
 *
 * A reference list is only useful if the top of it is worth reading. Rack's
 * `scheme` returns dozens of sites and a reviewer will not open them all, so
 * whatever sits at the top is effectively the whole report — and when the cap
 * binds, the top is the entire report. Search order is filesystem order, which
 * puts nothing in particular there.
 *
 * Two ordering keys, each justified from mechanism rather than from any case:
 *
 * 1. A PRODUCTION site before a TEST site. Both are real dependents and both
 *    break, which is why tests are listed rather than dropped — but they break in
 *    different places, a test in CI and a production caller in front of a user,
 *    and spec 22 already presents the production list as the primary one. When one
 *    cap has to choose between them, the list the spec makes primary is the one it
 *    fills first; a symbol whose test sites outnumber its production sites would
 *    otherwise lose its primary list entirely to CI breakage.
 * 2. A reference in a file THIS CHANGE ALSO TOUCHED before one elsewhere. Both
 *    sides moved together, which is where a contract mismatch is most likely to
 *    have been introduced and least likely to have been noticed.
 *
 * Everything else keeps search order. The tail carries no ranking because there is
 * no signal here to support one.
 *
 * Deliberately NOT ranked on: reference count (a symbol used everywhere is not
 * riskier than one used once in the wrong place), directory distance (a proxy for
 * coupling this project has no measurement for), or whether the matched line looks
 * like a call (that is a punctuation list masquerading as an analysis, and spec 22
 * rejects syntax lists for the same reason it rejects a decorator marker).
 */
const selectWithinCap = (
  candidates: readonly CandidateReference[],
  changedPaths: ReadonlySet<string>,
  maxReferences: number
): {
  readonly references: readonly DiscoveredReferenceSite[]
  readonly testReferences: readonly DiscoveredReferenceSite[]
  readonly capReached: boolean
} => {
  const rank = (candidate: CandidateReference): number =>
    (candidate.bucket === 'production' ? 0 : 2) +
    (changedPaths.has(candidate.reference.path) ? 0 : 1)
  // Four stable tiers rather than a comparator, so the order inside a tier is
  // exactly the search's own and no sort can quietly reshuffle equal candidates.
  const tiers: CandidateReference[][] = [[], [], [], []]

  for (const candidate of candidates) {
    tiers[rank(candidate)]?.push(candidate)
  }

  const ordered = tiers.flat()
  const selected = ordered.slice(0, maxReferences)

  return {
    references: selected
      .filter((candidate) => candidate.bucket === 'production')
      .map((candidate) => toDiscoveredSite(candidate.reference)),
    testReferences: selected
      .filter((candidate) => candidate.bucket === 'test')
      .map((candidate) => toDiscoveredSite(candidate.reference)),
    capReached: ordered.length > maxReferences
  }
}

// Drops every match that cannot be a dependent, counts the withheld ones exactly,
// and hands what is left to the cap to select from.
//
// This runs over EVERY match the search collected, not over a prefix of them, so
// the counts describe the whole search rather than the part that happened to fit.
const selectDependentReferences = (
  references: readonly SymbolReferenceSite[],
  changedPaths: ReadonlySet<string>,
  maxReferences: number
): SelectedReferences => {
  const candidates: CandidateReference[] = []
  let nonSourceCount = 0

  for (const reference of references) {
    if (isCommentLine(reference.text)) {
      continue
    }

    const destination = classifyReferenceDestination(reference.path)

    if (destination === 'non-source') {
      nonSourceCount += 1
      continue
    }

    candidates.push({
      reference,
      bucket: destination === 'test' ? 'test' : 'production'
    })
  }

  return { ...selectWithinCap(candidates, changedPaths, maxReferences), nonSourceCount }
}

export const discoverDependents = async (
  input: DiscoverDependentsInput
): Promise<readonly SymbolDependents[]> => {
  if (input.changedSymbols.length === 0) {
    return []
  }

  const results = await lookupSymbolReferences({
    repositoryRoot: input.repositoryRoot,
    queries: input.changedSymbols.map((symbol) => ({
      name: symbol.name,
      definitionPath: symbol.path
    })),
    // The SEARCH bound, not the report cap. What a reader sees is chosen from
    // these matches below; handing the report cap to the search is what made the
    // cap a truncation in traversal order instead of a selection.
    maxMatchesPerSymbol: input.maxReferenceCandidatesPerSymbol,
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

  // Every file this change touched. A dependent living in one of them moved
  // alongside the symbol it depends on, which is the one relevance signal available
  // here without new analysis.
  const changedPaths = new Set(input.changedSymbols.map((symbol) => symbol.path))

  return input.changedSymbols.map((symbol) => {
    const result = resultsByKey.get(`${symbol.name} ${symbol.path}`)
    const references = result?.references ?? []
    const dependentReferences = references.filter(
      (reference) => !reference.inDefinitionFile
    )
    const selected = selectDependentReferences(
      dependentReferences,
      changedPaths,
      input.maxReferencesPerSymbol
    )

    return {
      symbol,
      references: selected.references,
      testReferences: selected.testReferences,
      // Counted, not listed. A symbol referenced only inside its own file is a
      // real and useful signal ("nothing outside this file uses it"), and hiding
      // the count entirely would lose it.
      referencesInDefinitionFile:
        references.length - dependentReferences.length,
      // Same reasoning, applied to the destinations spec 22 excluded: withheld is
      // reported, not hidden.
      referencesInNonSourceFiles: selected.nonSourceCount,
      referencesTruncated: selected.capReached,
      referenceSearchTruncated: result?.truncated ?? false
    }
  })
}
