// Deterministic verification of discovery's source-line citations, and the
// EvidenceRecords minted from the ones that verify.
//
// This module exists because discovery's claim that a quote sits at a given line
// is, by itself, worth nothing: a model can assert a citation exactly as easily
// as it can assert a finding, and taking its word for either would just move the
// trust problem this whole pipeline exists to solve one field over. So every
// citation is re-checked here against the ACTUAL reviewed source text — the same
// numbered content discovery itself was shown (`numberedFileContentLookupFor`) —
// with nothing short-circuiting the check. A citation that verifies mints
// evidence; one that does not is silently absent from the finding: not
// downgraded, not flagged, not reported as a failure. See `citationEvidenceFor`'s
// own comment for why "absent" is the ONLY failure mode this module may have.

import {
  EvidenceRecordSchema,
  type EvidenceRecord
} from '../../../../shared/contracts/index.js'
import { createRedactor } from '../../../../shared/redaction/redactor.js'
import { sha256 } from '../../../../shared/hash/hash.js'
import { truncateForContract } from '../../../../shared/text/truncate.js'
import type { ModelFindingCitation } from '../agent-contracts.js'

// How far a matched line may drift from the citation's own claimed `startLine`,
// in either direction. Wide enough that a model off by a line or two (an easy
// miscount against a numbered listing) still verifies; narrow enough that a
// quote copied from elsewhere in the file cannot "verify" a claim about an
// unrelated line. That is the whole reason this checks a WINDOW instead of the
// whole file: a whole-file search would only prove the quote exists SOMEWHERE, a
// fact the file content already establishes and the finding already implies.
const CITATION_WINDOW = 2

// Search offsets, DERIVED from `CITATION_WINDOW` rather than written out
// separately (two constants for one bound is exactly the shape that drifts), in
// the order they are tried: the claimed line first, then its nearest neighbours
// outward — 0, -1, 1, -2, 2 for the window above. This ordering is a preference,
// not a correctness rule: it only matters when a quote happens to appear at more
// than one line inside the window, in which case the evidence should point at
// the line closest to what the model actually claimed rather than whichever the
// scan reached first.
const WINDOW_OFFSETS: readonly number[] = Array.from(
  { length: CITATION_WINDOW + 1 },
  (_unused, distance) => distance
).flatMap((distance) => (distance === 0 ? [0] : [-distance, distance]))

// Upper bound on how many lines a single multi-line quote may be joined across
// while searching from one anchor line in the window above. It exists only to
// keep the search provably bounded, not to permit long quotes: a citation's
// `quote` is already capped at 300 characters by its own schema
// (`ModelFindingCitationSchema` in agent-contracts.ts), so no genuine quote needs
// anywhere near this many lines.
const MAX_QUOTE_LINE_SPAN = 20

// Whitespace-tolerant, case-sensitive comparison. Collapsing runs of internal
// whitespace — including the single space this module joins multi-line quotes
// with — lets formatting differences (indentation width, trailing spaces, a line
// wrapped slightly differently than the model saw it) pass, while leaving case
// alone: a quote is a claim about which characters the source actually contains,
// and letting `Password` match a line that only has `password` would turn a
// citation into exactly the kind of near-miss it exists to rule out.
const normalizeForComparison = (value: string): string =>
  value.trim().replace(/\s+/gu, ' ')

// One row of discovery's line-numbered presentation
// (`${lineNumber}: ${originalText}`, see `review-packet.ts`), split back into its
// line number and original text. The format is this engine's OWN, never raw
// repository content, so the anchored pattern below cannot be confused by a
// source line that happens to start with digits and a colon: the first
// "<digits>: " on any row is always the numbering this engine added, because
// `\d+` can only match the digit run starting at position 0.
const parseNumberedLine = (
  row: string
): { readonly lineNumber: number; readonly text: string } | undefined => {
  const match = /^(\d+): (.*)$/u.exec(row)

  return match?.[1] === undefined || match[2] === undefined
    ? undefined
    : { lineNumber: Number(match[1]), text: match[2] }
}

const parseNumberedContent = (
  numberedContent: string
): ReadonlyMap<number, string> => {
  const byLineNumber = new Map<number, string>()

  for (const row of numberedContent.split('\n')) {
    const parsed = parseNumberedLine(row)

    if (parsed !== undefined) {
      byLineNumber.set(parsed.lineNumber, parsed.text)
    }
  }

  return byLineNumber
}

export type VerifiedCitation = {
  readonly citation: ModelFindingCitation
  // The line the quote actually matched at. Kept separate from
  // `citation.startLine` on purpose: an off-by-a-line citation still verifies
  // (see `CITATION_WINDOW`), and the evidence this mints must record where the
  // quote truly is, not what the model happened to claim.
  readonly matchedLine: number
}

/**
 * Verify one citation deterministically against a file's line-numbered content.
 *
 * Returns `undefined` for anything that does not verify — no quote, no line in
 * range, or a quote that genuinely is not there. The caller (`citationEvidenceFor`)
 * treats every one of those identically to a citation that was never sent; this
 * function has no other failure mode, on purpose (see the module comment above).
 */
export const verifyCitation = (
  citation: ModelFindingCitation,
  numberedContent: string
): VerifiedCitation | undefined => {
  const normalizedQuote = normalizeForComparison(citation.quote)

  if (normalizedQuote.length === 0) {
    return undefined
  }

  const byLineNumber = parseNumberedContent(numberedContent)

  // Pass 1: every window line checked ALONE, closest to the claimed line first.
  // Run to completion before any multi-line join is attempted, deliberately: a
  // quote that genuinely fits on one line must always be attributed to THAT
  // line, never absorbed into an EARLIER anchor's multi-line search merely
  // because concatenating enough trailing lines onto it would also happen to
  // contain the same text. Without this pass ordered first, a citation claiming
  // a line two before the true one could join its way past the true line and
  // report a match starting there instead of where the quote actually is.
  for (const offset of WINDOW_OFFSETS) {
    const anchorText = byLineNumber.get(citation.startLine + offset)

    if (
      anchorText !== undefined &&
      normalizeForComparison(anchorText).includes(normalizedQuote)
    ) {
      return { citation, matchedLine: citation.startLine + offset }
    }
  }

  // Pass 2: no single window line contains the whole quote, so try one that
  // genuinely spans a line break — extend each anchor forward, one line at a
  // time, the way such a quote actually reads. Only forward: a citation names
  // the line its quote STARTS on, so the lines that continue it can only come
  // after that one.
  for (const offset of WINDOW_OFFSETS) {
    const anchorLine = citation.startLine + offset
    const anchorText = byLineNumber.get(anchorLine)

    if (anchorText === undefined) {
      continue
    }

    let joined = anchorText

    for (let extra = 1; extra <= MAX_QUOTE_LINE_SPAN; extra += 1) {
      const nextText = byLineNumber.get(anchorLine + extra)

      if (nextText === undefined) {
        break
      }

      joined = `${joined} ${nextText}`

      if (normalizeForComparison(joined).includes(normalizedQuote)) {
        return { citation, matchedLine: anchorLine }
      }
    }
  }

  return undefined
}

/**
 * Turn a finding's VERIFIED citations into EvidenceRecords.
 *
 * Unverified citations are simply absent from the result — never a rejected
 * finding, a downgraded severity, or a recorded failure of any kind. That is the
 * hard constraint this module exists under: a citation is the model offering
 * PROOF, and proof that does not hold up must leave the finding exactly where it
 * would be if the model had offered none at all. Penalizing a finding for a bad
 * citation would make citing evidence itself a risk worth avoiding, which is
 * backwards for a capability whose entire point is more findings cited, not
 * fewer findings raised.
 */
export const citationEvidenceFor = (
  input: {
    readonly candidateId: string
    // The finding's own location. A citation is verified against THIS file's
    // content; one naming a different `path` is skipped rather than chased into
    // a second lookup, because a quote from a different file proves nothing
    // about a finding located in this one.
    readonly path: string
    readonly citations: readonly ModelFindingCitation[]
    readonly lookup: (path: string) => string | undefined
  }
): readonly EvidenceRecord[] => {
  // Checked before calling `lookup`, not after: `lookup` (`numberedFileContentLookupFor`)
  // builds its whole path->content map on first use, and the common case is a
  // finding with no citations at all. Calling it unconditionally here would
  // undo the laziness that helper exists for on every single candidate.
  if (input.citations.length === 0) {
    return []
  }

  const numberedContent = input.lookup(input.path)

  if (numberedContent === undefined) {
    return []
  }

  const redactor = createRedactor()
  const records: EvidenceRecord[] = []
  const seenIds = new Set<string>()

  for (const citation of input.citations) {
    if (citation.path !== undefined && citation.path !== input.path) {
      continue
    }

    const verified = verifyCitation(citation, numberedContent)

    if (verified === undefined) {
      continue
    }

    // Redacted before the id is derived, so the id is stable for the content
    // this record actually publishes rather than for raw model output nothing
    // downstream ever sees.
    const redactedQuote = redactor.redact(citation.quote)
    // Same `ev_` + 24-hex shape as `refutationEvidenceIdFor` in
    // ../refutation/evidence.ts — one id convention for evidence, not two.
    const id = `ev_${sha256(
      `${input.candidateId}:${input.path}:${verified.matchedLine}:${redactedQuote}`
    ).slice(0, 24)}`

    if (seenIds.has(id)) {
      continue
    }

    seenIds.add(id)
    records.push(
      EvidenceRecordSchema.parse({
        id,
        kind: 'citation',
        summary: truncateForContract(redactedQuote, 500),
        location: {
          path: input.path,
          startLine: verified.matchedLine,
          side: 'file'
        },
        source: 'discovery-citation',
        redactionApplied: true
      })
    )
  }

  return records
}
