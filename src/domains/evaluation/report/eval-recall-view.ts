// The tolerant read model for `eval recall-report`, for the same reason
// `eval-comparison-view.ts` exists and stated first there: an analysis whose whole
// job is to answer questions about FINISHED runs cannot validate them against
// today's producer contract, because a producer change is exactly what makes an
// archived payload differ.
//
// This was not hypothetical. On 2026-08-11 the case result replaced four
// per-classification finding arrays with one `producedFindings`, and because
// `EvalCaseResultReportSchema` is strict, every archive written before that commit
// stopped opening — roughly a hundred engine-pinned runs, the evidence base the
// ledger is written from. `eval compare` was unaffected: it already read through a
// view. `eval recall-report` read through the producer contract and died.
//
// WHY A VIEW RATHER THAN A MIGRATION. Folding the legacy arrays into
// `producedFindings` would have to supply `proposedBy`, `evidenceCount`,
// `hasFixProposal` and `description`, none of which the older payload recorded.
// Inventing them would manufacture measurement data, which is worse than the
// failure it fixes. This view instead reads ONLY the fields recall analysis
// consumes — and those four fields are identical in both shapes, so no archived
// run needs converting at all.
//
// WHY NOT SIMPLY LOOSEN THE PRODUCER CONTRACT. Strictness there is what catches a
// report this build did not write. Keeping the producer strict and the analysis
// tolerant is the same split the comparison view already draws.
//
// The bound on tolerance: every field below is REQUIRED. This accepts an older
// report, never an incomplete one — a payload missing `matchedFindings` is not an
// old report, it is a broken one, and recall computed from it would be silently
// wrong in the direction that flatters the engine.

import { z } from 'zod'
import { EvalMatchModeSchema } from '../corpus/eval-fixture.schema.js'

// Required exactly where recall analysis reads the field, and optional
// everywhere else. `path` and `lineRange` are optional in the producer too — a
// `semantic-only` expectation has neither — so requiring them here would reject
// valid reports of every vintage, not just old ones. `diffScope` is required in
// today's producer and optional here for the reason stated at the field.
const RecallViewExpectedFindingSchema = z.looseObject({
  expectedIndex: z.int().min(0),
  category: z.string().min(1),
  severity: z.string().min(1),
  path: z.string().min(1).optional(),
  lineRange: z.tuple([z.int().min(1), z.int().min(1)]).optional(),
  // The corpus's own vocabulary, imported rather than restated. It is a closed
  // enum the fixture schema owns; a local copy is a second place to edit, and a
  // mode added there and not here would refuse every report that carries it —
  // which is the failure this view exists to prevent, arriving through the one
  // field recall's own matching rule reads.
  matchMode: EvalMatchModeSchema,
  // OPTIONAL, and this is the second field where mirroring the producer's
  // required set was the wrong rule. Per-expectation `diffScope` was added on
  // 2026-07-31; its own metrics-version entry
  // (`2026-07-31.diff-scope-recall`) states that "an older report carries no
  // classification", so every report written before it lacks the key. Requiring
  // it here refused 200 archived reports on disk -- 14 of them under
  // `.codereviewer/eval/archive/` -- which is the same failure this view was
  // written to end, one producer change earlier. Recall is not computed from
  // diff scope and the recall report does not render it, so its absence cannot
  // make a recall figure wrong; the bound stays on the fields recall IS computed
  // from, which are all still required above.
  diffScope: z.string().min(1).optional(),
  semanticSummary: z.string().min(1)
})

const RecallViewMatchSchema = z.looseObject({
  expectedIndex: z.int().min(0)
})

const RecallViewCaseResultSchema = z.looseObject({
  caseId: z.string().min(1),
  expectedFindings: z.array(RecallViewExpectedFindingSchema),
  matchedFindings: z.array(RecallViewMatchSchema)
})

// The identity a report states about how its numbers were produced, read so a
// POOL of several reports can be refused — never to render, and never required.
//
// This is the one place the module header's "required exactly where recall
// analysis reads the field" rule needs restating rather than repeating, because
// these fields are read for a different purpose. Recall is not computed from
// them, so a report that omits them can still be read; but `eval recall-report`
// merges several reports into one `k/n` per expectation, and two runs scored
// against different answer keys or by different judges do not share that
// denominator. `eval-pool-identity.ts` owns what that means, including the case
// that actually matters here: 121 of the 516 eval reports on disk carry neither
// field, and absence resolves to the identity `unrecorded` rather than to a
// wildcard — so a silent archive refuses to pool with a report that can name its
// answer key, and a single-report read is unaffected because nothing is merged.
//
// EVERY LEAF IS OPTIONAL, deliberately. Requiring `metricsVersion` here would
// refuse those 121 archives outright, which is the failure this whole module
// exists to end, arriving through the guard meant to protect their numbers.
//
// THREE PROVENANCE FIELDS, AND THE BOUND IS STATED. `answerKeyDigestByCase` is
// comparison's tool for naming which SHARED case moved, and this report pools
// rather than compares, so the aggregate digest is the right test here for the
// reason the significance module gives. `configHash` is a digest nothing can be
// read out of, and `eval compare` deliberately does not refuse across one.
// `capabilities` is the one real gap: `eval compare` WARNS when reports disagree
// on it, and this command does not — adding a second warning surface is a
// decision on its own, and the refusals above are the ones that make a pooled
// `k/n` mean something rather than merely explicable.
const RecallViewProvenanceSchema = z.looseObject({
  answerKeyDigest: z.string().min(1).optional(),
  modelName: z.string().min(1).optional(),
  judgeModelName: z.string().min(1).optional()
})

export const EvalRecallViewSchema = z.looseObject({
  generatedAt: z.string().min(1),
  fixtureCount: z.int().min(0),
  metricsVersion: z.string().min(1).optional(),
  provenance: RecallViewProvenanceSchema.optional(),
  selection: z.looseObject({
    selectedCaseIds: z.array(z.string())
  }),
  caseResults: z.array(RecallViewCaseResultSchema)
})

export type EvalRecallView = z.infer<typeof EvalRecallViewSchema>

/**
 * Parses an eval report — of any schema version this build can still answer
 * recall questions about — into the recall view.
 *
 * Throws on a payload that does not carry the four fields recall is computed
 * from, which is the honest failure: absence there is not an old report.
 */
export const parseEvalRecallView = (report: unknown): EvalRecallView =>
  EvalRecallViewSchema.parse(report)

/**
 * The three levels of this view, exported for `eval-recall-view.test.ts` alone.
 *
 * Tolerance on READ is the point of this module and stays exactly as documented
 * above. What it costs is a failure mode: a field the PRODUCER adds parses here
 * without complaint and is simply never read, so a new fact that recall analysis
 * ought to use can be missing from the recall report indefinitely with nothing to
 * say so. The test diffs these shapes against the producer's contract and requires
 * every unread field to be listed with a reason — the guard
 * `eval-comparison-view.test.ts` already puts on the comparison read model, which
 * is the same kind of hand-maintained narrow view of the same producer.
 */
export const recallViewReadModels = {
  report: EvalRecallViewSchema,
  caseResult: RecallViewCaseResultSchema,
  expectedFinding: RecallViewExpectedFindingSchema
} as const
