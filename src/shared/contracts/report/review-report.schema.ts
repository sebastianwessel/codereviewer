import { z } from 'zod'
import {
  ReportFormatSchema,
  RepositoryRelativePathSchema,
  ReviewDepthSchema,
  ReviewModeSchema
} from '../config/config.schema.js'
import {
  AdmittedFindingSchema,
  ContractIdSchema,
  EvidenceRecordSchema,
  FindingFingerprintSchema,
  RejectedFindingSchema,
  RefutationResultSchema,
  Sha256Schema,
  TaskIdSchema
} from '../findings/finding.schema.js'

export const RunSummarySchema = z.strictObject({
  runId: z.string().min(1),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  mode: ReviewModeSchema,
  depth: ReviewDepthSchema,
  repositoryRootHash: Sha256Schema,
  baseRef: z.string().optional(),
  headRef: z.string().optional(),
  // Commit the diff was actually taken against: the merge base of baseRef and
  // headRef. Absent for explicit-file runs, which bypass git entirely.
  mergeBaseRef: z.string().optional(),
  configHash: Sha256Schema,
  provider: z.string().optional(),
  model: z.string().optional(),
  durationMs: z.int().min(0),
  costUsd: z.number().min(0).optional(),
  inputTokens: z.int().min(0).optional(),
  // Cached input tokens are a SUBSET of inputTokens (already counted there).
  cachedInputTokens: z.int().min(0).optional(),
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

// Spec 27. What DISCOVERY produced, as distinct from what survived refutation and
// admission. Every figure here was already computed — and then thrown away in a
// `logger.debug` line, with debug logging off for every paid evaluation run. That
// is why no measurement this project has made can say whether the measured
// ~1.2-findings-per-file ceiling originates in discovery or is imposed later by the
// stages after it. Nothing new has to be measured; it only has to be recorded, and
// recording it here answers the question from runs that were going to happen anyway.
export const DiscoveryTelemetrySchema = z.strictObject({
  // Discovery calls actually issued to the provider: one per partition per pass
  // (spec 27), plus the extra calls a reactive split produced (spec 26). Yield is
  // CALL-bound, so no discovery number means anything without the count of looks
  // that produced it.
  callCount: z.int().min(0),
  // Raw findings the model returned, counted BEFORE the schema parse, the
  // `task.paths` scope filter, the per-call candidate cap, and the merge. This is
  // the load-bearing number: it is the only one that reflects what discovery
  // actually produced rather than what later stages let through, and it is the
  // difference between "the reviewer did not look harder" and "it did, and the
  // filters removed the difference".
  rawFindingCount: z.int().min(0),
  // The same figure per CALL, in issue order. A total cannot answer the open
  // question, which is about the SHAPE of the distribution: a hard ceiling at
  // roughly one finding per file and a broad spread with the same mean imply
  // different fixes. Length equals `callCount` by construction.
  rawFindingsPerCall: z.array(z.int().min(0)),
  // Candidates surviving collection: post-parse, post-scope, post-cap,
  // post-suppression, and before the semantic merge groups duplicates away.
  candidateCount: z.int().min(0),
  // Raw findings that never became candidates, separated by cause. A finding that
  // failed to parse or named an out-of-scope path is a different problem from one
  // suppressed as a duplicate, and one counter for all of them hides each behind
  // the others.
  droppedCount: z.int().min(0),
  suppressedByIdCount: z.int().min(0),
  suppressedByLocationCount: z.int().min(0),
  // Spec 26: how many times the provider refused a packet and it was halved. Named
  // apart from transient retry on purpose — an oversize split and a rate-limit retry
  // have different causes and different meanings.
  contextOverflowSplitCount: z.int().min(0),
  // Spec 05 merge counters. Both are needed: "the merge is not firing" (no calls)
  // and "there was nothing to merge" (calls, no groups) are indistinguishable from a
  // candidate count alone, and they have opposite fixes.
  mergeCallCount: z.int().min(0),
  mergeGroupCount: z.int().min(0),
  mergedAwayCount: z.int().min(0)
})

export const TaskDiscoveryTelemetrySchema = DiscoveryTelemetrySchema.extend({
  taskId: TaskIdSchema
})

export const ReviewDiscoveryReportSchema = z.strictObject({
  // Summed across every task in the run. `rawFindingsPerCall` concatenates the
  // per-task arrays, so the run-level distribution is recoverable too.
  totals: DiscoveryTelemetrySchema,
  // Kept per task as well because it is free: the per-task rows are what a
  // comparison needs to pair arms case by case rather than only in aggregate.
  tasks: z.array(TaskDiscoveryTelemetrySchema)
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
  refutationResults: z.array(RefutationResultSchema),
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
  // Optional because a run whose findings came from deterministic signals alone
  // issued no discovery call, and a report written before this field existed has
  // none to state. Absent means "not recorded", which is not the same claim as a
  // recorded zero.
  discovery: ReviewDiscoveryReportSchema.optional(),
  artifacts: z.array(ReportArtifactSchema)
})

export type RunSummary = z.infer<typeof RunSummarySchema>
export type SkippedFile = z.infer<typeof SkippedFileSchema>
export type QualityGateResult = z.infer<typeof QualityGateResultSchema>
export type ReportArtifact = z.infer<typeof ReportArtifactSchema>
export type CoverageFile = z.infer<typeof CoverageFileSchema>
export type CoverageSummary = z.infer<typeof CoverageSummarySchema>
export type DiscoveryTelemetry = z.infer<typeof DiscoveryTelemetrySchema>
export type TaskDiscoveryTelemetry = z.infer<typeof TaskDiscoveryTelemetrySchema>
export type ReviewDiscoveryReport = z.infer<typeof ReviewDiscoveryReportSchema>
export type ReviewReport = z.infer<typeof ReviewReportSchema>
