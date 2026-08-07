// The discovery seed for change-impact review: which named symbols a diff
// actually touched.
//
// It needs no model. `deterministic-signals` already emits, for every language it
// supports, a `SupportSignalFact` carrying a symbol's kind, name and line;
// intersecting those lines with the diff's hunks yields the changed symbols
// language-neutrally and deterministically. Spec 22's whole cost argument rests
// on this being code rather than a provider call.

import type { z } from 'zod'
import type { DiffHunk } from '../repository-intake/index.js'
import {
  extractDeterministicSignals,
  normalizeSignalPath,
  type SupportedSignalLanguage,
  type SupportSignalFact,
  type SupportSignalFactKind
} from '../deterministic-signals/index.js'
import {
  ChangedFileChangeKindSchema,
  ChangedSymbolChangeKindSchema,
  ChangedSymbolKindSchema,
  type RemovalPairing
} from './impact-report.js'
import {
  indexAddedDeclarations,
  type AddedDeclaration,
  type RemovalPairingIndex
} from './removal-pairing.js'

// The fact kinds that name a symbol other code can depend on. `import` and
// `module` are excluded: an import names a symbol this file consumes rather than
// one it provides, and a module/package clause is not a symbol a caller
// references by that name.
//
// Taken from the report schema rather than restated, so the kinds this seeder
// accepts and the kinds the report can express cannot drift apart. The
// `satisfies` keeps the other half of the contract: every kind here must be a
// real `SupportSignalFactKind`, or the intersection below would silently match
// nothing.
const changedSymbolFactKinds =
  ChangedSymbolKindSchema.options satisfies readonly SupportSignalFactKind[]

export type ChangedSymbolKind = z.infer<typeof ChangedSymbolKindSchema>

// How the file carrying the symbol changed. `deleted` is the maximal contract
// change and is why `repository-intake` grew `includeDeletedPaths`.
export type ChangedFileChangeKind = z.infer<typeof ChangedFileChangeKindSchema>

// How the SYMBOL changed. It is not the file's kind: a removal that pairs with a
// declaration this change adds is a `moved` symbol in a `deleted` file.
export type ChangedSymbolChangeKind = z.infer<
  typeof ChangedSymbolChangeKindSchema
>

export type ChangedSymbolSourceFile = {
  readonly path: string
  // File content on the side of the change the hunks are expressed in: the head
  // side for `new`/`modified`, the base side for `deleted`.
  readonly content: string
  readonly changeKind: ChangedFileChangeKind
  readonly hunks: readonly DiffHunk[]
}

export type ChangedSymbol = {
  readonly path: string
  readonly name: string
  readonly kind: ChangedSymbolKind
  readonly language: SupportedSignalLanguage
  readonly line: number
  // Last line the symbol OWNS, on the same side as `line`: the AST node's own end.
  // Carried on the symbol rather than recomputed by consumers, because only the
  // parse knows it. `contract-changes` needs exactly this to decide which diff
  // lines belong to which symbol; a second, weaker guess at the span there would
  // disagree with the one that seeded the symbol in the first place.
  //
  // Spans NEST, because declarations do: a line inside a method is owned by the
  // method and by the class that contains it. See `changedFactsIn` for which of
  // the two a change is attributed to.
  readonly spanEndLine: number
  readonly changeKind: ChangedSymbolChangeKind
  // What the pairing search concluded about a removed declaration. Present
  // exactly when the declaration was removed, which is the same invariant the
  // report schema enforces.
  readonly removalPairing?: RemovalPairing
}

export type CollectChangedSymbolsInput = {
  readonly files: readonly ChangedSymbolSourceFile[]
  readonly maxChangedSymbols: number
  // Why the head side of this change could not be read in full, when it could
  // not. Set it and every unpaired removal reports `inconclusive` rather than the
  // confident `none`: a candidate set with holes in it cannot prove a symbol is
  // gone. Left unset, the pairing search is treated as having seen everything the
  // change added, which is the normal case.
  readonly additionsIncompleteReason?: string
}

export type CollectChangedSymbolsResult = {
  readonly symbols: readonly ChangedSymbol[]
  // True when `maxChangedSymbols` cut the list short. Reported rather than
  // swallowed: a caller must be able to tell a small change from a bounded one.
  readonly truncated: boolean
}

// Ranking used when the same symbol is reported under several fact kinds — a Go
// exported function, for example, produces both `declaration` and `public-symbol`
// at the same line. The most visible kind wins, because visibility is what
// determines whether anything outside the file can depend on it.
const changedSymbolKindRank: Readonly<Record<ChangedSymbolKind, number>> = {
  export: 0,
  'public-symbol': 1,
  declaration: 2
}

const isChangedSymbolKind = (
  kind: SupportSignalFactKind
): kind is ChangedSymbolKind =>
  (changedSymbolFactKinds as readonly SupportSignalFactKind[]).includes(kind)

// A name is only usable as a discovery seed if it can be searched for as an
// identifier. Two real fact shapes fail that and must be dropped rather than
// searched: a re-export wildcard, whose recorded name is `*`, and an operator
// method name such as `<=>` or `[]`. Searching for either would return matches
// that have nothing to do with the symbol. A trailing `?`, `!` or `=` is kept,
// because those are ordinary parts of a method name in some languages and search
// correctly.
const searchableSymbolNamePattern = /^[A-Za-z_$][A-Za-z0-9_$]*[?!=]?$/u

// A fact that can seed discovery: one whose kind names a symbol other code can
// depend on. Narrowed once, at the point the kind is checked, so the seeding loop
// below cannot silently widen back to every fact kind.
type SeedableFact = SupportSignalFact & { readonly kind: ChangedSymbolKind }

// Whether `inner` is a strictly narrower declaration than `outer` — nested inside
// it, and not merely the same construct reported under a second fact kind.
const isNestedInside = (
  inner: SupportSignalFact,
  outer: SupportSignalFact
): boolean =>
  inner.line >= outer.line &&
  inner.endLine <= outer.endLine &&
  (inner.line > outer.line || inner.endLine < outer.endLine)

// The head-side line range one hunk occupies.
//
// A pure-deletion hunk reports `newLineCount === 0`, meaning nothing occupies that
// position on the new side. `newStartLine` is then the line the removal sits after,
// so that single line is treated as touched: it is the closest surviving anchor for
// a symbol whose body lost code, and treating the hunk as covering nothing would
// make every pure deletion invisible.
const hunkRange = (hunk: DiffHunk): readonly [number, number] => [
  hunk.newStartLine,
  hunk.newLineCount === 0
    ? hunk.newStartLine
    : hunk.newStartLine + hunk.newLineCount - 1
]

// Whether every line of `[start, end]` falls inside one of `covers`, which need
// not be disjoint but MUST be sorted by start line — the sweep below depends on
// it and does not verify it.
//
// The sort is the caller's job because `covers` is constant for a fact while this
// is asked once per hunk: sorting here re-copied and re-sorted the same array on
// every invocation. `sortedNestedRanges` is the only way this array is built, so
// there is one place that owes the ordering.
const rangeIsCovered = (
  start: number,
  end: number,
  sortedCovers: readonly (readonly [number, number])[]
): boolean => {
  let reached = start

  for (const [coverStart, coverEnd] of sortedCovers) {
    if (coverStart > reached) {
      return false
    }

    reached = Math.max(reached, coverEnd + 1)

    if (reached > end) {
      return true
    }
  }

  return reached > end
}

// The line ranges of every declaration strictly nested inside `outer`, ordered by
// start line so `rangeIsCovered` can sweep them directly. Built once per fact
// because it depends on nothing else: it is the same set for every hunk the fact
// is tested against.
const sortedNestedRanges = (
  facts: readonly SupportSignalFact[],
  outer: SupportSignalFact
): readonly (readonly [number, number])[] =>
  facts
    .filter((other) => isNestedInside(other, outer))
    .map((other) => [other.line, other.endLine] as const)
    .sort((left, right) => left[0] - right[0])

/**
 * The seedable facts of one changed file that the diff actually changed.
 *
 * A symbol is changed when the diff touches ANY line it owns, not only the line it
 * is declared on. Declaration-line-only was the original rule and it made the whole
 * capability inert on the changes it exists for: editing a function's BODY leaves
 * its signature untouched, so no hunk ever reaches the declaration line. Measured on
 * three real corpus cases (fastify, rack, typeorm), every changed line sat inside a
 * body and all three reported an empty blast radius.
 *
 * Spans NEST, because declarations do, so a body line is owned by the method AND by
 * the type around it. The symbol reported is the MOST SPECIFIC declaration whose own
 * lines the change touched: a type is seeded by a change to its own body — its
 * declaration line, a class-level attribute, a decorator — and not by a change that
 * a member of it already accounts for. The test is line coverage rather than mere
 * containment, so one hunk spanning a class attribute AND a method seeds both.
 *
 * Two reasons for the narrow rule, and the second is measured:
 *
 *   - The coarse claim is nearly vacuous. "This 1 400-line class changed, here is
 *     everything that mentions it" tells a reader less than the reference list it
 *     costs, and discovery searches for the NAME, so a type name returns the module.
 *   - Seeding every enclosing declaration too was built and scored against the
 *     change-impact corpus on 2026-08-06: 67 predicted files became 100, the proven
 *     dependents found stayed at 5, and the precision lower bound fell from 7.5% to
 *     5.0%. It bought nothing at the configured per-symbol reference cap.
 */
const changedFactsIn = (
  file: ChangedSymbolSourceFile,
  facts: readonly SeedableFact[]
): readonly SeedableFact[] => {
  // A deleted file has no surviving lines to intersect, and every symbol it
  // declared is gone. Anything less than "all of them" would be wrong.
  if (file.changeKind === 'deleted') {
    return facts
  }

  const ranges = file.hunks.map((hunk) => hunkRange(hunk))

  return facts.filter((fact) => {
    const nested = sortedNestedRanges(facts, fact)

    return ranges.some(([hunkStart, hunkEnd]) => {
      const start = Math.max(hunkStart, fact.line)
      const end = Math.min(hunkEnd, fact.endLine)

      return start <= end && !rangeIsCovered(start, end, nested)
    })
  })
}

// A candidate a removal could have moved to: a declaration this change wrote on
// the head side. Declarations the change did not touch are excluded on purpose —
// a symbol that was already there under that name is not evidence that this
// change relocated anything, and pairing against one would downgrade a real
// deletion.
const isAddedDeclaration = (symbol: ChangedSymbol): boolean =>
  symbol.changeKind !== 'deleted'

const toAddedDeclaration = (symbol: ChangedSymbol): AddedDeclaration => ({
  name: symbol.name,
  path: symbol.path,
  line: symbol.line,
  language: symbol.language
})

// Turns a file-level removal into a symbol-level statement. Everything else
// passes through untouched: only a removal has a pairing question to answer.
const resolveRemoval = (
  symbol: ChangedSymbol,
  pairing: RemovalPairingIndex
): ChangedSymbol => {
  if (symbol.changeKind !== 'deleted') {
    return symbol
  }

  const removalPairing = pairing.pair({
    name: symbol.name,
    path: symbol.path,
    language: symbol.language
  })

  return {
    ...symbol,
    changeKind: removalPairing.match === 'same-name' ? 'moved' : 'deleted',
    removalPairing
  }
}

const compareChangedSymbols = (
  left: ChangedSymbol,
  right: ChangedSymbol
): number =>
  left.path.localeCompare(right.path) ||
  left.line - right.line ||
  left.name.localeCompare(right.name)

/**
 * Intersects the support-signal facts of each changed file with that file's diff
 * hunks. Files in a language `deterministic-signals` does not support contribute
 * no symbols; they are silently ignored rather than failing the run, because a
 * mixed-language change must still report what it can.
 *
 * Removals are then paired against the declarations the same change adds, so a
 * relocated symbol is reported as moved rather than as the most severe category
 * this report has. See `removal-pairing.ts` for what that predicate does and does
 * not catch.
 */
export const collectChangedSymbols = (
  input: CollectChangedSymbolsInput
): CollectChangedSymbolsResult => {
  // Facts come back with normalized paths, so the lookup key must be normalized
  // too or a caller passing `./src/app.ts` would silently match nothing.
  const filesByPath = new Map(
    input.files.map((file) => [normalizeSignalPath(file.path), file] as const)
  )
  const extraction = extractDeterministicSignals(
    input.files.map((file) => ({ path: file.path, content: file.content }))
  )
  // Keyed on path + name + line so two distinct symbols sharing a name in one
  // file stay distinct, while the same symbol reported under several fact kinds
  // collapses to its most visible one.
  const strongestByKey = new Map<string, ChangedSymbol>()
  // Seedable facts per file, so the nesting question is asked among the
  // declarations of one file rather than across the whole change.
  const seedableByPath = new Map<string, SeedableFact[]>()

  for (const fact of extraction.facts) {
    const kind = fact.kind

    if (
      !isChangedSymbolKind(kind) ||
      !searchableSymbolNamePattern.test(fact.name) ||
      !filesByPath.has(fact.path)
    ) {
      continue
    }

    const seedableFact: SeedableFact = { ...fact, kind }
    const seedable = seedableByPath.get(fact.path)

    if (seedable === undefined) {
      seedableByPath.set(fact.path, [seedableFact])
    } else {
      seedable.push(seedableFact)
    }
  }

  for (const [path, seedable] of seedableByPath) {
    const file = filesByPath.get(path)

    if (file === undefined) {
      continue
    }

    for (const fact of changedFactsIn(file, seedable)) {
      const key = `${fact.path}\u0000${fact.name}\u0000${fact.line}`
      const candidate: ChangedSymbol = {
        path: fact.path,
        name: fact.name,
        kind: fact.kind,
        language: fact.language,
        line: fact.line,
        // Read from the parse, never inferred. The previous rule — "up to the line
        // before the next declaration" — was wrong in both directions on the same
        // file: it ended a type at its first member, so a type was seeded only by a
        // change above that member; and it ran the LAST member of a type past the
        // type's own closing line, so a module-level edit below the class was
        // reported as a contract change to that member.
        spanEndLine: fact.endLine,
        changeKind: file.changeKind
      }
      const existing = strongestByKey.get(key)

      if (
        existing === undefined ||
        changedSymbolKindRank[candidate.kind] <
          changedSymbolKindRank[existing.kind]
      ) {
        strongestByKey.set(key, candidate)
      }
    }
  }

  const candidates = [...strongestByKey.values()]
  // Pairing runs over the WHOLE candidate set, before the seed cap. A removal
  // whose replacement happened to sort past `maxChangedSymbols` would otherwise
  // be reported as a deletion because of a bound, which is exactly the confident
  // wrong answer the cap exists to avoid producing.
  const pairing = indexAddedDeclarations({
    declarations: candidates
      .filter(isAddedDeclaration)
      .map(toAddedDeclaration),
    ...(input.additionsIncompleteReason === undefined
      ? {}
      : { incompleteReason: input.additionsIncompleteReason })
  })
  const sorted = candidates
    .map((symbol) => resolveRemoval(symbol, pairing))
    .sort(compareChangedSymbols)

  return {
    symbols: sorted.slice(0, input.maxChangedSymbols),
    truncated: sorted.length > input.maxChangedSymbols
  }
}
