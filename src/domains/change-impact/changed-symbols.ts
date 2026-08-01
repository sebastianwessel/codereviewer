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
  ChangedSymbolKindSchema
} from './impact-report.js'

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
  readonly changeKind: ChangedFileChangeKind
}

export type CollectChangedSymbolsInput = {
  readonly files: readonly ChangedSymbolSourceFile[]
  readonly maxChangedSymbols: number
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

// Whether a declaration line falls inside a hunk, in the line space the hunks are
// expressed in.
//
// A pure-deletion hunk reports `newLineCount === 0`, meaning nothing occupies
// that position on the new side. `newStartLine` is then the line the removal sits
// after, so that single line is treated as touched: it is the closest surviving
// anchor for a symbol whose body lost code, and treating the hunk as covering
// nothing would make every pure deletion invisible.
const hunkTouchesRange = (
  hunk: DiffHunk,
  rangeStart: number,
  rangeEnd: number
): boolean => {
  const firstLine = hunk.newStartLine
  const lastLine =
    hunk.newLineCount === 0
      ? hunk.newStartLine
      : hunk.newStartLine + hunk.newLineCount - 1

  // Overlap, not containment: a hunk that starts inside the symbol and runs past
  // its end still changed it.
  return firstLine <= rangeEnd && lastLine >= rangeStart
}

// The line range a symbol OWNS: from its own declaration line up to the line
// before the next declaration in the same file, or the end of the file for the
// last one.
//
// A support-signal fact records only the line a symbol is declared on, not the
// extent of its body, so the span is derived from the neighbouring declarations.
// It is an approximation — a nested declaration ends its parent's span early, so
// a change in a class body between two methods is attributed to the earlier
// method rather than the class — but it is a sound one for this purpose: it never
// attributes a change to a symbol declared after it, and the symbol it does name
// is always the most specific one containing the change.
const symbolSpansFor = (
  declarationLines: readonly number[],
  fileLineCount: number
): ReadonlyMap<number, number> => {
  const spans = new Map<number, number>()

  for (const [index, line] of declarationLines.entries()) {
    const next = declarationLines[index + 1]

    spans.set(line, next === undefined ? Math.max(line, fileLineCount) : next - 1)
  }

  return spans
}

const factIsChanged = (
  file: ChangedSymbolSourceFile,
  fact: SupportSignalFact,
  spanEndByLine: ReadonlyMap<number, number>
): boolean => {
  // A deleted file has no surviving lines to intersect, and every symbol it
  // declared is gone. Anything less than "all of them" would be wrong.
  if (file.changeKind === 'deleted') {
    return true
  }

  // A symbol is changed when the diff touches ANY line it owns, not only the line
  // it is declared on.
  //
  // Declaration-line-only was the original rule and it made the whole capability
  // inert on the changes it exists for. Editing a function's BODY leaves its
  // signature untouched, so no hunk ever reaches the declaration line and no
  // symbol is seeded — yet a body change is precisely what alters behaviour for
  // everything downstream. Measured on three real corpus cases (fastify, rack,
  // typeorm): every changed line sat inside a body, not one declaration line was
  // touched, and all three reported ZERO changed symbols and an empty blast
  // radius. A signature change, the only case the old rule caught, is the rare one
  // and is usually caught by the compiler anyway.
  const spanEnd = spanEndByLine.get(fact.line) ?? fact.line

  return file.hunks.some((hunk) =>
    hunkTouchesRange(hunk, fact.line, spanEnd)
  )
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
  // Every line that declares a seedable symbol, per file, so each symbol's span
  // can be bounded by the next declaration below it. Built from the seedable kinds
  // only: an import sits above the first declaration and a module clause is not a
  // symbol, so letting either act as a boundary would shorten a real span for no
  // reason.
  const declarationLinesByPath = new Map<string, number[]>()

  for (const fact of extraction.facts) {
    if (!isChangedSymbolKind(fact.kind)) {
      continue
    }

    const lines = declarationLinesByPath.get(fact.path)

    if (lines === undefined) {
      declarationLinesByPath.set(fact.path, [fact.line])
    } else if (!lines.includes(fact.line)) {
      lines.push(fact.line)
    }
  }

  const spansByPath = new Map<string, ReadonlyMap<number, number>>()

  for (const [path, lines] of declarationLinesByPath) {
    const file = filesByPath.get(path)

    spansByPath.set(
      path,
      symbolSpansFor(
        [...lines].sort((left, right) => left - right),
        file === undefined ? 0 : file.content.split('\n').length
      )
    )
  }

  // Keyed on path + name + line so two distinct symbols sharing a name in one
  // file stay distinct, while the same symbol reported under several fact kinds
  // collapses to its most visible one.
  const strongestByKey = new Map<string, ChangedSymbol>()

  for (const fact of extraction.facts) {
    if (
      !isChangedSymbolKind(fact.kind) ||
      !searchableSymbolNamePattern.test(fact.name)
    ) {
      continue
    }

    const file = filesByPath.get(fact.path)

    if (
      file === undefined ||
      !factIsChanged(file, fact, spansByPath.get(fact.path) ?? new Map())
    ) {
      continue
    }

    const key = `${fact.path}\u0000${fact.name}\u0000${fact.line}`
    const candidate: ChangedSymbol = {
      path: fact.path,
      name: fact.name,
      kind: fact.kind,
      language: fact.language,
      line: fact.line,
      changeKind: file.changeKind
    }
    const existing = strongestByKey.get(key)

    if (
      existing === undefined ||
      changedSymbolKindRank[candidate.kind] < changedSymbolKindRank[existing.kind]
    ) {
      strongestByKey.set(key, candidate)
    }
  }

  const sorted = [...strongestByKey.values()].sort(compareChangedSymbols)

  return {
    symbols: sorted.slice(0, input.maxChangedSymbols),
    truncated: sorted.length > input.maxChangedSymbols
  }
}
