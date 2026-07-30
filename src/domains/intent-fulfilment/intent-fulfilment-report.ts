// The intent-fulfilment MAPPING report.
//
// Spec 23's design is three steps — extract obligations, map each to evidence in
// the change or to nothing, report the mapping — and the third step is stated as
// "Report the mapping, NOT a verdict". So there is no `findings`, no `severity`,
// no `passed`, no `qualityGate` and no `blocking` anywhere below, and `intent
// check` always exits 0. Spec 23 makes that a requirement rather than a default:
// the command "MUST NOT be able to fail a pipeline on fulfilment grounds. This is
// not configurable", because published measurement puts spurious rejection of
// model requirement-conformance judgement at 26-36%, rising to 73-88% when the
// same call also justifies itself.
//
// Two shapes below are load-bearing rather than stylistic.
//
// ADDRESSED IMPLIES EVIDENCE. `ObligationSchema` is a discriminated union in
// which only the `addressed` member has an `evidence` array, and that array has a
// minimum length of one. An obligation reported as addressed therefore CANNOT be
// written without a path and a line, at the schema level, rather than by a filter
// somebody has to remember to apply. Spec 23 names the unevidenced satisfaction
// claim as the single most harmful output this capability can produce, "because
// that stops a human looking".
//
// EVERY OBLIGATION CARRIES ITS SOURCE. `source` is required on every member of
// the union, including `unaddressed` and `undetermined`. Spec 23: "An obligation
// the reviewer inferred rather than read is not an obligation." The citation is
// resolved from the fragment by this domain, not copied from the model's answer,
// so `source.text` is the author's own line.

import { z } from 'zod'
import { RepositoryRelativePathSchema } from '../../shared/contracts/index.js'

// A line of the STATED INTENT, resolved from the redacted change-intent fragment
// the obligation was read out of (spec 11's origin label plus a line number).
export const IntentCitationSchema = z.strictObject({
  origin: z.string().min(1),
  line: z.int().min(1),
  text: z.string().min(1)
})

// A line of the CHANGE. Path and line are required: spec 23 asks for both, and a
// path alone would let "addressed" point at a whole file.
//
// `side` is required too, per spec 23's 2026-07-30 amendment. A removed line is
// numbered on the PRE-change side, so without the side a reader cannot tell
// "done, this deleted line 42" from "done, this added line 42" — two different
// lines, and the amendment makes disclosing which a MUST rather than a nicety.
export const ChangeCitationSchema = z.strictObject({
  path: RepositoryRelativePathSchema,
  line: z.int().min(1),
  side: z.enum(['added', 'removed']),
  text: z.string().min(1)
})

export const ObligationStatusSchema = z.enum([
  // The change contains something that addresses this obligation, and the lines
  // that do are cited.
  'addressed',
  // Nothing in the change addresses it. Reported neutrally: a pull request need
  // not fully implement a ticket, and partial work is normal.
  'unaddressed',
  // The material did not permit a decision. A real answer, and the value every
  // unusable judgement resolves to.
  'undetermined'
])

const obligationBase = {
  id: z.string().min(1),
  // Where in the stated intent this obligation came from.
  source: IntentCitationSchema,
  // The obligation as a single checkable statement.
  statement: z.string().min(1)
}

export const ObligationSchema = z.discriminatedUnion('status', [
  z.strictObject({
    ...obligationBase,
    status: z.literal('addressed'),
    // At least one, always. See the header: this is the whole reason the entry is
    // a union member rather than an optional field.
    evidence: z.array(ChangeCitationSchema).min(1)
  }),
  z.strictObject({ ...obligationBase, status: z.literal('unaddressed') }),
  z.strictObject({ ...obligationBase, status: z.literal('undetermined') })
])

// Changed files no obligation's evidence cites.
//
// Spec 23: "Extra scope is reported neutrally. A change doing more than the
// ticket asked is a normal and often desirable event, not a defect." There is
// therefore nowhere here to record a severity, a verdict, or a question — only
// the path and how much of it changed.
export const ExtraScopeEntrySchema = z.strictObject({
  path: RepositoryRelativePathSchema,
  changedLineCount: z.int().min(1)
})

export const IntentFulfilmentSummarySchema = z.strictObject({
  intentFragmentCount: z.int().min(0),
  obligationCount: z.int().min(0),
  addressedCount: z.int().min(0),
  unaddressedCount: z.int().min(0),
  undeterminedCount: z.int().min(0),
  // Bounded by `intentFulfilment.maxObligations`.
  obligationsTruncated: z.boolean(),
  // Obligations the extraction proposed whose citation did not resolve to a line
  // of the stated intent, and which were therefore not reported at all. Counted
  // rather than hidden: an extraction that mostly invents its sources should be
  // visible in the report it produced.
  uncitedObligationCount: z.int().min(0),
  // Obligations a judgement called addressed while citing no line the change
  // actually touched. They are reported as `undetermined`, and counted here so
  // the downgrade is visible. This is the metric spec 23 says decides whether the
  // capability is safe to show anyone.
  unevidencedAddressedCount: z.int().min(0),
  // Spec 23's Second Amendment: addressed verdicts whose citations were judged
  // positively inapt and downgraded to undetermined. Separate from
  // `unevidencedAddressedCount` because the two catch different failures — that one
  // a citation the change does not contain, this one a citation it DOES contain
  // that is not evidence for the obligation. Defaulted so a report written before
  // the amendment still parses.
  inaptCitationCount: z.int().min(0).default(0),
  extraScopeFileCount: z.int().min(0)
})

export const IntentFulfilmentUsageSchema = z.strictObject({
  inputTokens: z.int().min(0),
  outputTokens: z.int().min(0),
  // A SUBSET of `inputTokens`, already counted there.
  cachedInputTokens: z.int().min(0).optional(),
  reasoningTokens: z.int().min(0).optional(),
  costUsd: z.number().min(0).optional()
})

export const IntentFulfilmentReportSchema = z.strictObject({
  schemaVersion: z.literal('1.0'),
  // Four of the five outcomes are "the command ran and there is nothing to map",
  // and they are separate values rather than one empty report because spec 23
  // requires absent or unusable intent to be reported PLAINLY. Every one of them
  // exits 0.
  status: z.enum([
    'completed',
    // `intentFulfilment.enabled` is false.
    'disabled',
    // No change-intent fragment was gathered. Most changes have thin
    // descriptions, and this is the ordinary case rather than an error.
    'no-intent',
    // Intent was gathered, but no obligation could be read out of it.
    'unusable-intent',
    // Intent was gathered and no model was available to read it.
    'provider-unavailable'
  ]),
  generatedAt: z.iso.datetime(),
  scope: z.strictObject({
    baseRef: z.string().min(1),
    headRef: z.string().min(1),
    mergeBaseRef: z.string().min(1).optional(),
    changedFileCount: z.int().min(0),
    // The lines a judgement was allowed to cite, and whether the bound cut them.
    changedLineCount: z.int().min(0),
    changedLinesTruncated: z.boolean(),
    // Which change-intent sources the obligations were read from, by spec 11's
    // origin label.
    intentOrigins: z.array(z.string().min(1)),
    intentTruncated: z.boolean()
  }),
  summary: IntentFulfilmentSummarySchema,
  obligations: z.array(ObligationSchema),
  extraScope: z.array(ExtraScopeEntrySchema),
  // Written by a SEPARATE model call that reads the already-frozen mapping above
  // and cannot change it (spec 23: judgement, explanation and any suggested
  // follow-up must not share one model call). Absent when the explanation call
  // did not run or returned nothing usable — the mapping is the output, and the
  // prose is a convenience over it.
  explanation: z.string().min(1).max(2_000).optional(),
  warnings: z.array(z.string()),
  usage: IntentFulfilmentUsageSchema.optional()
})

export type IntentCitation = z.infer<typeof IntentCitationSchema>
export type ChangeCitation = z.infer<typeof ChangeCitationSchema>
export type ObligationStatus = z.infer<typeof ObligationStatusSchema>
export type Obligation = z.infer<typeof ObligationSchema>
export type ExtraScopeEntry = z.infer<typeof ExtraScopeEntrySchema>
export type IntentFulfilmentSummary = z.infer<
  typeof IntentFulfilmentSummarySchema
>
export type IntentFulfilmentUsage = z.infer<typeof IntentFulfilmentUsageSchema>
export type IntentFulfilmentReport = z.infer<typeof IntentFulfilmentReportSchema>
