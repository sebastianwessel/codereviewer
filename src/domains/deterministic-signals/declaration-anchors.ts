// Where a file's declarations begin, derived from the AST.
//
// Two features need exactly this list and must not drift apart on it: the R4
// referenced-definition digest keeps a window around each anchor so a caller sees
// its callee's contract, and spec 27's sub-file partitioning cuts a file into
// declaration groups so one file's body can be spread over several discovery
// calls. Both depend on the SAME answer to "where does a declaration start here",
// and two copies of the fact-kind filter would eventually disagree about it.
//
// Anchors come from the extractor, never from a byte count: spec 26 removed the
// content-dependent size guess and spec 27 rule 4 keeps the unit a declaration.

import { extractDeterministicSignals } from './deterministic-signal-registry.js'
import { type SupportSignalFact } from './shared/deterministic-signal-types.js'

// The three fact kinds that mark the start of a declaration. Every polyglot
// adapter reports a public declaration twice (once as `declaration`, once as
// `public-symbol`) at the identical line, so the set is deduplicated below rather
// than assumed disjoint.
const declarationAnchorKinds = new Set<SupportSignalFact['kind']>([
  'export',
  'public-symbol',
  'declaration'
])

/**
 * The 1-based lines of `content` at which a declaration begins, ascending and
 * unique.
 *
 * Extraction failure and an unsupported language both yield an EMPTY list rather
 * than an error. That is the contract both callers rely on to fall back to whole
 * content: a digest falls back to a head window, and a sub-file split falls back
 * to the undivided file. Neither may fall back to a byte slice.
 */
export const declarationAnchorLines = (
  path: string,
  content: string
): readonly number[] => {
  const lineCount = content.split('\n').length

  let facts: readonly SupportSignalFact[] = []

  try {
    facts = extractDeterministicSignals([{ path, content }]).facts
  } catch {
    facts = []
  }

  return [
    ...new Set(
      facts
        .filter((fact) => declarationAnchorKinds.has(fact.kind))
        .map((fact) => fact.line)
        .filter((line) => line >= 1 && line <= lineCount)
    )
  ].sort((left, right) => left - right)
}
