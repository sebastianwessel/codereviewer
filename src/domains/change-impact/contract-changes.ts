// Which diff lines belong to which changed symbol, and therefore what each
// symbol's contract delta is.
//
// `contract-delta` knows how to READ a pair of line sets and say what a caller
// can now observe; `changed-symbols` knows which lines a symbol OWNS. Neither can
// reach the diff text, and this module is the only place the two meet, so the
// wiring lives here rather than inside either of them.
//
// It stays a pure function of (symbols, diff text): no filesystem, no git, no
// provider call, which is what the import-boundary test in this folder enforces.

import {
  parseChangedLines,
  type ChangedLine
} from '../repository-intake/index.js'
import type { ChangedSymbol } from './changed-symbols.js'
import { describeContractDelta, type ContractChange } from './contract-delta.js'
import { impactedSymbolKey } from './impact-report.js'

export type CollectContractChangesInput = {
  readonly changedSymbols: readonly ChangedSymbol[]
  // The unified diff intake already fetched. Empty when intake had no diff to
  // fetch — an explicit file list, for example — in which case no symbol gets a
  // contract delta, which is honest: nothing was compared.
  readonly rawDiff: string
}

// Keyed on path + name + line, matching how `collectChangedSymbols` distinguishes
// two symbols that share a name in one file. Exported so a consumer looks a
// symbol up the same way this module stored it instead of rebuilding the key.
//
// It DELEGATES rather than formats. This and `impactedSymbolKey` are one identity
// over two spellings of the same triple, and they were formatted independently:
// one joined on a separator, the other on a space. Nothing failed — the lookup
// simply missed, and every contract delta vanished silently on the way into
// adjudication. One definition is what makes that disagreement unrepresentable.
export const changedSymbolKey = (symbol: ChangedSymbol): string =>
  impactedSymbolKey({
    name: symbol.name,
    definitionPath: symbol.path,
    definitionLine: symbol.line
  })

const linesInSpan = (
  lines: readonly ChangedLine[],
  symbol: ChangedSymbol
): readonly string[] =>
  lines
    .filter(
      (line) => line.line >= symbol.line && line.line <= symbol.spanEndLine
    )
    .map((line) => line.text)

/**
 * The contract delta for every changed symbol, keyed by `changedSymbolKey`.
 *
 * A symbol with nothing to report is ABSENT from the map rather than present with
 * an empty list, so a caller cannot accidentally distinguish "no delta" from "not
 * computed"; both mean the same thing here and both render as an empty list.
 *
 * Two change kinds are deliberately skipped, because for them a *delta* is not a
 * meaningful claim:
 *
 * - `deleted`. The file has no head side, so no removal can be anchored to a
 *   line that exists and every symbol's span is expressed in coordinates the diff
 *   does not share. The deletion IS the contract change, and `changeKind` already
 *   states it in the strongest terms available.
 * - `new`. Every line inside the span is an addition, so the delta would restate
 *   the body of a symbol that has no prior contract to differ from — "returns
 *   something it did not return before" about something that did not exist. That
 *   is vacuous on every symbol of every new file, which is precisely the volume of
 *   confident noise that trains a reader to skip the field.
 */
export const collectContractChanges = (
  input: CollectContractChangesInput
): ReadonlyMap<string, readonly ContractChange[]> => {
  const changes = new Map<string, readonly ContractChange[]>()

  if (input.rawDiff.length === 0) {
    return changes
  }

  const changedLinesByPath = parseChangedLines(input.rawDiff)

  for (const symbol of input.changedSymbols) {
    if (symbol.changeKind !== 'modified') {
      continue
    }

    const changedLines = changedLinesByPath.get(symbol.path)

    if (changedLines === undefined) {
      continue
    }

    const described = describeContractDelta({
      addedLines: linesInSpan(changedLines.added, symbol),
      removedLines: linesInSpan(changedLines.removed, symbol)
    })

    if (described.length > 0) {
      changes.set(changedSymbolKey(symbol), described)
    }
  }

  return changes
}
