// Walking an error's `cause` chain, once, for every predicate that needs it.
//
// A model call in this engine is issued from inside an agent loop, and the loop
// may rewrap whatever it catches. So a predicate that reads only the top-level
// error answers "no" for a genuine, correctly classified failure the moment
// anything wraps it — which is the failure mode that matters here, because every
// caller of such a predicate is deciding whether a failure has a recovery path.
//
// The walk is BOUNDED because a cause chain can be cyclic (an error may be its own
// cause, and `cause` may point back to an ancestor), and an unbounded walk would
// hang the run rather than misclassify one error.
//
// This is deliberately generic and predicate-driven: `context-overflow.ts` and
// `output-truncation.ts` each ask a different question about the same chain, and
// two copies of a bounded cycle-safe walk is exactly the kind of duplication that
// diverges in the depth limit or the cycle guard without anything failing.

const MAX_CAUSE_DEPTH = 10

/**
 * The error and each error in its bounded `cause` chain, outermost first.
 *
 * Non-object values are yielded and then end the walk: `undefined`, `null`, and
 * strings carry no cause, but a caller's predicate still has to be asked about them.
 */
const causeChain = function* (error: unknown): Generator<unknown> {
  let current: unknown = error

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    yield current

    if (typeof current !== 'object' || current === null) {
      return
    }

    const next = (current as { readonly cause?: unknown }).cause

    if (next === undefined || next === current) {
      return
    }

    current = next
  }
}

/** True when `predicate` holds for the error or anything in its cause chain. */
export const someInCauseChain = (
  error: unknown,
  predicate: (candidate: unknown) => boolean
): boolean => {
  for (const candidate of causeChain(error)) {
    if (predicate(candidate)) {
      return true
    }
  }

  return false
}

/**
 * The first error in the chain that `predicate` accepts, or `undefined`.
 *
 * Callers use this when the wrapper is not the error worth REPORTING: a normalizer
 * reading only the outermost error turns a specific, actionable provider failure
 * into a generic one, and the remedy the operator needs is in the inner error.
 */
export const findInCauseChain = (
  error: unknown,
  predicate: (candidate: unknown) => boolean
): unknown => {
  for (const candidate of causeChain(error)) {
    if (predicate(candidate)) {
      return candidate
    }
  }

  return undefined
}
