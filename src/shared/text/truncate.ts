// Shared truncation for model-authored text that crosses into a length-capped
// contract field. Reuse this at every model->contract boundary instead of inline
// `.slice(0, n)` copies so a model summary that exceeds a destination cap cannot
// fail schema validation (the source of past `provider_error`-masked failures).

// Appended in place of what was cut. It is reserved INSIDE `maxLength`, so the
// result still satisfies the destination's `.max(n)`.
//
// A markerless cut is the failure this exists to prevent: it reads as a complete
// statement that happens to end abruptly. The consumers here cannot tell the
// difference on their own — an investigating model reads a claim `detail` cut
// mid-sentence as the whole claim, and a human reading `RejectedFinding.message`
// is reading the REASON A FINDING WAS SUPPRESSED, sourced from a 1200-character
// field cut to 500, so losing the end of it is routine rather than exotic.
//
// One character, not `[truncated]`: this is spent out of the destination's own
// budget, so a longer mark buys disclosure by deleting more of the text it is
// disclosing about.
export const TRUNCATION_MARK = '…'

// Deliberately NOT escape-aware, unlike `clampEscaped` in
// `domains/reporting/review-comments.ts`. That helper cuts text that has already
// been Markdown-escaped, where half of `&amp;` or a dangling `\` changes what
// renders; the values here — claim detail and question, verdict rationale,
// refutation and rejection summaries, a matched line of source — are raw and are
// consumed as raw, so there is no escape to land inside.
export const truncateForContract = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value
  }

  // A cap too small to hold the mark still has to be honoured; the contract bound
  // wins over the disclosure it cannot fit.
  if (maxLength <= TRUNCATION_MARK.length) {
    return TRUNCATION_MARK.slice(0, Math.max(maxLength, 0))
  }

  return `${value.slice(0, maxLength - TRUNCATION_MARK.length).trimEnd()}${TRUNCATION_MARK}`
}

// A Zod string field, possibly wrapped in `.optional()`, whose `.max(n)` is the
// bound its value must satisfy.
export type BoundedStringField = {
  readonly maxLength?: number | null
  readonly unwrap?: () => { readonly maxLength?: number | null }
}

/**
 * Truncate a value to the bound its DESTINATION FIELD declares.
 *
 * Prefer this over `truncateForContract` wherever the destination is a schema
 * field. Passing a number means the number exists twice — once in the schema and
 * once at the call site — and the two drift apart silently, because nothing fails
 * when the copy is merely SMALLER than the contract. Four such copies existed:
 * `FIX_PROPOSAL_SUMMARY_MAX`, and three claim caps declared once in each of two
 * providers. Every one of them happened to be correct, which is what makes the
 * shape worth removing rather than auditing.
 *
 * Here the number exists once, in the schema, and the call site names the field
 * instead of restating its size.
 */
export const truncateToFieldBound = (
  value: string,
  field: BoundedStringField
): string => truncateForContract(value, stringFieldBound(field))

/**
 * The `max(n)` a Zod string field declares, unwrapping `.optional()`.
 *
 * Throws when the field declares none. The earlier version of this returned
 * `Number.POSITIVE_INFINITY`, which meant "truncate this to its field's bound"
 * quietly did not truncate when the field had no bound — a limit failing to bind
 * and producing a plausible result instead of an error, which is the exact shape
 * this codebase keeps finding. A caller asking for a bound that does not exist
 * has made a programming error and should be told, at the first call.
 */
export const stringFieldBound = (field: BoundedStringField): number => {
  const declared =
    typeof field.maxLength === 'number'
      ? field.maxLength
      : field.unwrap?.()?.maxLength

  if (typeof declared !== 'number') {
    throw new TypeError(
      'truncateToFieldBound was given a schema field that declares no maximum length. Add a `.max(n)` to the field, or use `truncateForContract` with an explicit bound.'
    )
  }

  return declared
}
