// The three input limits, and why they FAIL rather than truncate.
//
// This capability shipped with silent truncation on all three. Each one produced a
// plausible-looking report from an input it had only partly seen:
//
//   maxChangeLines bounded the evidence a judgement may draw from, so a judgement
//   that could not see the evidence reported the obligation NOT-EVIDENCED. Measured
//   over this repository's last 60 commits, 43% change more than the 400 lines the
//   default allowed. Wrong answers, on the capability's only question, on nearly
//   half of real changes.
//
//   maxObligations bounded the checklist. On a 28-case corpus, 24 runs returned
//   exactly the cap, so the "what is left" list was cut short — under-reporting
//   outstanding work, which is the one direction this capability must not err in.
//
//   maxIntentBytes bounded the stated intent itself, so obligations were extracted
//   from part of a ticket while the report named none of that.
//
// Raising the values fixed the symptom. It did not fix the mechanism: a limit that
// truncates answers a question it was not able to answer, and the caller cannot
// tell that from a genuine result. THE MECHANISM IS THE DEFECT.
//
// The correct pattern already existed in this codebase and was not used here.
// `packet-budget.ts` refuses an oversized packet outright:
//
//   "Review task packet exceeds the configured provider input budget. The packet
//    was NOT TRUNCATED; split the review scope further or increase the provider
//    task budget."
//
// Code, category, exit code, and an actionable recovery. No cleverness, nothing
// hidden. These three now do the same.
//
// WHY THIS DOES NOT CONFLICT WITH "ADVISORY". Spec 23 forbids failing a pipeline
// ON FULFILMENT GROUNDS — the command must never exit non-zero because a change did
// not satisfy its intent. Refusing to run on an input it cannot fully see is a
// different thing, and is the same class as the configuration and repository errors
// this command already exits on. A run that cannot produce a trustworthy answer must
// say so rather than produce an untrustworthy one.
//
// The referenced-definition caps in `review-workflow` are deliberately NOT changed
// to match. That context is best-effort enrichment which the reviewer works without
// by design, so dropping some of it degrades a result rather than invalidating it —
// it needs to be VISIBLE, which it now is, not fatal.
//
// NOR IS THE PROVIDER'S PER-FILE CAP TURNED INTO A FOURTH REFUSAL, and that call is
// deliberate. `contextSources` providers cut a body at `maxFileBytes`, which
// DEFAULTS TO 64 000 — below `maxIntentBytes`'s own 100 000 default. Refusing on it
// would mean an 80 KB ticket, which spec 23 sized this capability to read, stops the
// run against a knob spec 23 does not own and never chose; spec 23 calls a limit
// that binds on ordinary input "the same defect wearing an error message". So that
// loss is DISCLOSED instead — on `scope.intentTruncated`, in a warning, and in the
// rendered report above the obligation list — which is the third of the three
// honest answers to a bound that binds. The run still refuses when the SUM exceeds
// `maxIntentBytes`, and says then that the figure it measured is a floor.

import {
  createStructuredError,
  type StructuredError
} from '../../shared/errors/error-normalizer.js'

// The schema ceilings from `IntentFulfilmentConfigSchema`. They are restated here
// rather than read off the zod object because zod's internal check shape is not a
// stable API; `intent-limits.test.ts` pins each one against the schema, so a
// ceiling that moves fails a test instead of quietly producing wrong advice again.
//
// WHY THIS MATTERS. Every one of these errors used to end with "Raise the limit in
// intentFulfilment", and for two of the three that is impossible: `maxObligations`
// and `maxChangeLines` DEFAULT to their ceiling, so an operator hitting them on a
// default configuration has no higher value to set. Advice that cannot work is
// worse than none — it sends someone editing a setting instead of doing the thing
// that would actually let the run finish.
const MAX_OBLIGATIONS_CEILING = 100
const MAX_INTENT_BYTES_CEILING = 200_000
const MAX_CHANGE_LINES_CEILING = 5_000

// Recovery advice that depends on whether headroom is left. Below the ceiling,
// raising the limit is the cheap fix and is offered first; AT the ceiling it is not
// offered at all, and the only remedy that can work is the one that shrinks the
// input.
const recoveryFor = (input: {
  readonly key: 'maxObligations' | 'maxIntentBytes' | 'maxChangeLines'
  readonly configured: number
  readonly ceiling: number
  readonly reduceInput: string
}): string =>
  input.configured < input.ceiling
    ? `Nothing was truncated. Raise intentFulfilment.${input.key} ` +
      `(up to ${input.ceiling}), or ${input.reduceInput}.`
    : `Nothing was truncated. intentFulfilment.${input.key} is already at its ` +
      `maximum (${input.ceiling}) and cannot be raised, so ${input.reduceInput}.`

export const intentChangeTooLargeError = (input: {
  readonly changedLineCount: number
  readonly maxChangeLines: number
}): StructuredError =>
  createStructuredError({
    code: 'intent_change_too_large',
    message:
      `The change has more citable lines (${input.changedLineCount}) than ` +
      `intentFulfilment.maxChangeLines allows (${input.maxChangeLines}). ` +
      'Judging it against part of the change would report obligations as ' +
      'not-evidenced whose evidence was simply not shown. ' +
      recoveryFor({
        key: 'maxChangeLines',
        configured: input.maxChangeLines,
        ceiling: MAX_CHANGE_LINES_CEILING,
        reduceInput:
          'check a smaller change: narrow the base/head range to fewer commits, ' +
          'or split the change into separately reviewable ones'
      }),
    category: 'config',
    recoverable: true,
    exitCode: 4,
    details: {
      changedLineCount: input.changedLineCount,
      maxChangeLines: input.maxChangeLines
    }
  })

export const intentTooLargeError = (input: {
  readonly intentBytes: number
  readonly maxIntentBytes: number
  // Set when at least one gathered body had ALREADY been cut by its
  // `contextSources` provider. `intentBytes` is summed over the bodies this
  // command was handed, so those bodies understate the intent they stand for and
  // the total is a floor rather than the size. Stating it as the size would send
  // an operator to raise `maxIntentBytes` to a value the real intent still does
  // not fit under, and the second run would refuse for the same reason.
  readonly intentBytesIsLowerBound?: boolean
}): StructuredError =>
  createStructuredError({
    code: 'intent_text_too_large',
    message:
      `The stated intent is larger (${input.intentBytesIsLowerBound === true ? 'at least ' : ''}${input.intentBytes} bytes) than ` +
      `intentFulfilment.maxIntentBytes allows (${input.maxIntentBytes}). ` +
      'Extracting obligations from part of it would produce a checklist missing ' +
      'requirements the intent states. ' +
      (input.intentBytesIsLowerBound === true
        ? 'That size is a lower bound: a contextSources provider had already cut ' +
          'at least one source at its own maxFileBytes cap, so the stated intent ' +
          'is larger than the figure above. '
        : '') +
      recoveryFor({
        key: 'maxIntentBytes',
        configured: input.maxIntentBytes,
        ceiling: MAX_INTENT_BYTES_CEILING,
        reduceInput:
          'hand in less stated intent: point contextSources at fewer providers, ' +
          'or at the section under review rather than the whole document'
      }),
    category: 'config',
    recoverable: true,
    exitCode: 4,
    details: {
      intentBytes: input.intentBytes,
      intentBytesIsLowerBound: input.intentBytesIsLowerBound === true,
      maxIntentBytes: input.maxIntentBytes
    }
  })

export const tooManyObligationsError = (input: {
  readonly obligationCount: number
  readonly maxObligations: number
}): StructuredError =>
  createStructuredError({
    code: 'intent_too_many_obligations',
    message:
      `The stated intent yielded at least as many obligations ` +
      `(${input.obligationCount}) as intentFulfilment.maxObligations allows ` +
      `(${input.maxObligations}). Reporting the first ${input.maxObligations} ` +
      'would under-report what is left, which is the one direction this command ' +
      'must not err in. ' +
      recoveryFor({
        key: 'maxObligations',
        configured: input.maxObligations,
        ceiling: MAX_OBLIGATIONS_CEILING,
        reduceInput:
          'check the change against a smaller slice of the stated intent: point ' +
          'contextSources at the section under review rather than the whole ' +
          'document, and run the remaining sections separately'
      }),
    category: 'config',
    recoverable: true,
    exitCode: 4,
    details: {
      obligationCount: input.obligationCount,
      maxObligations: input.maxObligations
    }
  })
