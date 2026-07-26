import { z } from 'zod'
import { ReviewReportSchema } from '../../shared/contracts/index.js'
import { ContextLedgerKindSchema } from '../review-planning/context-ledger.js'
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
  severityMatches: z.boolean()
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
  semanticSummary: z.string().min(1)
})

export const EvalCaseReportSchema = z.strictObject({
  caseId: z.string().min(1),
  parseValid: z.boolean(),
  providerErrored: z.boolean(),
  providerIssues: z.array(EvalProviderIssueReportSchema).default([]),
  agenticStages: z.array(EvalAgenticStageReportSchema).default([]),
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

export const EvalMetricGroupSchema = z.strictObject({
  groupBy: z.enum(['sourceProfile', 'language', 'tag']),
  key: z.string().min(1),
  fixtureCount: z.int().min(0),
  caseIds: z.array(z.string().min(1)),
  metrics: EvalMetricsSchema
})

// How the numbers in a report were COMPUTED, as opposed to `schemaVersion`,
// which describes the shape they are written in. A report is only comparable to
// another report produced by the same scoring rules, and two changes have already
// broken that: expectation-to-finding assignment became maximum-cardinality
// rather than first-acceptable, and the model category taxonomy was unified,
// which moves race and concurrency findings and so shifts tier resolution.
//
// Bump this whenever a change alters what a metric would report for identical
// review output. Comparing across a bump silently mixes incomparable runs, which
// is the same class of failure as scoring a run against a stale answer key -- and
// that one has already happened here.
export const EVAL_METRICS_VERSION = '2026-07-26.max-cardinality-matching'

export const EvalReportSchema = z.strictObject({
  schemaVersion: z.literal('1.0'),
  // Defaulted so a report written before this field existed still parses; such a
  // report predates the scoring changes above and is correctly reported as
  // incomparable to a current one.
  metricsVersion: z.string().min(1).default('pre-2026-07-26'),
  generatedAt: z.iso.datetime(),
  fixtureCount: z.int().min(0),
  selection: EvalReportSelectionSchema,
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
export type EvalReport = z.infer<typeof EvalReportSchema>
