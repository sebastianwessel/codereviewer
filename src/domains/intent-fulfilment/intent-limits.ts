// The three input limits, and why they FAIL rather than truncate.
//
// This capability shipped with silent truncation on all three. Each one produced a
// plausible-looking report from an input it had only partly seen:
//
//   maxChangeLines bounded the evidence a judgement may draw from, so a judgement
//   that could not see the evidence reported the obligation UNADDRESSED. Measured
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

import {
  createStructuredError,
  type StructuredError
} from '../../shared/errors/error-normalizer.js'

const RECOVERY =
  'Nothing was truncated. Raise the limit in intentFulfilment, or reduce the input.'

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
      `unaddressed whose evidence was simply not shown. ${RECOVERY}`,
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
}): StructuredError =>
  createStructuredError({
    code: 'intent_text_too_large',
    message:
      `The stated intent is larger (${input.intentBytes} bytes) than ` +
      `intentFulfilment.maxIntentBytes allows (${input.maxIntentBytes}). ` +
      'Extracting obligations from part of it would produce a checklist missing ' +
      `requirements the intent states. ${RECOVERY}`,
    category: 'config',
    recoverable: true,
    exitCode: 4,
    details: {
      intentBytes: input.intentBytes,
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
      `must not err in. ${RECOVERY}`,
    category: 'config',
    recoverable: true,
    exitCode: 4,
    details: {
      obligationCount: input.obligationCount,
      maxObligations: input.maxObligations
    }
  })
