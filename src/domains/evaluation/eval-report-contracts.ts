import { z } from 'zod'
import { ReviewReportSchema } from '../../shared/contracts/index.js'
import { ContextLedgerKindSchema } from '../review-planning/context-ledger.js'
import { DiffScopeSchema } from './eval-diff-scope.js'
import { EvalMetricsSchema } from './metrics.js'

export const EvalContextLedgerEntrySchema = z.strictObject({
  kind: ContextLedgerKindSchema,
  consideredForModelContext: z.boolean(),
  truncated: z.boolean()
})

const ProviderErrorSchema = z.strictObject({
  status: z.literal('provider-error'),
  code: z.string().min(1),
  // The agentic stage that failed, when known, so a hard provider error stays
  // diagnosable instead of dropping where it happened.
  stage: z.string().min(1).optional(),
  message: z.string().min(1).max(500)
})

const SuccessfulEvalOutputSchema = z.strictObject({
  status: z.literal('ok'),
  reviewReport: ReviewReportSchema
})

// Per-finding outcome of the finding investigation-and-fix lane (spec 12),
// mirrored into the eval contract so the runner can score the lane's judgment
// and fix quality against the match result. The eval domain owns this mirror
// (as it mirrors provider-issue and refutation shapes) rather than importing the
// verification domain's internal contract.
export const EvalFixOutcomeReportSchema = z.strictObject({
  findingId: z.string().min(1),
  findingJudgment: z.enum(['real', 'false-positive']).optional(),
  fixProduced: z.boolean(),
  applyCheck: z.enum(['passed', 'failed', 'not-attempted'])
})

export const EvalCaseOutputSchema = z.strictObject({
  caseId: z.string().min(1),
  changedLineCount: z.int().min(0),
  diffHunkCount: z.int().min(0),
  contextLedger: z.array(EvalContextLedgerEntrySchema).default([]),
  // Fix-lane outcomes captured when the eval case ran with `fix.enabled`.
  // Empty when the lane was disabled, ran on no eligible finding, or could not
  // resolve a provider — all non-fatal (spec 12).
  fixOutcomes: z.array(EvalFixOutcomeReportSchema).default([]),
  result: z.discriminatedUnion('status', [
    SuccessfulEvalOutputSchema,
    ProviderErrorSchema
  ])
})

export const EvalRegressionThresholdsSchema = z.strictObject({
  minParseValidity: z.number().min(0).max(1).optional(),
  minRecall: z.number().min(0).max(1).optional(),
  minPrecision: z.number().min(0).max(1).optional(),
  minSeverityWeightedF1: z.number().min(0).max(1).optional(),
  maxFalsePositiveCount: z.int().min(0).optional(),
  maxCommentsPerKloc: z.number().min(0).optional(),
  maxCommentsPerDiffHunk: z.number().min(0).optional(),
  maxIncompleteCoverageRate: z.number().min(0).max(1).optional(),
  maxContextMutationRate: z.number().min(0).max(1).optional(),
  maxCostUsd: z.number().min(0).optional(),
  maxDurationMs: z.int().min(0).optional(),
  minProductRecall: z.number().min(0).max(1).optional(),
  failOnProviderError: z.boolean().default(true)
})

export const EvalFindingMatchReportSchema = z.strictObject({
  expectedIndex: z.int().min(0),
  findingId: z.string().min(1),
  // Report-safe rationale from the semantic judge that accepted the match.
  // There is no numeric similarity score: identity of defect is a judgment.
  semanticReason: z.string().min(1).max(1000),
  lineOverlaps: z.boolean(),
  severityMatches: z.boolean(),
  // DIAGNOSTIC ONLY (spec 06 item 0.3): the finding's produced location,
  // recorded for EVERY matched pair regardless of match mode. This is
  // deliberately NOT the same signal as `lineOverlaps`, which stays gated to
  // `path-line` and feeds the strict `lineAccuracy` scoring metric. These two
  // fields let `linePlacementRate` measure line placement on `path-semantic`
  // matches too -- the entire primary corpus, which `lineAccuracy`
  // structurally cannot see -- without changing what a match IS or touching
  // the regression gate.
  producedPath: z.string().min(1),
  producedStartLine: z.int().min(1)
})

// An expected/finding pair the judge could not decide. It is excluded from the
// recall and precision denominators instead of being recorded as "no match".
export const EvalInconclusiveMatchReportSchema = z.strictObject({
  expectedIndex: z.int().min(0),
  findingId: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1).max(500).optional()
})

export const EvalFalsePositiveFindingReportSchema = z.strictObject({
  findingId: z.string().min(1),
  severity: z.string().min(1),
  category: z.string().min(1),
  path: z.string().min(1),
  line: z.int().min(1),
  title: z.string().min(1)
})

export const EvalProviderIssueReportSchema = z.strictObject({
  code: z.string().min(1),
  stage: z.string().min(1).optional(),
  recovered: z.boolean(),
  message: z.string().min(1).max(500).optional()
})

export const EvalAgenticStageReportSchema = z.strictObject({
  stage: z.enum(['refutation', 'fix', 'provider-recovery']),
  status: z.enum(['active', 'skipped', 'recovered', 'error']),
  count: z.int().min(0)
})

export const EvalRefutationResultReportSchema = z.strictObject({
  id: z.string().min(1),
  candidateId: z.string().min(1),
  verdict: z.enum(['proved', 'refuted', 'needs-more-evidence', 'provider-error'])
})

export const EvalExpectedFindingReportSchema = z.strictObject({
  expectedIndex: z.int().min(0),
  category: z.string().min(1),
  severity: z.string().min(1),
  path: z.string().min(1).optional(),
  lineRange: z.tuple([z.int().min(1), z.int().min(1)]).optional(),
  matchMode: z.enum(['path-line', 'path-semantic', 'semantic-only']),
  // Whether this expectation lies inside the reviewed diff (spec 17). Derived
  // by the eval domain from the case's own diff under the hunk-span rule and
  // STORED here so the split is auditable per expectation and cannot drift:
  // before this field it was re-derived by hand for every analysis, and two
  // people computing it two ways got two different headline numbers.
  //
  // Defaulted for the same reason `metricsVersion` and `provenance` are: a
  // report saved before the field existed must still parse, and such a report
  // genuinely cannot answer the question — it is `undetermined`, not in-diff.
  diffScope: DiffScopeSchema.default('undetermined'),
  semanticSummary: z.string().min(1)
})

export const EvalCaseReportSchema = z.strictObject({
  caseId: z.string().min(1),
  parseValid: z.boolean(),
  providerErrored: z.boolean(),
  providerIssues: z.array(EvalProviderIssueReportSchema).default([]),
  agenticStages: z.array(EvalAgenticStageReportSchema).default([]),
  // What discovery produced for this case, before refutation and admission
  // filtered it (spec 27). Reused from the review report verbatim rather than
  // mirrored: the provider-issue and refutation mirrors above exist because the
  // eval reshapes those, and there is nothing to reshape here — a copy would only
  // create two definitions that can drift. Absent when the review report carried
  // none (a provider-errored case, or a report written before the field existed).
  discovery: ReviewReportSchema.shape.discovery,
  contextLedger: z.array(EvalContextLedgerEntrySchema).default([]),
  expectedFindings: z.array(EvalExpectedFindingReportSchema),
  matchedFindings: z.array(EvalFindingMatchReportSchema),
  unmatchedExpectedIndexes: z.array(z.int().min(0)),
  inconclusiveExpectedIndexes: z.array(z.int().min(0)).default([]),
  inconclusiveFindingIds: z.array(z.string().min(1)).default([]),
  inconclusiveMatches: z
    .array(EvalInconclusiveMatchReportSchema)
    .default([]),
  duplicateFindingIds: z.array(z.string().min(1)).default([]),
  duplicateFindings: z.array(EvalFalsePositiveFindingReportSchema).default([]),
  falsePositiveFindingIds: z.array(z.string().min(1)),
  falsePositiveFindings: z.array(EvalFalsePositiveFindingReportSchema),
  // Unmatched findings the plausibility judge deemed genuine but unlisted
  // defects; excluded from genuineFalsePositiveCount and adjustedPrecision's
  // denominator. A subset of falsePositiveFindingIds.
  unlistedRealFindingIds: z.array(z.string().min(1)).default([]),
  unlistedRealFindings: z.array(EvalFalsePositiveFindingReportSchema).default([]),
  // Unmatched findings that count against adjustedPrecision: judged spurious or
  // fail-closed (unjudged). The complement of unlistedRealFindingIds within the
  // raw false-positive set.
  genuineFalsePositiveFindingIds: z.array(z.string().min(1)).default([]),
  noFindingZoneFalsePositiveIds: z.array(z.string().min(1)),
  artifactOnlyFindingIds: z.array(z.string().min(1)).default([]),
  artifactOnlyMatchedFindings: z.array(EvalFindingMatchReportSchema).default([]),
  artifactOnlyFalsePositiveFindingIds: z.array(z.string().min(1)).default([]),
  artifactOnlyFalsePositiveFindings: z
    .array(EvalFalsePositiveFindingReportSchema)
    .default([]),
  refutationResults: z.array(EvalRefutationResultReportSchema).default([]),
  // Per-finding fix-lane outcomes for this case (spec 12), preserved so saved
  // reports are self-contained for fix-lane analysis.
  fixOutcomes: z.array(EvalFixOutcomeReportSchema).default([]),
  inlineFindingCount: z.int().min(0).default(0),
  warnings: z.array(z.string()),
  durationMs: z.int().min(0),
  inputTokens: z.int().min(0).default(0),
  cachedInputTokens: z.int().min(0).default(0),
  outputTokens: z.int().min(0).default(0),
  costUnavailable: z.boolean().default(false),
  costUsd: z.number().min(0)
})

export const EvalRegressionGateSchema = z.strictObject({
  passed: z.boolean(),
  reasons: z.array(z.string()),
  thresholds: EvalRegressionThresholdsSchema,
  failingCaseIds: z.array(z.string().min(1))
})

export const EvalReportSelectionSchema = z.strictObject({
  fixtureSource: z.enum(['default', 'slice-root']),
  sliceRoot: z.string().min(1).optional(),
  caseFilters: z.array(z.string().min(1)),
  selectedCaseIds: z.array(z.string().min(1))
})

// Scoring metadata proves how reliable the run's sole semantic authority was.
// `judgeAgreement` is omitted when no calibration pair was scored (an offline
// run with no expected findings needs no judge).
export const EvalReportScoringSchema = z.strictObject({
  judgeAgreement: z.number().min(0).max(1).optional(),
  judgeTrustworthy: z.boolean(),
  // Plausibility-judge reliability. `plausibilityJudgeAgreement` is omitted when
  // no plausibility calibration pair was scored (an offline run needs no judge).
  // `adjustedPrecisionTrustworthy` is `false` when the plausibility agreement is
  // below the configured minimum, marking `adjustedPrecision` untrustworthy.
  plausibilityJudgeAgreement: z.number().min(0).max(1).optional(),
  adjustedPrecisionTrustworthy: z.boolean().default(true)
})

// Provenance proves WHAT was scored and under WHAT configuration, which
// `metricsVersion` alone does not: `metricsVersion` says how a metric is
// computed from review output, but nothing before this recorded which answer
// key produced the review output in the first place. An archived run in this
// repository once reported 78.8% recall after its answer key had since
// changed underneath it, and nothing in the artifact revealed that -- the
// same class of failure `metricsVersion` mismatches already guard against, one
// layer up the stack.
export const EvalReportProvenanceSchema = z.strictObject({
  // sha256 digest over the expected-finding content of every selected case
  // (see `computeAnswerKeyDigest` for the exact scope and why it stops at
  // expected-finding content). Two reports with the same digest scored an
  // IDENTICAL answer key; comparison and the significance module refuse to
  // diff across a mismatch here, exactly like a `metricsVersion` mismatch.
  answerKeyDigest: z.string().min(1),
  // Per case, so a comparison can tell a deliberately different case selection
  // (legitimate, and already warned about) from the shared cases having been
  // scored against different expectations (the stale-answer-key incident).
  // Defaulted empty so a report predating it still parses; such a report simply
  // cannot answer the per-case question.
  answerKeyDigestByCase: z.record(z.string(), z.string()).default({}),
  // sha256 digest over the effective (file + environment + CLI-override
  // merged) configuration the run used. Comparison does NOT refuse across a
  // config-hash mismatch the way it does for `answerKeyDigest`: a maintainer
  // legitimately compares two runs under DIFFERENT configurations to measure
  // the effect of changing one, so refusing here would block the very
  // comparisons this project exists to make. The hash exists so an archived
  // run can be read back and its configuration identity checked, not to gate
  // diffing.
  configHash: z.string().min(1),
  // Provider/model identity, present only when a provider was configured for
  // the run (an offline run scoring only cases with no expected findings needs
  // neither).
  providerId: z.string().min(1).optional(),
  modelName: z.string().min(1).optional()
})

export const EvalMetricGroupSchema = z.strictObject({
  groupBy: z.enum(['sourceProfile', 'language', 'tag']),
  key: z.string().min(1),
  fixtureCount: z.int().min(0),
  caseIds: z.array(z.string().min(1)),
  metrics: EvalMetricsSchema
})

// How the numbers in a report were COMPUTED, as opposed to `schemaVersion`,
// which describes the shape they are written in. A report is only comparable to
// another report produced by the same scoring rules, and three changes have
// already broken that: expectation-to-finding assignment became
// maximum-cardinality rather than first-acceptable; the model category taxonomy
// was unified, which moves race and concurrency findings and so shifts tier
// resolution; and the plausibility judge now recognises when an unmatched
// finding merely restates a defect already counted in the same file (a match, or
// an earlier unlisted-real credit in this same run) instead of crediting every
// restatement as its own additional unlisted-real defect. That last change
// alters `unlistedRealFindingCount`, `genuineFalsePositiveCount`, and
// `adjustedPrecision` for identical review output whenever a run contains a
// restated finding, so a report scored before it is not comparable to one scored
// after it.
//
// Bump this whenever a change alters what a metric would report for identical
// review output. Comparing across a bump silently mixes incomparable runs, which
// is the same class of failure as scoring a run against a stale answer key -- and
// that one has already happened here.
//
// A metric that is merely ADDED bumps it too, whenever its value cannot be
// recovered for a report saved earlier. `recallByDiffScope` is such a metric: an
// older report carries no per-expectation diff-scope classification, so it reads
// back as entirely `undetermined` and would pool into an in-diff or out-of-diff
// figure as a silent hole rather than as data. Refusing to compare across the
// bump is the same protection the earlier entries buy.
//
// `discovery` (spec 27) is the same case as `recallByDiffScope`: the per-case
// discovery counters cannot be recovered for a report saved before they were
// recorded, because the run that would have produced them is over and its debug
// log was off. A comparison that pooled such a report would read "no discovery
// calls" where the truth is "not recorded".
export const EVAL_METRICS_VERSION = '2026-08-01.discovery-telemetry'

export const EvalReportSchema = z.strictObject({
  schemaVersion: z.literal('1.0'),
  // Defaulted so a report written before this field existed still parses; such a
  // report predates the scoring changes above and is correctly reported as
  // incomparable to a current one.
  metricsVersion: z.string().min(1).default('pre-2026-07-26'),
  generatedAt: z.iso.datetime(),
  fixtureCount: z.int().min(0),
  selection: EvalReportSelectionSchema,
  // Defaulted for the same reason as `metricsVersion`: a report saved before
  // this field existed must still parse. Such a report predates answer-key
  // digesting entirely, so it is correctly treated as incomparable to a
  // current one -- comparison and the significance module refuse to diff
  // across a mismatch, and every pre-existing report shares this one sentinel
  // digest, exactly mirroring how `metricsVersion`'s own sentinel behaves.
  provenance: EvalReportProvenanceSchema.default({
    answerKeyDigest: 'pre-2026-07-26.provenance',
    answerKeyDigestByCase: {},
    configHash: 'pre-2026-07-26.provenance'
  }),
  // Required: the producer always writes scoring. Defaulting it would let a
  // report carrying no scoring data silently claim `judgeTrustworthy: true`.
  scoring: EvalReportScoringSchema,
  caseResults: z.array(EvalCaseReportSchema),
  metrics: EvalMetricsSchema,
  metricGroups: z.array(EvalMetricGroupSchema),
  regressionGate: EvalRegressionGateSchema
})

export type EvalContextLedgerEntry = z.infer<typeof EvalContextLedgerEntrySchema>
export type EvalCaseOutput = z.infer<typeof EvalCaseOutputSchema>
export type EvalRegressionThresholds = z.infer<
  typeof EvalRegressionThresholdsSchema
>
export type EvalReportSelection = z.infer<typeof EvalReportSelectionSchema>
export type EvalReportScoring = z.infer<typeof EvalReportScoringSchema>
export type EvalReportProvenance = z.infer<typeof EvalReportProvenanceSchema>
export type EvalReport = z.infer<typeof EvalReportSchema>
