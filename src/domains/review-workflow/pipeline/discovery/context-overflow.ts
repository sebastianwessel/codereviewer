// Detects "the provider refused this packet as too large", provider-agnostically.
//
// Spec 26 makes this the ONLY trigger for splitting a review task. The whole design
// depends on asking the provider instead of guessing: a byte budget chosen in advance
// is wrong by a content-dependent factor (bytes are a poor proxy for tokens), and it
// fired on 37% of this repository's last 60 commits while the real limits are an
// order of magnitude further out.
//
// `@purista/harness` normalises this case for us. `ModelError` carries a `reason`,
// and `context_length_exceeded` is one of its declared values — a first-class part of
// the harness error contract, not something inferred here.
//
// WHY THERE IS NO MESSAGE MATCHING HERE, DELIBERATELY
//
// It would be easy to also match /context length|too many tokens|maximum context/ and
// catch a provider whose adapter forgot to classify. Spec 26 forbids it, and the ban
// is the point: provider message text differs per vendor and changes without notice,
// so matching it would reintroduce a guess in the one place this design exists to
// remove one — and it would do so invisibly, succeeding just often enough to hide
// that an adapter is broken. An adapter that fails to map its overflow onto
// `context_length_exceeded` is a defect in THAT adapter. It then surfaces here as an
// ordinary classified model error: loud, specific, and attributable.

// The harness raises `ModelError` at the provider boundary, but a discovery call runs
// inside an agent loop that may rewrap what it catches. Reading only the top-level
// error would therefore miss a genuine overflow whenever the loop wrapped it, so the
// cause chain is walked. The chain is bounded because a cyclic `cause` is possible
// (an error may be its own cause) and an unbounded walk would hang the run.
const MAX_CAUSE_DEPTH = 10

const overflowReason = 'context_length_exceeded'

const hasOverflowReason = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  (value as { readonly reason?: unknown }).reason === overflowReason

export const isContextLengthExceeded = (error: unknown): boolean => {
  let current: unknown = error

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (hasOverflowReason(current)) {
      return true
    }

    if (typeof current !== 'object' || current === null) {
      return false
    }

    const next = (current as { readonly cause?: unknown }).cause

    if (next === undefined || next === current) {
      return false
    }

    current = next
  }

  return false
}
