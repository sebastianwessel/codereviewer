import { z } from 'zod'
import { ReviewReportSchema } from '../../shared/contracts/index.js'
import { EvalMetricsSchema } from './metrics.js'

export const EvalContextLedgerEntrySchema = z.strictObject({
  kind: z
    .enum([
      'file',
      'diff',
      'symbol',
      'instruction',
      'skill',
      'support-signal-output',
      'tool-result',
      'prior-artifact',
      'unknown'
    ])
    .default('unknown'),
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

export const EvalCaseOutputSchema = z.strictObject({
  caseId: z.string().min(1),
  changedLineCount: z.int().min(0),
  diffHunkCount: z.int().min(0),
  contextLedger: z.array(EvalContextLedgerEntrySchema).default([]),
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
  minSuspicionStageCoverage: z.number().min(0).max(1).optional(),
  minJudgeCoverage: z.number().min(0).max(1).optional(),
  failOnProviderError: z.boolean().default(true)
})

export const EvalFindingMatchReportSchema = z.strictObject({
  expectedIndex: z.int().min(0),
  findingId: z.string().min(1),
  semanticScore: z.number().min(0).max(1),
  semanticReason: z.string().min(1).max(1000).optional(),
  lineOverlaps: z.boolean(),
  severityMatches: z.boolean()
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
  stage: z.enum([
    'intent-planning',
    'suspicion-generation',
    'suspicion-investigation',
    'proof-packet',
    'refutation',
    'aggregate-critic',
    'judge',
    'provider-recovery'
  ]),
  status: z.enum(['active', 'skipped', 'recovered', 'error']),
  count: z.int().min(0)
})

export const EvalProofPacketReportSchema = z.strictObject({
  id: z.string().min(1),
  suspicionId: z.string().min(1),
  candidateId: z.string().min(1),
  evidenceCount: z.int().min(0),
  promotionStatus: z.enum(['actionable', 'artifact-only', 'rejected']).optional()
})

export const EvalRefutationResultReportSchema = z.strictObject({
  id: z.string().min(1),
  proofPacketId: z.string().min(1),
  verdict: z.enum(['proved', 'refuted', 'needs-more-evidence', 'provider-error'])
})

export const EvalPromotionDecisionReportSchema = z.strictObject({
  candidateId: z.string().min(1),
  proofPacketId: z.string().min(1).optional(),
  refutationId: z.string().min(1).optional(),
  status: z.enum(['actionable', 'artifact-only', 'rejected']),
  reason: z.string().min(1).max(500)
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
  duplicateFindingIds: z.array(z.string().min(1)).default([]),
  duplicateFindings: z.array(EvalFalsePositiveFindingReportSchema).default([]),
  falsePositiveFindingIds: z.array(z.string().min(1)),
  falsePositiveFindings: z.array(EvalFalsePositiveFindingReportSchema),
  noFindingZoneFalsePositiveIds: z.array(z.string().min(1)),
  artifactOnlyFindingIds: z.array(z.string().min(1)).default([]),
  artifactOnlyMatchedFindings: z.array(EvalFindingMatchReportSchema).default([]),
  artifactOnlyFalsePositiveFindingIds: z.array(z.string().min(1)).default([]),
  artifactOnlyFalsePositiveFindings: z
    .array(EvalFalsePositiveFindingReportSchema)
    .default([]),
  modelSuspicionIds: z.array(z.string().min(1)).default([]),
  modelTaskDiagnostics: ReviewReportSchema.shape.modelTaskDiagnostics,
  proofPackets: z.array(EvalProofPacketReportSchema).default([]),
  refutationResults: z.array(EvalRefutationResultReportSchema).default([]),
  promotionDecisions: z.array(EvalPromotionDecisionReportSchema).default([]),
  inlineFindingCount: z.int().min(0).default(0),
  warnings: z.array(z.string()),
  durationMs: z.int().min(0),
  inputTokens: z.int().min(0).default(0),
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

export const EvalReportScoringSchema = z.strictObject({
  semanticMatcher: z.enum(['deterministic', 'semantic-judge'])
})

export const EvalMetricGroupSchema = z.strictObject({
  groupBy: z.enum(['sourceProfile', 'language', 'tag']),
  key: z.string().min(1),
  fixtureCount: z.int().min(0),
  caseIds: z.array(z.string().min(1)),
  metrics: EvalMetricsSchema
})

export const EvalReportSchema = z.strictObject({
  schemaVersion: z.literal('1.0'),
  generatedAt: z.iso.datetime(),
  fixtureCount: z.int().min(0),
  selection: EvalReportSelectionSchema,
  scoring: EvalReportScoringSchema.default({
    semanticMatcher: 'deterministic'
  }),
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
