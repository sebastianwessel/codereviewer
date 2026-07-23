import { z } from 'zod'
import {
  ContextLedgerIdSchema,
  ContextRequestSchema,
  EvidenceRecordSchema,
  FindingProvenanceSchema,
  RejectedFindingSchema,
  RepositoryRelativePathSchema,
  ReviewReportSchema,
  SeveritySchema,
  type ReviewReport
} from '../../../shared/contracts/index.js'
import {
  CandidateFindingSchema
} from '../../admission/index.js'
import { ReviewTaskSchema as PlannedReviewTaskSchema } from '../../review-planning/index.js'

export const ContextDocumentSchema = z.strictObject({
  path: RepositoryRelativePathSchema,
  content: z.string(),
  allowed: z.boolean(),
  ledgerEntryId: ContextLedgerIdSchema.optional()
})

export const SkillContextDocumentSchema = z.strictObject({
  name: z.string().min(1),
  path: RepositoryRelativePathSchema,
  directory: RepositoryRelativePathSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  allowed: z.boolean()
})

export const ReviewContextDocumentSchema = z.strictObject({
  // 'referenced-definition' carries a bounded digest of an UNCHANGED file that a
  // changed file imports (R4). 'change-intent' carries the redacted, summarized
  // brief of external change-intent context (spec 11). Both are context only:
  // findings remain restricted to task.paths and these entries are not review
  // targets.
  kind: z.enum([
    'file',
    'support-signal-output',
    'test-mapping',
    'referenced-definition',
    'change-intent'
  ]),
  path: RepositoryRelativePathSchema.optional(),
  content: z.string(),
  ledgerEntryId: ContextLedgerIdSchema
})

export const WorkflowReviewTaskSchema = PlannedReviewTaskSchema.extend({
  reviewContext: z.array(ReviewContextDocumentSchema).default([])
})

export const WorkflowTaskEventSchema = z.strictObject({
  id: PlannedReviewTaskSchema.shape.id,
  kind: PlannedReviewTaskSchema.shape.kind,
  round: PlannedReviewTaskSchema.shape.round,
  paths: PlannedReviewTaskSchema.shape.paths,
  state: z.enum(['planned', 'running', 'completed', 'failed']),
  workerId: z.string().min(1).optional(),
  message: z.string().min(1).optional()
})

export const WorkflowAdmissionDecisionSchema = z.strictObject({
  candidateId: z.string().min(1),
  status: z.enum(['admitted', 'rejected', 'needs-more-evidence']),
  findingId: z.string().min(1).optional(),
  rejectedReason: RejectedFindingSchema.shape.reason.optional(),
  supersedes: z.string().min(1).optional()
})

export const QualityGateThresholdsSchema = z.strictObject({
  maxCritical: z.int().min(0).optional(),
  maxHigh: z.int().min(0).optional(),
  maxMedium: z.int().min(0).optional(),
  failOnProviderError: z.boolean().optional(),
  failOnNewOnly: z.boolean().optional()
})

export const WorkflowAdmissionPolicySchema = z.strictObject({
  inlineSeverityThreshold: SeveritySchema,
  actionableSeverityThreshold: SeveritySchema,
  admittedAt: z.string().datetime()
})

export const ReviewedLineRangeSchema = z.strictObject({
  path: RepositoryRelativePathSchema,
  startLine: z.int().min(1),
  endLine: z.int().min(0)
})

export const ReviewedDiffRangeSchema = z.strictObject({
  path: RepositoryRelativePathSchema,
  startLine: z.int().min(1),
  endLine: z.int().min(0),
  changeKind: z.enum(['new', 'modified', 'deleted']).optional()
})

export const WorkflowProvenanceInputSchema = FindingProvenanceSchema.omit({
  instructionHashes: true,
  skillHashes: true
})

export const BaselineFingerprintRecordSchema = z.strictObject({
  fingerprints: z.array(
    z.strictObject({
      algorithm: z.string().min(1),
      value: z.string().regex(/^[a-z0-9]+$/)
    })
  )
})

const normalizeModelEnumValue = <T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  aliases: Readonly<Record<string, T>>
): unknown => {
  if (typeof value !== 'string') {
    return value
  }

  const key = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')

  if ((allowedValues as readonly string[]).includes(key)) {
    return key
  }

  return aliases[key] ?? value
}

const normalizeUnknownModelCategoryFromText = (text: string): unknown => {
  const key = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')

  if (key.length === 0) {
    return undefined
  }

  if (/(?:^|-)(?:security|vulnerability|authz|authorization|unauthorized|bypass|token|secret|leak)(?:-|$)/u.test(key)) {
    return 'security'
  }

  if (/(?:^|-)(?:performance|perf|latency|memory|expensive|slow|concurrent|race|lock|cache)(?:-|$)/u.test(key)) {
    return 'performance'
  }

  if (
    /(?:^|-)(?:bug|defect|regression|correctness|logic|functional|reliability|billing|business|discount|calculation|financial|finance|overcharged|undercharged|prorated|omits|omitted|missing|wrong|incorrect|crash|panic|exception|stale|data-loss)(?:-|$)/u.test(
      key
    )
  ) {
    return 'bug'
  }

  return undefined
}

const normalizeModelCategoryValue = (value: unknown): unknown => {
  const exact = normalizeModelEnumValue(value, modelCategoryValues, {
    bugs: 'bug',
    correctness: 'bug',
    logic: 'bug',
    'logic-error': 'bug',
    'functional-correctness': 'bug',
    functional: 'bug',
    concurrency: 'bug',
    reliability: 'bug',
    pricing: 'bug',
    'pricing-bug': 'bug',
    'pricing-correctness': 'bug',
    'pricing-logic': 'bug',
    billing: 'bug',
    'billing-bug': 'bug',
    'billing-correctness': 'bug',
    'billing-logic': 'bug',
    business: 'bug',
    'business-correctness': 'bug',
    'business-logic': 'bug',
    businesslogic: 'bug',
    'business-rule': 'bug',
    discount: 'bug',
    'discount-bug': 'bug',
    'discount-correctness': 'bug',
    'discount-logic': 'bug',
    calculation: 'bug',
    'calculation-logic': 'bug',
    financial: 'bug',
    finance: 'bug',
    'race-condition': 'security',
    vulnerability: 'security',
    vulnerabilities: 'security',
    perf: 'performance',
    maintenance: 'maintainability',
    naming: 'maintainability',
    consistency: 'maintainability',
    'naming-consistency': 'maintainability',
    readability: 'maintainability'
  })

  if (typeof exact !== 'string' || exact !== value || typeof value !== 'string') {
    return exact
  }

  const key = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')

  if (/(?:^|-)(?:security|vulnerability|authz|authorization)(?:-|$)/u.test(key)) {
    return 'security'
  }

  if (/(?:^|-)(?:performance|perf|latency|memory)(?:-|$)/u.test(key)) {
    return 'performance'
  }

  if (/(?:^|-)(?:maintainability|maintenance|readability|naming)(?:-|$)/u.test(key)) {
    return 'maintainability'
  }

  if (/(?:^|-)(?:compatibility|migration|portable|portability)(?:-|$)/u.test(key)) {
    return 'compatibility'
  }

  if (/(?:^|-)(?:policy|compliance)(?:-|$)/u.test(key)) {
    return 'policy'
  }

  if (/(?:^|-)(?:test|tests|testing)(?:-|$)/u.test(key)) {
    return 'test'
  }

  if (
    /(?:^|-)(?:bug|defect|regression|correctness|logic|functional|reliability|concurrency|pricing|billing|business|discount|calculation|financial|finance|issue|problem|risk|flaw)(?:-|$)/u.test(
      key
    )
  ) {
    return 'bug'
  }

  return value
}

const normalizeModelLineValue = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value
  }

  const trimmed = value.trim()

  return /^\d+$/u.test(trimmed) ? Number(trimmed) : value
}

const normalizeModelEvidenceIds = (value: unknown): unknown =>
  typeof value === 'string' ? [value] : value

const normalizeModelStringArray = (value: unknown): unknown =>
  typeof value === 'string' ? [value] : value

const truncateModelString = (value: unknown, maxLength: number): unknown =>
  typeof value === 'string' && value.length > maxLength
    ? value.slice(0, maxLength)
    : value

const ModelFixEditSuggestionSchema = z.strictObject({
  path: RepositoryRelativePathSchema,
  startLine: z.preprocess(normalizeModelLineValue, z.int().min(1)),
  endLine: z.preprocess(normalizeModelLineValue, z.int().min(1)),
  replacement: z.string().min(1).max(4000),
  description: z.string().min(1).max(500).optional()
})

const modelCategoryValues = CandidateFindingSchema.shape.category.options
const modelSeverityValues = CandidateFindingSchema.shape.severity.options

const modelNestedLocationValue = (
  record: Record<string, unknown>,
  objectKey: string,
  key: string
): unknown => {
  const location = record[objectKey]

  if (
    typeof location !== 'object' ||
    location === null ||
    Array.isArray(location)
  ) {
    return undefined
  }

  return (location as Record<string, unknown>)[key]
}

const modelLocationValue = (
  record: Record<string, unknown>,
  key: string
): unknown =>
  modelNestedLocationValue(record, 'primaryLocation', key) ??
  modelNestedLocationValue(record, 'location', key)

// Holistic discovery emits loosely structured raw findings. This schema
// normalizes the category/severity/path/startLine fields that holistic needs to
// build a CandidateFinding, tolerating common model-output drift (aliases,
// stringified line numbers, nested location objects).
export const ModelHolisticFindingSchema = z.preprocess((value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value
  }

  const record = value as Record<string, unknown>
  const rawCategory = record.category ?? record.type
  const normalizedCategory = normalizeModelCategoryValue(rawCategory)
  const category =
    normalizedCategory !== rawCategory
      ? normalizedCategory
      : normalizeUnknownModelCategoryFromText(
          [
            rawCategory,
            record.title,
            record.summary,
            record.hypothesis,
            record.description,
            record.rationaleSummary,
            record.rationale
          ]
            .filter((part): part is string => typeof part === 'string')
            .join('\n')
        ) ?? normalizedCategory

  return {
    category,
    severity: record.severityHint ?? record.severity,
    title: record.title ?? record.summary,
    description:
      record.hypothesis ??
      record.description ??
      record.rationaleSummary ??
      record.rationale,
    path:
      record.path ??
      record.filePath ??
      record.file ??
      modelLocationValue(record, 'path') ??
      modelLocationValue(record, 'filePath') ??
      modelLocationValue(record, 'file'),
    startLine:
      record.startLine ??
      record.start_line ??
      record.lineNumber ??
      record.line ??
      modelLocationValue(record, 'startLine') ??
      modelLocationValue(record, 'start_line') ??
      modelLocationValue(record, 'lineNumber') ??
      modelLocationValue(record, 'line'),
    evidenceIds: record.evidenceIds ?? record.evidence_ids,
    contextRequests: record.contextRequests ?? record.context_requests,
    requestedContext: record.requestedContext ?? record.requested_context,
    fixSummary: record.fixSummary ?? record.fix_summary ?? record.suggestedFix,
    fixEdits: record.fixEdits ?? record.fix_edits
  }
}, z.object({
  category: z
    .preprocess(
      normalizeModelCategoryValue,
      CandidateFindingSchema.shape.category.optional()
    ),
  severity: z
    .preprocess(
      (value) =>
        normalizeModelEnumValue(value, modelSeverityValues, {
          blocker: 'critical',
          severe: 'high',
          major: 'high',
          moderate: 'medium',
          warning: 'medium',
          minor: 'low',
          informational: 'info'
        }),
      CandidateFindingSchema.shape.severity.optional()
    ),
  title: z.string().min(1).max(500).optional(),
  description: z.string().min(1).max(3000).optional(),
  path: RepositoryRelativePathSchema.optional(),
  startLine: z
    .preprocess(normalizeModelLineValue, z.int().min(1).optional()),
  evidenceIds: z
    .preprocess(normalizeModelEvidenceIds, z.array(z.string()).optional())
    .catch(undefined),
  contextRequests: z.array(ContextRequestSchema).max(10).optional().catch(undefined),
  requestedContext: z
    .preprocess(
      normalizeModelStringArray,
      z.array(z.string().min(1).max(300)).max(10).optional()
    )
    .catch(undefined),
  fixSummary: z.string().min(1).max(1200).optional(),
  fixEdits: z
    .array(ModelFixEditSuggestionSchema)
    .max(5)
    .optional()
    .catch(undefined)
}))

// Dedicated holistic discovery input. Holistic review gets a single clean,
// line-numbered presentation of the changed files plus the diff ranges - this
// matches the input shape that made holistic review out-recall the gauntlet in
// probes (a structured packet buries the source and dilutes whole-file
// reasoning).
export const HolisticReviewInputSchema = z.strictObject({
  runId: z.string().min(1),
  taskId: z.string().min(1),
  paths: z.array(RepositoryRelativePathSchema),
  reviewText: z.string().min(1)
})

export type HolisticReviewInput = z.infer<typeof HolisticReviewInputSchema>

// Holistic discovery output. Loose (tolerates model output drift); each raw
// finding is normalized via ModelHolisticFindingSchema and mapped to a
// CandidateFinding downstream.
export const ModelHolisticReviewResultSchema = z.strictObject({
  findings: z.array(z.unknown()).default([])
})

export type ModelHolisticReviewResult = z.infer<
  typeof ModelHolisticReviewResultSchema
>

export type HolisticReviewRunner = (
  input: HolisticReviewInput,
  signal: AbortSignal | undefined
) => Promise<ModelHolisticReviewResult>

export const TaskReviewInputSchema = z.strictObject({
  runId: z.string().min(1),
  task: WorkflowReviewTaskSchema,
  reviewedDiffRanges: z.array(ReviewedDiffRangeSchema).default([]),
  evidence: z.array(EvidenceRecordSchema),
  candidates: z.array(CandidateFindingSchema),
  instructions: z.array(ContextDocumentSchema),
  skills: z.array(SkillContextDocumentSchema),
  sharedDigest: z.string(),
  provenance: WorkflowProvenanceInputSchema
})

export const TaskReviewResultSchema = z.strictObject({
  candidates: z.array(CandidateFindingSchema),
  evidenceRecords: z.array(EvidenceRecordSchema).default([]),
  providerIssues: ReviewReportSchema.shape.providerIssues.default([])
})

export const FindingRefutationInputSchema = z.strictObject({
  runId: z.string().min(1),
  candidate: CandidateFindingSchema,
  reviewedDiffRanges: z.array(ReviewedDiffRangeSchema).default([]),
  evidence: z.array(EvidenceRecordSchema),
  supportSignalCandidates: z.array(CandidateFindingSchema),
  reviewContext: z.array(ReviewContextDocumentSchema),
  instructions: z.array(ContextDocumentSchema),
  skills: z.array(SkillContextDocumentSchema),
  sharedDigest: z.string(),
  provenance: WorkflowProvenanceInputSchema
})

export const FindingRefutationResultSchema = z.strictObject({
  verdict: z.enum(['proved', 'refuted', 'needs-more-evidence']),
  rationaleSummary: z.string().min(1).max(1200),
  fixSummary: z.string().min(1).max(1200).optional(),
  fixEdits: z
    .array(
      z.strictObject({
        path: RepositoryRelativePathSchema,
        startLine: z.int().min(1),
        endLine: z.int().min(1),
        replacement: z.string().min(1).max(4000),
        description: z.string().min(1).max(500).optional()
      })
    )
    .max(5)
    .optional()
})

export const ModelFindingRefutationResultSchema = z.preprocess((value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value
  }

  const record = value as Record<string, unknown>

  return {
    verdict: record.verdict ?? record.decision ?? record.status,
    rationaleSummary:
      record.rationaleSummary ??
      record.summary ??
      record.rationale ??
      record.reason,
    fixSummary: record.fixSummary ?? record.fix_summary ?? record.suggestedFix,
    fixEdits: record.fixEdits ?? record.fix_edits
  }
}, z.object({
  verdict: z.preprocess(
    (value) =>
      normalizeModelEnumValue(
        value,
        ['proved', 'refuted', 'needs-more-evidence'] as const,
        {
          valid: 'proved',
          accepted: 'proved',
          actionable: 'proved',
          invalid: 'refuted',
          rejected: 'refuted',
          'false-positive': 'refuted',
          falsepositive: 'refuted',
          unproven: 'needs-more-evidence',
          uncertain: 'needs-more-evidence',
          unknown: 'needs-more-evidence',
          inconclusive: 'needs-more-evidence'
        }
      ),
    z.enum(['proved', 'refuted', 'needs-more-evidence'])
  ),
  rationaleSummary: z.preprocess(
    (value) => truncateModelString(value, 1200),
    FindingRefutationResultSchema.shape.rationaleSummary
  ),
  fixSummary: z
    .preprocess(
      (value) => truncateModelString(value, 1200),
      FindingRefutationResultSchema.shape.fixSummary
    )
    .catch(undefined),
  fixEdits: FindingRefutationResultSchema.shape.fixEdits.catch(undefined)
}))

const normalizeRefutationVerdict = (
  verdict: z.infer<typeof ModelFindingRefutationResultSchema>['verdict']
): z.infer<typeof FindingRefutationResultSchema>['verdict'] => verdict

export const normalizeFindingRefutationResult = (
  result: z.infer<typeof ModelFindingRefutationResultSchema>
): z.infer<typeof FindingRefutationResultSchema> =>
  FindingRefutationResultSchema.parse({
    ...result,
    verdict: normalizeRefutationVerdict(result.verdict)
  })

export type WorkflowReviewTask = z.infer<typeof WorkflowReviewTaskSchema>
export type WorkflowTaskEvent = z.infer<typeof WorkflowTaskEventSchema>
export type ReviewContextDocument = z.infer<typeof ReviewContextDocumentSchema>
export type ContextDocument = z.infer<typeof ContextDocumentSchema>
export type SkillContextDocument = z.infer<typeof SkillContextDocumentSchema>
export type TaskReviewInput = z.infer<typeof TaskReviewInputSchema>
export type TaskReviewResult = z.infer<typeof TaskReviewResultSchema>
export type FindingRefutationInput = z.infer<typeof FindingRefutationInputSchema>
export type FindingRefutationResult = z.infer<
  typeof FindingRefutationResultSchema
>
export type ModelHolisticFinding = z.infer<typeof ModelHolisticFindingSchema>
export type ProviderIssue = ReviewReport['providerIssues'][number]
export type FindingRefutationRunner = (
  input: FindingRefutationInput,
  signal: AbortSignal | undefined
) => Promise<FindingRefutationResult>
