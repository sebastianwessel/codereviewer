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

// Mirrors the producer's required set exactly, minus its strictness. `path` and
// `lineRange` are optional THERE — a `semantic-only` expectation has neither — so
// requiring them here would reject valid reports of every vintage, not just old
// ones.
const RecallViewExpectedFindingSchema = z.looseObject({
  expectedIndex: z.int().min(0),
  category: z.string().min(1),
  severity: z.string().min(1),
  path: z.string().min(1).optional(),
  lineRange: z.tuple([z.int().min(1), z.int().min(1)]).optional(),
  matchMode: z.enum(['path-line', 'path-semantic', 'semantic-only']),
  diffScope: z.string().min(1),
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

export const EvalRecallViewSchema = z.looseObject({
  generatedAt: z.string().min(1),
  fixtureCount: z.int().min(0),
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
