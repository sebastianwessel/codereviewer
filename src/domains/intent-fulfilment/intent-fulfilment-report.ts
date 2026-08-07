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
// EVIDENCED IMPLIES EVIDENCE. `ObligationSchema` is a discriminated union in
// which only the `evidenced` member has an `evidence` array, and that array has a
// minimum length of one. An obligation reported as evidenced therefore CANNOT be
// written without a path and a line, at the schema level, rather than by a filter
// somebody has to remember to apply. Spec 23 names the unevidenced satisfaction
// claim as the single most harmful output this capability can produce, "because
// that stops a human looking".
//
// EVERY OBLIGATION CARRIES ITS SOURCE. `source` is required on every member of
// the union, including `not-evidenced` and `undetermined`. Spec 23: "An obligation
// the reviewer inferred rather than read is not an obligation." The citation is
// resolved from the fragment by this domain, not copied from the model's answer,
// so `source.text` is the author's own line.

import { z } from 'zod'
import { RepositoryRelativePathSchema } from '../../shared/contracts/index.js'
import { LaneUsageSchema } from '../costs/lane-usage.js'

// A line of the STATED INTENT, resolved from the redacted change-intent fragment
// the obligation was read out of (spec 11's origin label plus a line number).
export const IntentCitationSchema = z.strictObject({
  origin: z.string().min(1),
  line: z.int().min(1),
  text: z.string().min(1)
})

// A line of the CHANGE. Path and line are required: spec 23 asks for both, and a
// path alone would let "evidenced" point at a whole file.
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

// WHY THESE WORDS, AND NOT `addressed`/`unaddressed`.
//
// The judgement is shown ONLY the changed lines, so the question it can answer is
// "do these lines evidence this obligation?" and never "does the obligation hold
// at head?". The two are different questions, and the old labels answered the
// second one in a reader's head: `unaddressed` reads as "you did not do this",
// while what the call actually established is "there is nothing here that shows
// you did".
//
// That gap was measured, not supposed. On the 2026-08-01 realistic corpus, 54 of
// this lane's 83 false positives were obligations the judgement had reported
// CORRECTLY — nothing in the change evidenced them — which a reader and the
// eval's answer key both read as a claim that the work was undone. 65% of the
// lane's false positives were the words on the answer rather than the answer.
//
// The eval answer keys keep `addressed`/`unaddressed`, because they label TRUTH:
// whether the state holds at head. Those are the right words for that question,
// and the collision was that one word was being used for both.
export const ObligationStatusSchema = z.enum([
  // The changed lines contain something that does what the obligation asks, and
  // the lines that do are cited.
  'evidenced',
  // Nothing among the changed lines does what the obligation asks. Reported
  // neutrally, and it asserts nothing about the rest of the repository: a pull
  // request need not fully implement a ticket, partial work is normal, and an
  // obligation already satisfied elsewhere leaves no evidence in THIS change.
  'not-evidenced',
  // The obligation asks that something NOT be done — that something never happen,
  // or that something be left as it is — and nothing among the changed lines does
  // that thing. There is no line to cite, because what compliance with a
  // prohibition looks like in a diff is an absence.
  //
  // A FOURTH STATUS RATHER THAN A NOTE ON `not-evidenced`, and the reason is
  // measured. Of the 83 false positives classified on the 2026-08-01 realistic
  // corpus, 33 — 39.8%, the largest single mode — were obligations of exactly this
  // shape. Under a three-status vocabulary the only answer available for them was
  // `not-evidenced`, so a prohibition the change never went near landed on the
  // headline outstanding list on every run, forever: a false alarm by
  // construction rather than a judgement that got something wrong.
  //
  // WHAT IT DOES NOT CLAIM, which is why it is named for what was searched for
  // rather than for a state of the world:
  //   - it does NOT say the obligation holds at head. Code this run never saw can
  //     break a prohibition, and this verdict is drawn only from the changed lines;
  //   - it does NOT say the change UPHELD the obligation. A change that puts the
  //     restriction in place is `evidenced` and cites the line that does it. A
  //     change that merely never went near the subject is this. The two are
  //     different claims and the vocabulary must not blur them;
  //   - it is not available to an obligation asking for work to be carried out.
  //     Absence of a change is compliance only where the obligation asked for
  //     absence.
  'not-contradicted',
  // The material did not permit a decision. A real answer, and the value every
  // unusable judgement resolves to.
  'undetermined'
])

// Exported so the extraction that PRODUCES an obligation cuts to the same bound
// the contract enforces, instead of restating the number. The bound was
// previously enforced only by the producer — the contract accepted any length —
// so the two could not disagree loudly, only quietly.
export const OBLIGATION_STATEMENT_MAX = 300

// Same reason, for the prose summary the explanation call produces.
export const INTENT_EXPLANATION_MAX = 2_000

const obligationBase = {
  id: z.string().min(1),
  // Where in the stated intent this obligation came from.
  source: IntentCitationSchema,
  // The obligation as a single checkable statement. Bounded because it is
  // rendered as the bold headline of every row: an unbounded statement is a
  // paragraph where the reader expects a sentence.
  statement: z.string().min(1).max(OBLIGATION_STATEMENT_MAX)
}

// Keyed by status and constrained to `Record<ObligationStatus, …>`, so a fifth
// member added to the enum is a compile error here rather than a status the
// contract silently refuses to parse. The keys cannot be dropped in favour of a
// mapped construction: only `evidenced` carries evidence, and that asymmetry is the
// whole reason this is a union and not one object with an optional field.
const obligationVariants = {
  evidenced: z.strictObject({
    ...obligationBase,
    status: z.literal('evidenced'),
    // At least one, always. See the header: this is the whole reason the entry is
    // a union member rather than an optional field.
    evidence: z.array(ChangeCitationSchema).min(1)
  }),
  'not-evidenced': z.strictObject({
    ...obligationBase,
    status: z.literal('not-evidenced')
  }),
  // No `evidence` field, and its absence is the point rather than an omission:
  // there is no line to cite when what satisfies the obligation is that nothing
  // was done. A slot here would invite one to be invented.
  'not-contradicted': z.strictObject({
    ...obligationBase,
    status: z.literal('not-contradicted')
  }),
  undetermined: z.strictObject({
    ...obligationBase,
    status: z.literal('undetermined')
  })
} satisfies Record<ObligationStatus, z.ZodObject>

type ObligationVariant = (typeof obligationVariants)[ObligationStatus]

// The union's members are looked up FROM THE ENUM rather than listed again, so the
// enum is the only place a status is declared: adding one there forces a variant
// above (the `Record`) and puts it in the union here with no third edit. The
// assertion narrows an array to the non-empty tuple `discriminatedUnion` requires
// and says nothing about the element type — the enum cannot be empty.
const obligationVariantsByStatus = ObligationStatusSchema.options.map(
  (status) => obligationVariants[status]
) as [ObligationVariant, ...ObligationVariant[]]

export const ObligationSchema = z.discriminatedUnion(
  'status',
  obligationVariantsByStatus
)

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

const IntentFulfilmentSummarySchema = z.strictObject({
  intentFragmentCount: z.int().min(0),
  obligationCount: z.int().min(0),
  // The four status tallies, one per member of `ObligationStatusSchema`.
  //
  // The second one carries `Status` in its name because `notEvidencedCount` below
  // is a DIFFERENT number — the headline, which adds `undetermined` in — and two
  // fields differing only by what they silently include is exactly the kind of
  // collision this vocabulary was renamed to remove. This one is the tally of the
  // status; that one is everything the run could not evidence.
  evidencedCount: z.int().min(0),
  notEvidencedStatusCount: z.int().min(0),
  // Prohibition-shaped obligations the changed lines contain nothing against.
  //
  // Deliberately NOT part of `notEvidencedCount` below, and that is the whole
  // behavioural effect of the status existing: an obligation satisfied by changing
  // nothing has no line to cite by its nature, so counting it as something the run
  // failed to evidence reports a false alarm every single run. It is counted here
  // instead, where it can be read as what it is — obligations the change was
  // searched against and found not to go near.
  notContradictedCount: z.int().min(0),
  undeterminedCount: z.int().min(0),
  // ALWAYS FALSE, and retained in the contract for that reason rather than for
  // any state it can report: `intentFulfilment.maxObligations` now refuses the run
  // instead of binding the list (see `intent-limits.ts`), so a run that reaches a
  // report hit no cap. It fired on the wrong condition before that — 24 of 28 runs
  // on the 2026-08-01 corpus returned exactly the cap and all 28 claimed no
  // truncation — which is the defect refusing removed.
  obligationsTruncated: z.boolean(),
  // Obligations the extraction proposed whose citation did not resolve to a line
  // of the stated intent, and which were therefore not reported at all. Counted
  // rather than hidden: an extraction that mostly invents its sources should be
  // visible in the report it produced.
  uncitedObligationCount: z.int().min(0),
  // Obligations a judgement answered `evidenced` for while citing no line the
  // change actually touched. They are reported as `undetermined`, and counted here
  // so the downgrade is visible. This is the metric spec 23 says decides whether
  // the capability is safe to show anyone.
  unverifiedEvidenceClaimCount: z.int().min(0),
  // THE HEADLINE NUMBER, and the reason this capability is shaped the way it is.
  //
  // Obligations this run found no evidence for: everything `not-evidenced` and
  // everything `undetermined`. It is a statement about what the SEARCH found in
  // the change, never a claim about whether the work is done.
  //
  // IT ONCE COUNTED A THIRD THING. A citation-aptness stage put `evidenced`
  // obligations with doubted evidence on this list too. That stage was measured
  // and removed — 15 of this lane's 83 false positives (18.1%) were it flagging a
  // verdict that was already correct — so the number is now exactly the two
  // statuses named above, and neither an `evidenced` nor a `not-contradicted`
  // obligation is ever on it.
  //
  // IT ALSO ONCE COUNTED PROHIBITIONS, which is the 2026-08-06 change. An
  // obligation satisfied by changing nothing cannot produce a citation however
  // completely it is honoured, so while `not-contradicted` did not exist, 39.8% of
  // this lane's classified false positives were this number counting obligations
  // for which no other answer was reachable.
  //
  // Reading the report this way removes the one error spec 23 calls expensive. A
  // false "this is done" makes a reviewer stop looking; a false "this change does
  // not show it" costs them ten seconds. Since the report never asserts
  // completion, it cannot assert it wrongly — the failure mode becomes a missed
  // item on this list, which is the cheap direction spec 23 explicitly prefers.
  notEvidencedCount: z.int().min(0).default(0),
  extraScopeFileCount: z.int().min(0)
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
    // The lines a judgement was allowed to cite.
    //
    // There is deliberately no `changedLinesTruncated` beside it. The only thing
    // that cuts these lines is `intentFulfilment.maxChangeLines`, and reaching it
    // REFUSES the run with `intent_change_too_large` — so a report exists only
    // when nothing was cut, and the field could never be written anything but
    // `false`. A contract slot no producer can fill is a capability that looks
    // real: it invited a reader to check it, and checking it would always have
    // said "nothing was cut" whether or not that was the interesting question.
    // The refusal is the disclosure here, and it names the cap and the remedy.
    changedLineCount: z.int().min(0),
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
  explanation: z.string().min(1).max(INTENT_EXPLANATION_MAX).optional(),
  warnings: z.array(z.string()),
  usage: LaneUsageSchema.optional()
})

export type IntentCitation = z.infer<typeof IntentCitationSchema>
export type ChangeCitation = z.infer<typeof ChangeCitationSchema>
export type ObligationStatus = z.infer<typeof ObligationStatusSchema>
export type Obligation = z.infer<typeof ObligationSchema>
export type ExtraScopeEntry = z.infer<typeof ExtraScopeEntrySchema>
export type IntentFulfilmentSummary = z.infer<
  typeof IntentFulfilmentSummarySchema
>
export type IntentFulfilmentReport = z.infer<typeof IntentFulfilmentReportSchema>
