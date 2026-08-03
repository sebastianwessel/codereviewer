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
