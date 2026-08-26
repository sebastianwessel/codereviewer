// Pairing a removed declaration against the declarations the same change adds.
//
// WHY THIS EXISTS. A naive symbol diff reports a move, a file rename, an extract
// or a split as a REMOVAL — the most severe category this report has — when the
// symbol is present, under the same name, at a new address. Spec 22's prior-art
// section requires the pairing to run before a removal may be reported, and this
// is the whole of it.
//
// THE PREDICATE IS DELIBERATELY THE SMALLEST SOUND ONE: same name, same language,
// in a file this change adds or modifies. Nothing about signature shape or body
// similarity is consulted.
//
// What that catches: a file rename or move (every symbol of the old path is
// reported deleted and reappears at the new one), a file split, a symbol lifted
// into a new module. These are the cases where the removal report is not merely
// severe but WRONG, because callers of that name still resolve.
//
// What it does not catch, and what the report therefore still shows as a removal:
// a rename in place (`fetchUser` -> `loadUser` — the name is the evidence, and it
// changed), an extract that also renames, a move into a file whose language the
// deterministic registry does not cover, and a move into a file this change does
// not touch (which cannot happen for a move, since the destination must have been
// written). Body similarity would reach some of those, at the cost of pairing two
// unrelated symbols that share boilerplate — and a false pairing DOWNGRADES a real
// deletion, which is the one error this capability must not make. The cheap sound
// half is taken and the rest is published in the known-not-reported list.
//
// The searched population is the change itself, not the repository. A move writes
// its destination, so the destination is in the diff by construction; widening to
// the whole repository would both cost an unbounded search — forbidden by spec 22
// — and pair a removal with an unrelated same-named symbol that was always there.

import type { SupportedSignalLanguage } from '../deterministic-signals/index.js'
import type { RemovalPairing } from './impact-report.js'

// One declaration present on the head side of this change: a candidate for a
// removal to have moved to.
export type AddedDeclaration = {
  readonly name: string
  readonly path: string
  readonly line: number
  readonly language: SupportedSignalLanguage
}

export type RemovedDeclaration = {
  readonly name: string
  readonly path: string
  readonly language: SupportedSignalLanguage
}

export type RemovalPairingIndex = {
  /**
   * The pairing outcome for one removed declaration. Never throws and never
   * guesses: when the candidate set is incomplete it says so rather than
   * returning the confident `none`.
   */
  readonly pair: (removed: RemovedDeclaration) => RemovalPairing
}

const candidateKey = (
  name: string,
  language: SupportedSignalLanguage
): string => `${language}\u0000${name}`

/**
 * Indexes the declarations a change adds so removals can be paired against them.
 *
 * `incompleteReason` is the honesty valve. Pass it whenever some head-side file
 * could not be read, so this index cannot claim to hold every declaration the
 * change added; every unmatched removal then reports `inconclusive` instead of
 * the confident `none`. Absence of a candidate is only evidence of deletion when
 * the candidates were all visible, and this codebase has a documented defect
 * class of a missing input producing the optimistic answer instead.
 */
export const indexAddedDeclarations = (input: {
  readonly declarations: readonly AddedDeclaration[]
  readonly incompleteReason?: string
}): RemovalPairingIndex => {
  const byName = new Map<string, AddedDeclaration>()

  for (const declaration of input.declarations) {
    const key = candidateKey(declaration.name, declaration.language)
    const existing = byName.get(key)

    // First by path then by line, so a name declared in several added files
    // pairs deterministically rather than by traversal order.
    if (
      existing === undefined ||
      declaration.path.localeCompare(existing.path) < 0 ||
      (declaration.path === existing.path && declaration.line < existing.line)
    ) {
      byName.set(key, declaration)
    }
  }

  return {
    pair: (removed) => {
      const match = byName.get(candidateKey(removed.name, removed.language))

      // A declaration in the file that was removed is not a candidate for its own
      // relocation. This cannot normally happen — a deleted file contributes no
      // added declarations — but a path that is deleted and re-added in one range
      // would otherwise pair with itself.
      if (match !== undefined && match.path !== removed.path) {
        return {
          match: 'same-name',
          declaration: {
            name: match.name,
            path: match.path,
            line: match.line
          }
        }
      }

      return input.incompleteReason === undefined
        ? { match: 'none' }
        : { match: 'inconclusive', reason: input.incompleteReason }
    }
  }
}
