// "The model stopped writing because it hit the output-token ceiling", recognised
// wherever a caller has to decide what that costs.
//
// WHY THE CODE LIVES HERE RATHER THAN WITH ITS PRODUCER
//
// One module raises it — `guardTruncatedProviderOutput` in provider-resolution,
// which is the seam that installs the ceiling — and another has to recognise it:
// the discovery call failure policy (spec 05), which decides whether a failed
// response costs one response or the whole run. A producer and a consumer each
// holding their own spelling of an error code drift apart silently, and the
// consumer's failure mode is the bad one: it stops recognising the error, the
// error propagates, and one truncated response fails a run that has every other
// task's findings in hand. So the string has exactly one owner and both sides
// import it.
//
// WHY THE CAUSE CHAIN IS WALKED
//
// The guard throws at the provider boundary, but a discovery call runs inside an
// agent loop that may rewrap what it catches — the same reason
// `isContextLengthExceeded` walks the chain, using the same bounded, cycle-safe
// helper.
//
// WHAT THIS DELIBERATELY DOES NOT DO: it does not match provider message text. The
// condition is a structured code this engine raises itself, so there is nothing to
// infer. A provider that reports a truncation some other way is a defect in that
// adapter and surfaces as an ordinary classified failure.

import { findInCauseChain, someInCauseChain } from './cause-chain.js'

/**
 * The structured error code raised when a response's finish reason says generation
 * stopped at the output-token ceiling.
 */
export const PROVIDER_OUTPUT_TRUNCATED_CODE = 'provider_output_truncated'

const hasTruncatedCode = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  (value as { readonly code?: unknown }).code ===
    PROVIDER_OUTPUT_TRUNCATED_CODE

export const isProviderOutputTruncated = (error: unknown): boolean =>
  someInCauseChain(error, hasTruncatedCode)

/**
 * The truncation error itself, unwrapped from whatever caught it, or the original
 * error when it is not a truncation at all.
 *
 * Reporting the WRAPPER loses the whole value of diagnosing this case: the
 * normalizer reads the outermost error, so a wrapped truncation is recorded as a
 * generic `provider_error`, and the operator loses the one remedy that fixes it —
 * raise or unset the output-token ceiling. The code is the actionable part, so it
 * has to survive the agent loop that rewrapped it.
 */
export const providerOutputTruncationOrSelf = (error: unknown): unknown =>
  findInCauseChain(error, hasTruncatedCode) ?? error
