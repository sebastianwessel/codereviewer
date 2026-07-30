// The stated intent, made citable.
//
// Spec 23: "Obligations MUST be extracted from the redacted change-intent
// FRAGMENTS, not from the summarised brief. The brief is a paraphrase, and a
// citation into a paraphrase does not identify where in the stated intent an
// obligation came from." So this module takes spec 11's redacted
// `ContextFragment`s — the same objects the change-intent brief is summarized
// FROM — and turns each into a line-addressed source.
//
// Line addressing is what makes "every obligation cites its source in the stated
// intent" checkable rather than asserted: a model answers with an origin and a
// line number, and this module resolves that pair back to the exact text. An
// obligation whose citation does not resolve is dropped, so no reported
// obligation can carry a citation nobody can follow.

import type { ContextFragment } from '../context-ingestion/index.js'
import type { IntentCitation } from './intent-fulfilment-report.js'

/** One gathered intent fragment, addressed by line. */
export type IntentSource = {
  /** Spec 11's stable origin label, e.g. `inbox:jira/PROJ-123`. */
  readonly origin: string
  readonly title?: string
  /** The redacted fragment body, split into lines. Index 0 is line 1. */
  readonly lines: readonly string[]
}

// Blank lines are kept so line numbers stay faithful to the fragment the user
// wrote; a citation that pointed at a blank line would be resolvable but useless,
// and `resolveIntentCitation` rejects those below.
const splitLines = (body: string): readonly string[] =>
  body.split(/\r\n|\n|\r/u)

/**
 * Converts redacted change-intent fragments into line-addressed sources, bounded
 * by a total byte budget.
 *
 * The budget is applied fragment by fragment in gather order: a fragment that
 * would exceed it is truncated at a line boundary, and the ones after it are
 * dropped. Truncating on a line boundary rather than mid-line matters here in a
 * way it does not for the brief — a half line is still a citable line number, and
 * an obligation extracted from half a sentence would cite text the author never
 * wrote.
 */
export const toIntentSources = (
  fragments: readonly ContextFragment[],
  maxBytes: number
): { readonly sources: readonly IntentSource[]; readonly truncated: boolean } => {
  const sources: IntentSource[] = []
  let remaining = maxBytes
  let truncated = false

  for (const fragment of fragments) {
    if (remaining <= 0) {
      truncated = true
      break
    }

    const kept: string[] = []

    for (const line of splitLines(fragment.body)) {
      const cost = Buffer.byteLength(line, 'utf8') + 1

      if (cost > remaining) {
        truncated = true
        break
      }

      remaining -= cost
      kept.push(line)
    }

    if (kept.length > 0) {
      sources.push({
        origin: fragment.origin,
        ...(fragment.title === undefined ? {} : { title: fragment.title }),
        lines: kept
      })
    }
  }

  return { sources, truncated }
}

/**
 * Resolves an origin/line pair against the gathered sources.
 *
 * Returns `undefined` for an unknown origin, an out-of-range line, and a line
 * that is blank once trimmed. All three are the same failure from the reader's
 * point of view: there is nothing at that address to read, so the obligation
 * claiming it has no source in the stated intent.
 */
export const resolveIntentCitation = (
  sources: readonly IntentSource[],
  origin: string,
  line: number
): IntentCitation | undefined => {
  if (!Number.isInteger(line) || line < 1) {
    return undefined
  }

  const source = sources.find((candidate) => candidate.origin === origin)
  const text = source?.lines[line - 1]

  if (source === undefined || text === undefined || text.trim().length === 0) {
    return undefined
  }

  return { origin: source.origin, line, text: text.trim() }
}
