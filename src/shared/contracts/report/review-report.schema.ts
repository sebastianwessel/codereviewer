import { z } from 'zod'
import { ReportFormatSchema, RepositoryRelativePathSchema } from '../config/config.schema.js'
import {
  AdmittedFindingSchema,
  ContractIdSchema,
  EvidenceRecordSchema,
  FindingAggregateResultSchema,
  FindingJudgeResultSchema,
  FindingFingerprintSchema,
  InvestigationTraceSchema,
  ModelTaskDiagnosticSchema,
  ModelSuspicionSchema,
  ProofPacketSchema,
  PromotionDecisionSchema,
  RejectedFindingSchema,
  RefutationResultSchema,
  ReviewIntentSchema,
  Sha256Schema,
  TaskIdSchema
} from '../findings/finding.schema.js'

export const ReviewModeSchema = z.enum(['local', 'ci', 'pr', 'full'])
export const ReviewDepthSchema = z.enum(['fast', 'balanced', 'thorough'])

export const RunSummarySchema = z.strictObject({
  runId: z.string().min(1),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  mode: ReviewModeSchema,
  depth: ReviewDepthSchema,
  repositoryRootHash: Sha256Schema,
  baseRef: z.string().optional(),
  headRef: z.string().optional(),
  configHash: Sha256Schema,
  provider: z.string().optional(),
  model: z.string().optional(),
  durationMs: z.int().min(0),
  costUsd: z.number().min(0).optional(),
  inputTokens: z.int().min(0).optional(),
  outputTokens: z.int().min(0).optional(),
  warnings: z.array(z.string())
})

export const SkippedFileSchema = z.strictObject({
  path: RepositoryRelativePathSchema,
  reason: z.enum([
    'deleted',
    'binary',
    'too-large',
    'too-many-files',
    'excluded',
    'unsupported',
    'error'
  ]),
  message: z.string().max(500).optional()
})

const QualityGateThresholdValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])

export const QualityGateResultSchema = z.strictObject({
  passed: z.boolean(),
  failingFindingIds: z.array(ContractIdSchema),
  thresholds: z.record(z.string(), QualityGateThresholdValueSchema),
  baselineFilteringApplied: z.boolean().optional()
})

export const ReportArtifactSchema = z.strictObject({
  format: ReportFormatSchema,
  path: RepositoryRelativePathSchema,
  sha256: Sha256Schema,
  containsSensitiveContent: z.literal(false)
})

export const CoverageFileSchema = z
  .strictObject({
    path: RepositoryRelativePathSchema,
    contentHash: Sha256Schema,
    status: z.enum(['complete', 'incomplete']),
    bytes: z.int().min(0),
    coveredBytes: z.int().min(0),
    taskIds: z.array(TaskIdSchema),
    incompleteReason: z.string().min(1).max(500).optional()
  })
  .refine((value) => value.coveredBytes <= value.bytes, {
    message: 'coveredBytes must not exceed bytes',
    path: ['coveredBytes']
  })

export const CoverageSummarySchema = z.strictObject({
  status: z.enum(['complete', 'incomplete']),
  reviewableFileCount: z.int().min(0),
  coveredFileCount: z.int().min(0),
  reviewableBytes: z.int().min(0),
  coveredBytes: z.int().min(0),
  incompleteReasons: z.array(z.string().min(1).max(500)),
  files: z.array(CoverageFileSchema)
})

export const ReviewReportSchema = z.strictObject({
  schemaVersion: z.literal('1.0'),
  run: RunSummarySchema,
  coverage: CoverageSummarySchema,
  admittedFindings: z.array(AdmittedFindingSchema),
  rejectedFindings: z.array(RejectedFindingSchema),
  evidence: z.array(EvidenceRecordSchema),
  skippedFiles: z.array(SkippedFileSchema),
  qualityGate: QualityGateResultSchema.optional(),
  reviewIntents: z.array(ReviewIntentSchema),
  modelSuspicions: z.array(ModelSuspicionSchema),
  modelTaskDiagnostics: z.array(ModelTaskDiagnosticSchema).default([]),
  investigationTraces: z.array(InvestigationTraceSchema),
  proofPackets: z.array(ProofPacketSchema),
  refutationResults: z.array(RefutationResultSchema),
  aggregateResults: z.array(FindingAggregateResultSchema),
  judgeResults: z.array(FindingJudgeResultSchema),
  promotionDecisions: z.array(PromotionDecisionSchema),
  providerIssues: z.array(
    z.strictObject({
      code: z.string().min(1),
      stage: z.string().min(1).optional(),
      recovered: z.boolean().optional(),
      message: z.string().min(1).max(500).optional()
    })
  ),
  // Baseline entries resolved since the baseline was recorded. Present when
  // `baseline.includeResolvedInReport` is enabled.
  resolvedBaselineEntries: z.array(FindingFingerprintSchema).optional(),
  artifacts: z.array(ReportArtifactSchema)
})

export type ReviewMode = z.infer<typeof ReviewModeSchema>
export type ReviewDepth = z.infer<typeof ReviewDepthSchema>
export type RunSummary = z.infer<typeof RunSummarySchema>
export type SkippedFile = z.infer<typeof SkippedFileSchema>
export type QualityGateResult = z.infer<typeof QualityGateResultSchema>
export type ReportArtifact = z.infer<typeof ReportArtifactSchema>
export type CoverageFile = z.infer<typeof CoverageFileSchema>
export type CoverageSummary = z.infer<typeof CoverageSummarySchema>
export type ReviewReport = z.infer<typeof ReviewReportSchema>
