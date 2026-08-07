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
  // Files that never reached review at all — excluded by `review.maxFiles`, too
  // large for `review.maxFileBytes`, binary, deleted, unsupported.
  //
  // The counts below have always been over the files that DID reach review, so a
  // run that dropped 300 of 800 changed files could report "500 of 500
  // reviewable — complete". The Skipped Files section keeps `report.md` honest,
  // but a machine reading `coverage.status` alone — which is exactly what a CI
  // step does — saw a clean certificate. A proof of what was read has to state
  // what was never opened, or it is a proof of nothing.
  excludedFileCount: z.int().min(0),
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
  // Raw findings the PER-CALL CANDIDATE CAP refused. It was the only loss cause
  // here without a counter: the collection loop broke out before counting, so a
  // finding the model actually produced was discarded before refutation and left
  // no trace — recoverable only by subtracting every other counter from
  // `rawFindingCount`, which is not a thing a reader does. Nothing in this schema
  // is more important to keep honest, because a capped finding is a defect the
  // engine found and then threw away.
  cappedByLimitCount: z.int().min(0),
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

// Spec 29. Of the source files this change modified, which have no test file
// paired with them IN THIS SAME CHANGE. Deterministic, free, and computed from
// material the engine already produced: no model call, no configuration key.
//
// IT IS NOT A FINDING, AND THE SHAPE IS WHAT ENFORCES THAT. There is no id here,
// no severity, no category, no location, no evidence, no fingerprint — nothing
// that would let this join `admittedFindings`, cross the quality gate, reach the
// SARIF interchange or become an inline comment. Spec 23 reports extra scope as "a
// path and a line count and nothing else" precisely because doing more would
// assert something it cannot know; this reports a path and nothing at all, for the
// same reason.
//
// WHAT IT CANNOT KNOW, and why every count below says "in this change": the signal
// sees the changed file set and nothing else. A changed production file may be
// covered completely by an existing test the change had no reason to touch, and
// nothing here can tell that apart from a file with no test at all. Every
// rendering of this signal states that in words; a reader who takes
// `unpairedPaths` for "these files are untested" has been told the opposite.
const TestAdequacyUnknownSchema = z.strictObject({
  // Changed files in a language the deterministic signal registry has no adapter
  // for. A file the engine cannot parse cannot be paired with anything, so it is
  // UNKNOWN — never untested. Documentation, configuration and every unsupported
  // language land here, which is also why a docs-only change reports zero
  // considered files rather than a list.
  unsupportedLanguageFileCount: z.int().min(0),
  // Changed files that never reached the registry at all: too large, binary,
  // excluded by pattern, over the file cap, or unreadable. The pairing was
  // computed over the files that WERE analysed, so a file outside that set has no
  // answer rather than a negative one.
  //
  // Deleted paths are deliberately not counted here or anywhere else: a file the
  // change removes has nothing at head to carry a test.
  notAnalysedFileCount: z.int().min(0)
})

export const TestAdequacySignalSchema = z
  .strictObject({
    // Changed files the question could be asked of at all: analysed by the
    // registry, in a language it supports, and not themselves test material.
    consideredFileCount: z.int().min(0),
    // Considered files a test file in this same change pairs with, by each
    // language's own naming and location convention.
    pairedFileCount: z.int().min(0),
    // The considered files no test file in this change pairs with, sorted. A path
    // and nothing else.
    unpairedPaths: z.array(RepositoryRelativePathSchema),
    // Test-side files the change touched. Stated so the unpaired list can be read
    // against it: a change that adds tests in a tree of their own pairs nothing by
    // name and is not a change that carries no tests.
    changedTestFileCount: z.int().min(0),
    unknown: TestAdequacyUnknownSchema
  })
  .refine(
    (value) => value.pairedFileCount + value.unpairedPaths.length === value.consideredFileCount,
    {
      message:
        'consideredFileCount must equal pairedFileCount plus the unpaired paths',
      path: ['consideredFileCount']
    }
  )

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
  // Spec 29. Optional for the same reason `discovery` is: absent means THIS RUN
  // DID NOT COMPUTE IT, which is a different claim from a computed result whose
  // counts are zero. A completed run always records it, so a reader who finds it
  // missing is looking at a report some other producer wrote.
  testAdequacy: TestAdequacySignalSchema.optional(),
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
export type TestAdequacySignal = z.infer<typeof TestAdequacySignalSchema>
export type ReviewReport = z.infer<typeof ReviewReportSchema>
