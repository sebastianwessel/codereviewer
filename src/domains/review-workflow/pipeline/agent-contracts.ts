import { z } from 'zod'
import {
  ContextLedgerIdSchema,
  EvidenceRecordSchema,
  FindingProvenanceSchema,
  FixEditSchema,
  RefutationVerdictSchema,
  RejectedFindingSchema,
  RepositoryRelativePathSchema,
  ReviewReportSchema,
  SeveritySchema,
  TaskDiscoveryTelemetrySchema
} from '../../../shared/contracts/index.js'
import {
  CandidateFindingSchema
} from '../../admission/index.js'
import { ReviewTaskSchema as PlannedReviewTaskSchema } from '../../review-planning/index.js'
import {
  modelLocationValue,
  modelSeverityValues,
  normalizeModelCitationEntry,
  normalizeModelEnumValue,
  normalizeModelEvidenceIds,
  normalizeModelLineValue,
  resolveModelCategory,
  truncateModelQuote,
  truncateModelString
} from './model-output-normalization.js'


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
  // brief of external change-intent context (spec 11). 'analyzer-signal' carries
  // the ingested, changed-side-attributed results of analyzers this project's own
  // pipeline produced (spec 15, Mechanism 2). All three are context only: findings
  // remain restricted to task.paths, these entries are not review targets, and an
  // analyzer result in particular is evidence for the model to judge, never a
  // finding and never a route around refutation or admission.
  // 'test-mapping' was removed: nothing ever constructed one. The source-to-test
  // mappings it named are real and DO reach the model — serialized inside the
  // 'support-signal-output' document alongside the signal facts — so a second
  // kind for them was a second way to say one thing, not a missing capability.
  kind: z.enum([
    'file',
    'support-signal-output',
    'referenced-definition',
    'change-intent',
    'analyzer-signal'
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
  reviewContext: z.array(ReviewContextDocumentSchema).default([]),
  // The reviewer instruction documents THIS task's packets carry, already
  // resolved against `instructions.files[].scope` (spec 04) by context assembly.
  // It lives on the task rather than run-wide because a scoped instruction
  // reaches only the packets whose reviewed files match it, and a task is the
  // unit a packet is built from — discovery and refutation both read it here, so
  // the two stages cannot be given different instruction sets for one task.
  //
  // A sub-task (a spec 27 partition or a spec 26 reactive half) inherits this
  // list verbatim through `subTaskFrom`'s spread. That is deliberate: a sub-task
  // reviews a SUBSET of its parent's files, so re-resolving could only ever
  // withhold guidance the parent packet was going to show, and withheld guidance
  // is the direction this scoping is explicitly not allowed to fail in.
  instructions: z.array(ContextDocumentSchema).default([])
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
  changeKind: z.enum(['new', 'modified', 'deleted']).optional(),
  // Set only for a hunk that removed lines and added none, where the range is an
  // anchor at the removal point rather than a span of changed head-side lines.
  // Carried through the packets rather than stripped because a reader of a range
  // has to be able to tell the two apart; see `ReviewedDiffRange`.
  deletionAnchor: z.boolean().optional()
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

export const ModelFindingCitationSchema = z.preprocess(
  normalizeModelCitationEntry,
  z.object({
    path: RepositoryRelativePathSchema.optional(),
    startLine: z.int().min(1),
    // Truncated, not rejected, for the same reason title/description are below: a
    // quote one character over the cap is still a real quote, and a citation must
    // fail toward "absent" only when it cannot be trusted at all, never on a
    // length technicality.
    //
    // The ONLY unmarked cut in this file, and the mark is what would break it: the
    // cut quote is still a prefix of the source line and still verifies, while `…`
    // appended to it matches nothing and would cost the finding its evidence. See
    // `truncateModelQuote`.
    quote: z.preprocess(
      (value) => truncateModelQuote(value, 300),
      z.string().min(1).max(300)
    )
  })
)

export type ModelFindingCitation = z.infer<typeof ModelFindingCitationSchema>

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
    citations: record.citations ?? record.citation,
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
  // A structured array that fails to parse degrades to absent rather than killing
  // the whole finding, and an over-long array is capped rather than trimmed,
  // because a model that sent too many citations is not a reason to guess which
  // ones it meant.
  //
  // `contextRequests` and `requestedContext` used to sit here. Both were parsed,
  // validated and capped, and read by NOTHING: there is no on-demand-context
  // consumer anywhere, so a model asking for more context was answered by
  // silence. Cross-file retrieval (spec 16) is how a discovery call actually gets
  // more context, and it is a tool the model calls, not a field it fills.
  citations: z.array(ModelFindingCitationSchema).max(5).optional().catch(undefined)
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

// The discovery packet. It carries no `instructions` field of its own: the
// task's instruction documents ride inside `task.instructions`, resolved per
// task by context assembly. Copying them to the top level as well would put the
// same documents in the packet twice and give a reader two places to ask which
// instructions this task got, which is exactly how the two answers start
// disagreeing.
//
// It carries no shared-context digest either. One was threaded through every
// packet builder and rendered into none of them, and it could not have carried
// anything: the digest rendered only admitted findings, task states, and support
// signal facts, and the run appends all three AFTER the task queue drains. Every
// discovery and refutation packet of every run therefore held the same constant
// "no admitted shared context yet" string, while the refuter's instructions named
// it as a source to consult. Making it genuinely accumulate was the alternative
// and was rejected: it would make one task's packet depend on another task's
// completion order, and no measurement supports a benefit.
export const TaskReviewInputSchema = z.strictObject({
  task: WorkflowReviewTaskSchema,
  reviewedDiffRanges: z.array(ReviewedDiffRangeSchema).default([]),
  evidence: z.array(EvidenceRecordSchema),
  candidates: z.array(CandidateFindingSchema),
  skills: z.array(SkillContextDocumentSchema),
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
  reviewedTasks: z.array(WorkflowReviewTaskSchema).default([]),
  // What discovery produced for this task, before refutation and admission decided
  // what survived (spec 27). Optional rather than defaulted: a task runner that
  // issues no discovery call has nothing to state, and an absent record must not be
  // readable as a recorded zero.
  discovery: TaskDiscoveryTelemetrySchema.optional()
})

// The verdicts a MODEL may return, narrowed from the canonical enum rather than
// restated, so a verdict added upstream reaches this contract instead of silently
// staying behind. `provider-error` is excluded by construction: it is the runtime's
// own record of a refutation call that produced no answer at all, so a response
// claiming it would be a model reporting its own absence.
const ModelRefutationVerdictSchema = RefutationVerdictSchema.exclude([
  'provider-error'
])
const modelRefutationVerdictValues = ModelRefutationVerdictSchema.options

export const FindingRefutationResultSchema = z.strictObject({
  verdict: ModelRefutationVerdictSchema,
  rationaleSummary: z.string().min(1).max(1200),
  fixSummary: z.string().min(1).max(1200).optional(),
  fixEdits: z.array(FixEditSchema).max(5).optional()
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
//
// FIELD ORDER IS A COST CONTRACT, and it is measured. The harness sends this packet
// as `JSON.stringify(parsedInput)` and Zod emits keys in declaration order, so the
// four fields above `reviewContext` are exactly the shared prompt prefix; everything
// from `reviewContext` on is per-task. Moving a per-task field above them, or
// inserting one, truncates that prefix to nothing.
//
// `instructions` is the one qualified member of that head. It is constant for every
// refutation call of a run UNLESS `instructions.files[].scope` is configured (spec
// 04), because scoping resolves the set per task — so a run that scopes an
// instruction to part of the repository shortens its own refutation prefix to
// `provenance` + the leading bytes of `instructions`. The field is left here rather
// than demoted: refutation caches nothing either way (see the 968-against-1024
// measurement below), and keeping the operator's guidance in the head is what makes
// the prefix long enough to matter at all if this prompt ever grows past the
// threshold.
//
// What that prefix measured when it was last recorded off the real pipeline (over
// the 37-slice real-repo corpus, o200k_base, no provider spend): refuter
// instructions 783 tokens + static packet head 185 tokens = 968 identical leading
// tokens. That measurement predates the removal of the always-constant
// `sharedDigest` field, which took roughly a dozen tokens out of both the head and
// the instructions; the conclusion is unchanged, because the prefix was already
// short of the threshold and got shorter. The
// provider caches only a prefix of at least 1024 tokens, in 128-token increments,
// so refutation caches NOTHING and is 56 tokens short — while discovery's 1,621-token
// prefix caches 1,536 per call, which is every cached token a run reports.
//
// Configuring `instructions.files` lengthens THIS packet's head, and only this one.
// This comment used to add that the same configuration raised discovery's measured
// prefix to 1,654 tokens "because the instruction document lands inside the head";
// that was never possible. Discovery's cached prefix is its instruction constant,
// and the instruction documents reached no discovery prompt at all until they were
// rendered into `reviewText` (spec 04). They still do not lengthen discovery's
// cached prefix now that they do reach it: `reviewText` opens with a per-task id,
// so nothing after it is a shared prefix. Whether the added bytes here carry
// refutation over 1024 depends on the documents' own size and is unmeasured.
//
// The gap is deliberately NOT closed here. Padding the prompt to clear 1024 would
// spend real tokens on every call to buy a discount on the same tokens, and any
// content added to this stage's prompt is a measured recall/precision risk. If a
// refutation prompt change is ever justified on its own merits and adds 56+ tokens,
// caching starts working as a side effect — that is the only honest route.
export const FindingRefutationBatchInputSchema = z.strictObject({
  provenance: WorkflowProvenanceInputSchema,
  instructions: z.array(ContextDocumentSchema),
  skills: z.array(SkillContextDocumentSchema),
  reviewContext: z.array(ReviewContextDocumentSchema),
  reviewedDiffRanges: z.array(ReviewedDiffRangeSchema).default([]),
  evidence: z.array(EvidenceRecordSchema),
  supportSignalCandidates: z.array(CandidateFindingSchema),
  candidates: z.array(CandidateFindingSchema).min(1),
  // Present ONLY when the budget ladder in `refutation/packet.ts` withheld
  // something, and last because it is per-batch and must not sit in the shared
  // prefix above.
  //
  // It exists because the ladder empties `supportSignalCandidates` and
  // `reviewContext`, and the refuter's instructions treat review context as
  // evidentiary — so an emptied packet reads as "there is no context and no
  // corroboration" rather than "these were withheld", and a candidate gets refuted
  // on the strength of an absence the engine itself created. A refuted finding
  // produces no output at all, so nothing downstream can show what was suppressed.
  // The notice used to ride on the shared-context digest field, which was the only
  // free text the packet had; that field was always the same constant and is gone,
  // so the notice is declared for what it is.
  budgetNotice: z.string().optional()
})

// Loose by design, like holistic discovery's output: the provider receives an
// opaque array and the SHAPE is specified in the instructions, because sending a
// rich item schema was measured to make structured output fail on larger responses.
// Each entry is normalized by `ModelRefutationBatchVerdictSchema`.
export const ModelFindingRefutationBatchResultSchema = z.strictObject({
  verdicts: z.array(z.unknown()).default([])
})

// One adjudicated candidate inside a batch response: the adjudication fields plus
// the id that binds them back to a candidate. This is the ONLY refutation response
// shape — batched refutation (spec 05) replaced per-candidate refutation, so the
// adjudication fields are declared here rather than extracted for sharing.
//
// The alternative key spellings are tolerance for a non-deterministic producer, not
// artefact back-compat: the response is free-form model JSON and `fix_summary` is a
// spelling a model plausibly emits for `fixSummary`.
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
    fixSummary: record.fixSummary ?? record.fix_summary,
    fixEdits: record.fixEdits ?? record.fix_edits
  }
}, z.object({
  candidateId: z.string().min(1),
  verdict: z.preprocess(
    (value) =>
      normalizeModelEnumValue(value, modelRefutationVerdictValues, {
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
      }),
    ModelRefutationVerdictSchema
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

// The adjudication fields as the model may return them, before they are hardened
// into a `FindingRefutationResult`. Derived from the batch verdict schema minus the
// binding id, so the input type cannot drift from what that schema actually accepts.
type ModelRefutationVerdictFields = Omit<
  z.infer<typeof ModelRefutationBatchVerdictSchema>,
  'candidateId'
>

// Picks only the adjudication fields. The batched verdict a caller holds also
// carries the `candidateId` that binds it to its candidate, and the result schema is
// strict, so copying the input wholesale would throw on that extra key.
export const normalizeFindingRefutationResult = (
  result: ModelRefutationVerdictFields
): FindingRefutationResult =>
  FindingRefutationResultSchema.parse({
    verdict: result.verdict,
    rationaleSummary: result.rationaleSummary,
    ...(result.fixSummary === undefined ? {} : { fixSummary: result.fixSummary }),
    ...(result.fixEdits === undefined ? {} : { fixEdits: result.fixEdits })
  })

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
