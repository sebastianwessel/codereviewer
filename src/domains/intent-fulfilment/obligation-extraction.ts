// Step 1 of spec 23: turn the stated intent into a list of discrete, checkable
// obligations, each carrying the line it was read out of.
//
// This is EXTRACTION, not judgement. It is asked what the intent says, never
// whether the change satisfies it, and it never sees the change at all — the
// packet below carries the intent sources and nothing else. That separation is
// what lets the judgement schema in `judgement.ts` be free-text-free: an
// obligation's prose is written here, before any verdict exists to justify.
//
// The packet is untrusted data. Anyone who can open a pull request or edit a
// ticket writes it (spec 11's trust boundary), and the instructions say so.

import { z } from 'zod'
import { truncateForContract } from '../../shared/text/truncate.js'
import { OBLIGATION_STATEMENT_MAX } from './intent-fulfilment-report.js'
import type { IntentSource } from './intent-sources.js'

// The model-bound OUTPUT schema, loose on purpose: `line` accepts whatever a
// model spells a number as, and nothing is constrained beyond the shape. Rich
// model-bound schemas took this engine's provider error rate from 0% to 28.8%,
// so the authority lives in the normalizer below and in citation resolution, not
// in provider-side validation.
export const ModelObligationExtractionSchema = z.strictObject({
  obligations: z
    .array(
      z.strictObject({
        origin: z.string(),
        line: z.coerce.number(),
        statement: z.string()
      })
    )
    .optional()
})

// FIELD ORDER IS LOAD-BEARING: the serialized packet's shared prefix is what a
// provider could cache. Nothing per-run unique appears anywhere.
export const ObligationExtractionInputSchema = z.strictObject({
  maxObligations: z.int().min(1),
  sources: z
    .array(
      z.strictObject({
        origin: z.string().min(1),
        title: z.string().optional(),
        // Line-numbered, because the answer has to name a line. Handing the model
        // a numbered list is the difference between a citation it can produce and
        // one it has to count out.
        lines: z.array(
          z.strictObject({ line: z.int().min(1), text: z.string() })
        )
      })
    )
    .min(1)
})

export type ObligationExtractionInput = z.infer<
  typeof ObligationExtractionInputSchema
>

export type ObligationExtractionRunner = (
  input: ObligationExtractionInput,
  signal: AbortSignal | undefined
) => Promise<ExtractedObligation[]>

/** One obligation as the model stated it, before its citation is resolved. */
export type ExtractedObligation = {
  readonly origin: string
  readonly line: number
  readonly statement: string
}

// Longer than this and the "single checkable statement" is a paragraph. Truncated
// rather than dropped: the citation is what makes the entry usable, and it
// survives truncation.
//
// The cut is MARKED, through the shared helper, because this string is the bold
// headline of every obligation row in `intent-markdown.ts`. A bare slice ends the
// headline mid-clause — "Reject tokens older than five minutes unless the caller
// holds" — and a reader has no way to tell that from an obligation the extraction
// genuinely stated that way, so they judge the change against half a requirement.

/** Builds the extraction packet from the line-addressed intent sources. */
export const obligationExtractionInputFor = (
  sources: readonly IntentSource[],
  maxObligations: number
): ObligationExtractionInput =>
  ObligationExtractionInputSchema.parse({
    maxObligations,
    sources: sources.map((source) => ({
      origin: source.origin,
      ...(source.title === undefined ? {} : { title: source.title }),
      lines: source.lines.map((text, index) => ({ line: index + 1, text }))
    }))
  })

/**
 * Resolves whatever the extraction returned into well-formed obligations.
 *
 * Entries with an empty statement or a non-integer line are dropped here; entries
 * whose origin/line pair does not resolve against the sources are dropped by the
 * run, which owns the sources. Both are the same rule stated at the two places
 * that can check it: an obligation with no readable source in the stated intent
 * is not reported.
 */
export const normalizeObligationExtraction = (
  value: unknown
): readonly ExtractedObligation[] => {
  const parsed = ModelObligationExtractionSchema.safeParse(value)

  if (!parsed.success) {
    return []
  }

  return (parsed.data.obligations ?? []).flatMap((obligation) => {
    const statement = truncateForContract(
      obligation.statement.trim(),
      OBLIGATION_STATEMENT_MAX
    )
    const line = Math.trunc(obligation.line)
    const origin = obligation.origin.trim()

    if (statement.length === 0 || origin.length === 0 || line < 1) {
      return []
    }

    return [{ origin, line, statement }]
  })
}
