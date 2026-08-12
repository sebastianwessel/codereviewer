import { z } from 'zod'
import { LaneUsageSchema } from '../../costs/index.js'
import { ObligationStatusSchema } from '../../intent-fulfilment/index.js'
import { IntentArmSchema } from './intent-corpus.schema.js'
import { INTENT_METRICS_VERSION } from './intent-metrics-versions.js'
import {
  intentUnmeasuredReasons,
  type IntentScore
} from './intent-eval-scoring.js'

// The intent-fulfilment evaluation report: contract, artefact names, and builder.
//
// DELIBERATELY NOT THE EVAL REPORT, AND NOT THE CHANGE-IMPACT ONE. Three corpora
// answer three different questions, and a shared report shape is one of the ways
// two of them get pooled by accident. So `reportKind` is a literal nothing else in
// this repository writes, the artefact names and directory are distinct, and the
// command that produces them takes `--case-root` and has never heard of
// `--slice-root`.

export const INTENT_EVAL_REPORT_ARTIFACT_NAME = 'intent-eval-report.json'
export const INTENT_EVAL_SUMMARY_ARTIFACT_NAME = 'intent-eval-summary.md'
export const INTENT_EVAL_ARTIFACT_ROOT = '.codereviewer/eval/intent-fulfilment'

// A rate that can honestly be absent. `not-measured` carries its reason so a reader
// never has to guess whether a missing figure is a zero, and a zero is never
// produced by an empty denominator.
const RateSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('measured'),
    matched: z.int().min(0),
    total: z.int().min(1),
    rate: z.number().min(0).max(1)
  }),
  z.strictObject({
    status: z.literal('not-measured'),
    reason: z.string().min(1)
  })
])

// THE METRIC SPEC 23'S DECISION RULE IS STATED ON: "ship only if the
// false-satisfied rate is low. A capability that misses unaddressed obligations is
// merely incomplete; one that wrongly certifies them is harmful."
const FalseSatisfiedSchema = z.strictObject({
  // Enumerated outstanding obligations the run reported off the list a human reads.
  // This is spec 23's numerator exactly.
  claimCount: z.int().min(0),
  // The two ways an obligation leaves that list, kept apart. A wrong
  // `not-contradicted` counts here on the same footing as a wrong `evidenced` —
  // spec 23's pre-registration says so in as many words — but it is a different
  // claim and folding the two into one total would hide which one is growing.
  viaEvidenced: z.int().min(0),
  viaNotContradicted: z.int().min(0),
  // Over the outstanding obligations the run reached at all. Named for its
  // denominator because that denominator is NOT spec 23's.
  rateOverReached: RateSchema,
  // Spec 23's own denominator, which is permanently `not-measured` here. The field
  // exists so the absence is stated in the artefact rather than left for a reader
  // to infer from a rate that looks like it.
  rateOverAllSatisfiedClaims: RateSchema
})

const ArmMetricsSchema = z.strictObject({
  arm: IntentArmSchema,
  scoredCaseCount: z.int().min(0),
  expectationCount: z.int().min(0),
  outstandingRecall: RateSchema,
  falseSatisfied: FalseSatisfiedSchema,
  obligationCount: z.int().min(0),
  anchoredObligationCount: z.int().min(0),
  unanchoredObligationCount: z.int().min(0),
  notContradictedCount: z.int().min(0),
  notContradictedClearingOutstandingCount: z.int().min(0),
  // What a human read in the excerpts of the cases this arm scored. The extraction
  // denominator, and a fixed count rather than the run's own obligation count.
  humanObligationCount: z.int().min(0)
})

const ExpectationOutcomeSchema = z.enum([
  'reported-outstanding',
  'false-satisfied',
  'not-reported'
])

const ScoredExpectationSchema = z.strictObject({
  caseId: z.string().min(1),
  arm: IntentArmSchema,
  expectationId: z.string().min(1),
  statement: z.string().min(1),
  outcome: ExpectationOutcomeSchema,
  candidateObligationIds: z.array(z.string().min(1)),
  clearedBy: z.array(ObligationStatusSchema)
})

const CaseResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    caseId: z.string().min(1),
    arm: IntentArmSchema,
    status: z.literal('scored'),
    obligationCount: z.int().min(0),
    anchoredObligationCount: z.int().min(0),
    notContradictedCount: z.int().min(0),
    expectations: z.array(ScoredExpectationSchema)
  }),
  // The engine DECLINING to answer, which spec 23 requires when an input limit
  // binds. It is not a failure and it is not a zero; it is a case with no report,
  // excluded from every rate with its code printed.
  z.strictObject({
    caseId: z.string().min(1),
    arm: IntentArmSchema,
    status: z.literal('refused'),
    code: z.string().min(1),
    detail: z.string().min(1),
    expectationCount: z.int().min(0)
  }),
  z.strictObject({
    caseId: z.string().min(1),
    arm: IntentArmSchema,
    status: z.literal('unmeasured'),
    reason: z.enum(intentUnmeasuredReasons),
    detail: z.string().min(1),
    expectationCount: z.int().min(0)
  })
])

export const IntentEvalReportSchema = z.strictObject({
  // The anti-pooling literal. Nothing else in this repository writes it.
  reportKind: z.literal('intent-fulfilment-obligations'),
  schemaVersion: z.literal('1.0'),
  metricsVersion: z.string().min(1),
  generatedAt: z.iso.datetime(),
  datasetId: z.string().min(1),
  selection: z.strictObject({
    manifestPath: z.string().min(1),
    caseRoot: z.string().min(1),
    caseFilters: z.array(z.string().min(1)),
    selectedCaseIds: z.array(z.string().min(1))
  }),
  // WHICH ENGINE AND WHICH MODEL PRODUCED THESE VERDICTS. A rate is a property of
  // an engine and a model, never of a corpus, and this repository has already had
  // to void figures that could not name either. `unknown` is a legitimate value and
  // is rendered as such; it is never omitted.
  engine: z.strictObject({
    commit: z.string().min(1),
    workingTreeClean: z.boolean().optional()
  }),
  provenance: z.strictObject({
    answerKeyDigest: z.string().min(1),
    answerKeyDigestByCase: z.record(z.string(), z.string()),
    configHash: z.string().min(1),
    providerId: z.string().min(1).optional(),
    modelName: z.string().min(1).optional()
  }),
  coverage: z.strictObject({
    totalCaseCount: z.int().min(0),
    scoredCaseCount: z.int().min(0),
    refusedCaseCount: z.int().min(0),
    unmeasuredCaseCount: z.int().min(0),
    totalExpectationCount: z.int().min(0),
    scoredExpectationCount: z.int().min(0)
  }),
  // TWO ARMS AND NO POOLED TOTAL. A pre-written intent and a commit message written
  // after the work are different questions, and there is deliberately no field here
  // for anyone to quote a blended figure out of.
  arms: z.strictObject({
    prewritten: ArmMetricsSchema,
    posthoc: ArmMetricsSchema
  }),
  caseResults: z.array(CaseResultSchema),
  usage: LaneUsageSchema.optional(),
  warnings: z.array(z.string())
})

export type IntentEvalReport = z.infer<typeof IntentEvalReportSchema>

export type BuildIntentEvalReportInput = {
  readonly score: IntentScore
  readonly generatedAt: Date
  readonly datasetId: string
  readonly selection: IntentEvalReport['selection']
  readonly engine: IntentEvalReport['engine']
  readonly provenance: IntentEvalReport['provenance']
  readonly usage?: IntentEvalReport['usage']
  readonly warnings: readonly string[]
}

export const buildIntentEvalReport = (
  input: BuildIntentEvalReportInput
): IntentEvalReport =>
  IntentEvalReportSchema.parse({
    reportKind: 'intent-fulfilment-obligations',
    schemaVersion: '1.0',
    metricsVersion: INTENT_METRICS_VERSION,
    generatedAt: input.generatedAt.toISOString(),
    datasetId: input.datasetId,
    selection: input.selection,
    engine: input.engine,
    provenance: input.provenance,
    coverage: input.score.coverage,
    arms: input.score.arms,
    caseResults: input.score.caseScores,
    ...(input.usage === undefined ? {} : { usage: input.usage }),
    // The scorer's own warnings first: they are the conditions that make a figure
    // unreadable, and a reader who stops after the first line must see those rather
    // than a configuration note.
    warnings: [...input.score.warnings, ...input.warnings]
  })

export const parseIntentEvalReport = (value: unknown): IntentEvalReport =>
  IntentEvalReportSchema.parse(value)
