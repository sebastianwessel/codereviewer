import { z } from 'zod'
import {
  ContextLedgerIdSchema,
  ContextRequestSchema,
  EvidenceRecordSchema,
  FindingProvenanceSchema,
  FixEditSchema,
  RejectedFindingSchema,
  RepositoryRelativePathSchema,
  ReviewReportSchema,
  SeveritySchema
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
  // Absolute line span this document occupies in its source file. Set for 'file'
  // chunks, because a file too large for one packet is split into several chunks
  // that each become their own task: without the origin the second chunk would be
  // presented (and its findings reported) as if it started at line 1. Absent for
  // context kinds that are not a span of a reviewed file.
  startLine: z.int().min(1).optional(),
  endLine: z.int().min(1).optional(),
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

// Re-exported from admission, which owns quality gating. Restating it here made
// two definitions of one contract and forced a cast at the boundary.
export { QualityGateThresholdsSchema } from '../../admission/index.js'

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

// Normalize a model-authored category/severity string to a comparison key:
// lowercase, non-alphanumerics collapsed to single dashes, no leading/trailing
// dash. Used across the model-enum normalizers so casing/punctuation differences
// between providers resolve to the same key.
const slugifyModelKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')

const normalizeModelEnumValue = <T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  aliases: Readonly<Record<string, T>>
): unknown => {
  if (typeof value !== 'string') {
    return value
  }

  const key = slugifyModelKey(value)

  if ((allowedValues as readonly string[]).includes(key)) {
    return key
  }

  return aliases[key] ?? value
}

type ModelCategory = (typeof modelCategoryValues)[number]

// The single source of truth for mapping a model-authored category word or
// phrase onto FindingCategorySchema's closed enum. Every key is already a
// `slugifyModelKey` output (lowercase, dash-separated), so it doubles as both an
// exact-phrase alias (the whole raw `category`/`type` field slugifies to this
// key) and, via `categoryTokenPatterns` below, a bounded keyword a free-text
// scan can find inside a longer title or description. Before this table
// existed, the same word reached the engine through three independent code
// paths that disagreed with each other (e.g. "race condition" filed under
// `security` while a description merely mentioning "race" or "lock" filed under
// `performance`); resolving both a structured field and free text through this
// one table is what makes that impossible again.
//
// Exported (read-only) so its tests can assert every entry resolves correctly
// by iterating this table directly, rather than hand-copying ~60 aliases into
// the test file where the two could silently drift apart.
export const modelCategoryAliases: Readonly<Record<string, ModelCategory>> = {
  // Correctness, logic, and reliability defects, including concurrency ones. A
  // race condition, deadlock, or other concurrency defect is a correctness bug
  // first: it MAY have security impact (e.g. a bypassed TOCTOU check), but
  // filing it under `security` on the strength of the word "race" alone hides
  // it from reviewers of ordinary correctness bugs, and spec 15 explicitly
  // scopes concurrency OUT of the dedicated security pass. It is not
  // `performance` either - a race is about producing a wrong result, not about
  // being slow.
  bugs: 'bug',
  defect: 'bug',
  regression: 'bug',
  correctness: 'bug',
  logic: 'bug',
  'logic-error': 'bug',
  functional: 'bug',
  'functional-correctness': 'bug',
  reliability: 'bug',
  issue: 'bug',
  problem: 'bug',
  risk: 'bug',
  flaw: 'bug',
  crash: 'bug',
  panic: 'bug',
  exception: 'bug',
  stale: 'bug',
  'data-loss': 'bug',
  wrong: 'bug',
  incorrect: 'bug',
  missing: 'bug',
  omitted: 'bug',
  omits: 'bug',
  concurrency: 'bug',
  concurrent: 'bug',
  race: 'bug',
  'race-condition': 'bug',
  deadlock: 'bug',
  lock: 'bug',
  // Domain-specific correctness defects (pricing/billing/discount math) are
  // still plain correctness bugs, not a category of their own - the engine's
  // enum has no "financial" category.
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
  overcharged: 'bug',
  undercharged: 'bug',
  prorated: 'bug',
  // Vulnerabilities and access-control failures. Deliberately narrow: words
  // that merely CO-OCCUR with security concerns elsewhere (like "race" above)
  // stay out of this list so they cannot re-create the original defect.
  vulnerability: 'security',
  vulnerabilities: 'security',
  authz: 'security',
  authorization: 'security',
  unauthorized: 'security',
  bypass: 'security',
  token: 'security',
  secret: 'security',
  leak: 'security',
  // Speed and resource-usage defects, not correctness defects.
  perf: 'performance',
  latency: 'performance',
  memory: 'performance',
  expensive: 'performance',
  slow: 'performance',
  cache: 'performance',
  // Readability/consistency/naming concerns.
  maintenance: 'maintainability',
  naming: 'maintainability',
  consistency: 'maintainability',
  'naming-consistency': 'maintainability',
  readability: 'maintainability',
  // Cross-platform/cross-version portability.
  migration: 'compatibility',
  portable: 'compatibility',
  portability: 'compatibility',
  // Policy/compliance rule violations.
  compliance: 'policy',
  // Test-suite defects.
  tests: 'test',
  testing: 'test'
} as const

// Categories are checked in this fixed priority order when a slug contains
// more than one alias's keyword, so the result depends on this explicit
// ordering rather than on `modelCategoryAliases`' incidental key order. `bug`
// is the catch-all and stays last.
const categoryResolutionPriority: readonly ModelCategory[] = [
  'security',
  'compatibility',
  'policy',
  'test',
  'maintainability',
  'performance',
  'bug'
]

// One bounded-keyword regex per category, built once from `modelCategoryAliases`
// so the token scan can never drift from the alias table it is derived from.
const categoryTokenPatterns = new Map<ModelCategory, RegExp>(
  categoryResolutionPriority
    .map((category) => {
      const tokens = Object.entries(modelCategoryAliases)
        .filter(([, mappedCategory]) => mappedCategory === category)
        .map(([token]) => token)

      return tokens.length === 0
        ? undefined
        : ([
            category,
            new RegExp(`(?:^|-)(?:${tokens.join('|')})(?:-|$)`, 'u')
          ] as const)
    })
    .filter((entry): entry is readonly [ModelCategory, RegExp] => entry !== undefined)
)

// Resolves an already-slugified key against the enum itself, then the exact
// alias table, then the bounded keyword scan. Shared by both the structured
// `category`/`type` field and the free-text fallback below so the two paths
// can never disagree.
const resolveModelCategoryFromSlug = (key: string): ModelCategory | undefined => {
  if ((modelCategoryValues as readonly string[]).includes(key)) {
    return key as ModelCategory
  }

  const exactAlias = modelCategoryAliases[key]

  if (exactAlias !== undefined) {
    return exactAlias
  }

  for (const category of categoryResolutionPriority) {
    if (categoryTokenPatterns.get(category)?.test(key)) {
      return category
    }
  }

  return undefined
}

// Resolves a finding's category from whatever the model actually sent. The
// structured `category`/`type` field is authoritative when it resolves to
// anything at all (via the enum, an alias, or a keyword inside it); free text
// (title/summary/description/...) is consulted only when the structured value
// resolves to nothing, which covers a reviewer that stated the defect's nature
// in prose without filling in - or without correctly filling in - the
// structured field.
const resolveModelCategory = (
  structuredValue: unknown,
  freeTextParts: readonly unknown[]
): ModelCategory | undefined => {
  if (typeof structuredValue === 'string') {
    const fromStructuredValue = resolveModelCategoryFromSlug(
      slugifyModelKey(structuredValue)
    )

    if (fromStructuredValue !== undefined) {
      return fromStructuredValue
    }
  }

  const key = slugifyModelKey(
    [structuredValue, ...freeTextParts]
      .filter((part): part is string => typeof part === 'string')
      .join('\n')
  )

  return key.length === 0 ? undefined : resolveModelCategoryFromSlug(key)
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
  const category = resolveModelCategory(rawCategory, [
    record.title,
    record.summary,
    record.hypothesis,
    record.description,
    record.rationaleSummary,
    record.rationale
  ])

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
    requestedContext: record.requestedContext ?? record.requested_context
  }
}, z.object({
  // Already resolved to a valid category (or left `undefined`) by
  // `resolveModelCategory` in the preprocess step above, so this field needs no
  // preprocessing of its own - giving it one would just re-run normalization on
  // an already-normalized value through a second, independent path, which is
  // the exact duplication this schema is meant to have eliminated.
  category: CandidateFindingSchema.shape.category.optional(),
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
  // Over-long text TRUNCATES; it does not kill the finding.
  //
  // These were bare `.max()` bounds, so a description one character over the limit
  // failed validation and the WHOLE finding was discarded — while a description one
  // character under was accepted and then sliced to 1200 downstream anyway. A real
  // defect was thrown away for being verbose, by code that was about to shorten it
  // regardless. Same preprocessor the refuter's fields already use.
  title: z.preprocess(
    (value) => truncateModelString(value, 500),
    z.string().min(1).max(500).optional()
  ),
  description: z.preprocess(
    (value) => truncateModelString(value, 3000),
    z.string().min(1).max(3000).optional()
  ),
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
    .catch(undefined)
}))

// Dedicated holistic discovery input. Holistic review gets a single clean,
// line-numbered presentation of the changed files plus the diff ranges - this
// matches the input shape that made holistic review out-recall the gauntlet in
// probes (a structured packet buries the source and dilutes whole-file
// reasoning).
export const HolisticReviewInputSchema = z.strictObject({
  taskId: z.string().min(1),
  paths: z.array(RepositoryRelativePathSchema),
  reviewText: z.string().min(1)
})

export type HolisticReviewInput = z.infer<typeof HolisticReviewInputSchema>

// Holistic discovery output. Loose (tolerates model output drift); each raw
// finding is normalized via ModelHolisticFindingSchema and mapped to a
// CandidateFinding downstream.
//
// `findings` is REQUIRED, deliberately. The provider's Responses API reports a
// response truncated by the output-token budget as `status: 'incomplete'`, which
// the adapter does not treat as a failure, and an empty body becomes `{}`. With a
// default, `{}` parsed to "no findings" — so a review that ran out of budget was
// indistinguishable from a file with no defects, in the review AND in the eval
// that scores it. Requiring the key makes that response fail validation, which
// discovery already degrades into a recorded, recovered provider issue. The
// reviewer is explicitly instructed to return {"findings": []} for a clean file,
// so a well-formed empty result is still cheap to express.
export const ModelHolisticReviewResultSchema = z.strictObject({
  findings: z.array(z.unknown())
})

export type ModelHolisticReviewResult = z.infer<
  typeof ModelHolisticReviewResultSchema
>

export type HolisticReviewRunner = (
  input: HolisticReviewInput,
  signal: AbortSignal | undefined
) => Promise<ModelHolisticReviewResult>

// Semantic finding merge input (spec 05). One call per FILE that carries two or
// more candidates: the model reads the candidate descriptions plus the file and
// answers only which candidates describe the same underlying defect.
//
// Field order is load-bearing for prompt caching. The packet is serialized in
// declaration order, so everything that is stable for a given repository state
// comes first — `taskId` is derived from the task's kind and paths, `path` names
// the file, and `fileText` is the file itself, by far the longest section. The
// candidates, the only part that changes when discovery phrases a defect
// differently, come last, so two runs over the same file share the longest
// possible prefix. A run identifier is deliberately absent for the reason
// recorded on the refutation packet below: a fresh UUID in front of the packet
// cut the shared prefix to roughly thirty tokens against a 1024-token minimum
// and bought a guaranteed cache miss.
export const SemanticMergeInputSchema = z.strictObject({
  taskId: z.string().min(1),
  path: RepositoryRelativePathSchema,
  fileText: z.string().min(1),
  // Two is the floor by contract, not by convention: a merge call issued for a
  // single candidate can only ever answer "no groups", so it is pure cost and a
  // bug. Making it unrepresentable is cheaper than remembering to check.
  candidates: z.array(CandidateFindingSchema).min(2)
})

export type SemanticMergeInput = z.infer<typeof SemanticMergeInputSchema>

// Loose by design, exactly like the refutation result: the provider
// receives an opaque array and the item SHAPE is specified in the instructions,
// because sending a rich item schema was measured to make structured output fail
// on larger responses. Each entry is normalized by `ModelSemanticMergeGroupSchema`.
//
// `groups` defaults to an empty array rather than being required. Holistic
// discovery requires its `findings` key so a response truncated by the output
// budget cannot be read as "no defects", but the same argument inverts here: the
// absence of grouping is the conservative answer this stage is required to fall
// back to, and its worst outcome is one redundant comment.
export const ModelSemanticMergeResultSchema = z.strictObject({
  groups: z.array(z.unknown()).default([])
})

export type ModelSemanticMergeResult = z.infer<
  typeof ModelSemanticMergeResultSchema
>

// Accepts a group member as a bare id string or as an object carrying one, since
// a model asked for ids routinely answers with the candidate objects instead.
const semanticMergeMemberId = (entry: unknown): unknown => {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return entry
  }

  const record = entry as Record<string, unknown>

  return record.id ?? record.candidateId ?? record.candidate_id
}

// One group inside a merge response: the ids of candidates that describe a
// single underlying defect. Tolerant of the usual output drift (a bare array
// instead of an object, field aliases, candidate objects instead of ids) because
// an unparseable group costs a grouping that was correctly identified.
export const ModelSemanticMergeGroupSchema = z.preprocess((value) => {
  const members = Array.isArray(value)
    ? value
    : typeof value === 'object' && value !== null
      ? ((value as Record<string, unknown>).candidateIds ??
        (value as Record<string, unknown>).candidate_ids ??
        (value as Record<string, unknown>).ids ??
        (value as Record<string, unknown>).members ??
        (value as Record<string, unknown>).candidates)
      : value

  return {
    candidateIds: Array.isArray(members)
      ? members.map(semanticMergeMemberId)
      : members
  }
}, z.object({
  candidateIds: z.array(z.string().min(1)).min(2)
}))

/**
 * Resolves a merge response into the groups the reduction may act on.
 *
 * Everything discarded here is discarded towards NOT merging, which is the
 * direction the spec requires when the answer is not trustworthy: an id the
 * model invented does not exist to merge, a candidate named in two groups makes
 * the reduction ambiguous (so only its first group is honoured), and a group of
 * fewer than two known candidates cannot merge anything.
 */
export const semanticMergeGroups = (
  result: ModelSemanticMergeResult,
  knownCandidateIds: readonly string[]
): readonly (readonly string[])[] => {
  const known = new Set(knownCandidateIds)
  const grouped = new Set<string>()
  const groups: (readonly string[])[] = []

  for (const raw of result.groups) {
    const parsed = ModelSemanticMergeGroupSchema.safeParse(raw)

    if (!parsed.success) {
      continue
    }

    const members: string[] = []

    for (const candidateId of parsed.data.candidateIds) {
      if (!known.has(candidateId) || grouped.has(candidateId)) {
        continue
      }

      grouped.add(candidateId)
      members.push(candidateId)
    }

    if (members.length < 2) {
      // Release the members again: a group that did not survive filtering must
      // not consume ids a later, well-formed group could legitimately claim.
      for (const candidateId of members) {
        grouped.delete(candidateId)
      }

      continue
    }

    groups.push(members)
  }

  return groups
}

export type SemanticMergeRunner = (
  input: SemanticMergeInput,
  signal: AbortSignal | undefined
) => Promise<ModelSemanticMergeResult>

export const TaskReviewInputSchema = z.strictObject({
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
  providerIssues: ReviewReportSchema.shape.providerIssues.default([]),
  // Candidates the task itself decided are terminal before refutation ever sees
  // them. The semantic finding merge (spec 05) fills this with the
  // non-representative member of each group: the spec requires them to be
  // recorded rather than silently dropped, so the merge stays auditable and its
  // rate observable in the report instead of only in a debug log line.
  rejectedFindings: z.array(RejectedFindingSchema).default([]),
  // The tasks discovery was ACTUALLY issued for — partitions (spec 27) and reactive
  // split halves (spec 26), not the planned task. Admission validates a finding's
  // line against the span its own call was shown, and those sub-tasks carry
  // synthetic ids that match nothing in the planned task list.
  reviewedTasks: z.array(WorkflowReviewTaskSchema).default([])
})

export const FindingRefutationResultSchema = z.strictObject({
  verdict: z.enum(['proved', 'refuted', 'needs-more-evidence']),
  rationaleSummary: z.string().min(1).max(1200),
  fixSummary: z.string().min(1).max(1200).optional(),
  fixEdits: z.array(FixEditSchema).max(5).optional()
})

// The adjudication fields a refuter returns for one candidate, defined once and
// reused by the single-candidate and batched result schemas so the two can never
// drift apart.
const refutationVerdictFields = {
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
} as const

// The adjudication fields as the model may return them, before they are hardened
// into a `FindingRefutationResult`. Derived from the shared field map so the input
// type cannot drift from what the batch schema actually accepts.
type ModelRefutationVerdictFields = z.infer<
  z.ZodObject<typeof refutationVerdictFields>
>

// Picks only the adjudication fields. The batched verdict a caller holds also
// carries the `candidateId` that binds it to its candidate, and the result schema is
// strict, so copying the input wholesale would throw on that extra key.
export const normalizeFindingRefutationResult = (
  result: ModelRefutationVerdictFields
): z.infer<typeof FindingRefutationResultSchema> =>
  FindingRefutationResultSchema.parse({
    verdict: result.verdict,
    rationaleSummary: result.rationaleSummary,
    ...(result.fixSummary === undefined ? {} : { fixSummary: result.fixSummary }),
    ...(result.fixEdits === undefined ? {} : { fixEdits: result.fixEdits })
  })

export type WorkflowReviewTask = z.infer<typeof WorkflowReviewTaskSchema>
export type WorkflowTaskEvent = z.infer<typeof WorkflowTaskEventSchema>
export type ReviewContextDocument = z.infer<typeof ReviewContextDocumentSchema>
export type ContextDocument = z.infer<typeof ContextDocumentSchema>
export type SkillContextDocument = z.infer<typeof SkillContextDocumentSchema>
export type TaskReviewInput = z.infer<typeof TaskReviewInputSchema>
export type TaskReviewResult = z.infer<typeof TaskReviewResultSchema>
export type FindingRefutationResult = z.infer<
  typeof FindingRefutationResultSchema
>

// Batched refutation (spec 05). One call adjudicates EVERY candidate raised for a
// task instead of one call per candidate. The per-candidate packet repeated the
// task's whole `reviewContext` — the changed file itself — once per candidate, so a
// task with 14 candidates sent that file 14 times; input tokens dominate this
// engine's cost at roughly 23:1 over output. The shared context is now sent once.
//
// A run identifier is deliberately NOT carried here. It was, and it sat first so
// that consecutive calls in one run would share the longest prefix — but a run id
// is a fresh UUID, so the shared prefix was only `{"runId":"run-<uuid>","taskId":"`,
// roughly thirty tokens, while the provider needs at least 1024 identical leading
// tokens before it caches anything. The field therefore bought no cache hit within
// a run and guaranteed a miss across runs, which a probe confirmed at zero cached
// tokens against 67,000 input tokens. Nothing ever read it back: it was written
// into the prompt and never consumed. Run correlation belongs in telemetry, which
// carries it already.
export const FindingRefutationBatchInputSchema = z.strictObject({
  provenance: WorkflowProvenanceInputSchema,
  instructions: z.array(ContextDocumentSchema),
  skills: z.array(SkillContextDocumentSchema),
  sharedDigest: z.string(),
  reviewContext: z.array(ReviewContextDocumentSchema),
  reviewedDiffRanges: z.array(ReviewedDiffRangeSchema).default([]),
  evidence: z.array(EvidenceRecordSchema),
  supportSignalCandidates: z.array(CandidateFindingSchema),
  candidates: z.array(CandidateFindingSchema).min(1)
})

// Loose by design, like holistic discovery's output: the provider receives an
// opaque array and the SHAPE is specified in the instructions, because sending a
// rich item schema was measured to make structured output fail on larger responses.
// Each entry is normalized by `ModelRefutationBatchVerdictSchema`.
export const ModelFindingRefutationBatchResultSchema = z.strictObject({
  verdicts: z.array(z.unknown()).default([])
})

// One adjudicated candidate inside a batch response: the per-candidate refutation
// shape plus the id that binds it back to its candidate. Reuses the existing
// verdict/rationale/fix normalization so batched and single verdicts cannot drift.
export const ModelRefutationBatchVerdictSchema = z.preprocess((value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value
  }

  const record = value as Record<string, unknown>

  return {
    candidateId:
      record.candidateId ?? record.candidate_id ?? record.id ?? record.candidate,
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
  candidateId: z.string().min(1),
  ...refutationVerdictFields
}))

export type FindingRefutationBatchInput = z.infer<
  typeof FindingRefutationBatchInputSchema
>
export type ModelFindingRefutationBatchResult = z.infer<
  typeof ModelFindingRefutationBatchResultSchema
>

// Resolves a batch response into one normalized verdict per candidate id. A
// candidate the model did not adjudicate is absent from the map; callers treat that
// as "no signal" (needs-more-evidence) rather than inventing a verdict.
export const refutationVerdictsByCandidateId = (
  result: ModelFindingRefutationBatchResult
): ReadonlyMap<string, FindingRefutationResult> => {
  const verdicts = new Map<string, FindingRefutationResult>()

  for (const raw of result.verdicts) {
    const parsed = ModelRefutationBatchVerdictSchema.safeParse(raw)

    if (!parsed.success || verdicts.has(parsed.data.candidateId)) {
      continue
    }

    verdicts.set(
      parsed.data.candidateId,
      normalizeFindingRefutationResult(parsed.data)
    )
  }

  return verdicts
}

export type FindingRefutationRunner = (
  input: FindingRefutationBatchInput,
  signal: AbortSignal | undefined
) => Promise<ModelFindingRefutationBatchResult>
