import { z } from 'zod'
import { RepositoryRelativePathSchema, SeveritySchema } from '../config/config.schema.js'

export const FindingCategorySchema = z.enum([
  'bug',
  'security',
  'performance',
  'maintainability',
  'compatibility',
  'policy',
  'test'
])

// Twelve values were removed here, each for a stated reason rather than for
// having no producer — an unproduced value can equally mean a capability nobody
// wired, and those get wired, not deleted.
//
//   - `data-flow`, `related-location`, `rule`, `baseline` duplicated first-class
//     fields the finding already carries (`dataFlow`, `relatedLocations`,
//     `ruleId`, `baselineStatus`, all populated by analyzer ingestion). Two
//     representations of one fact is the thing that drifts.
//   - `refutation` was a second name for what `createRefutationEvidence` already
//     mints as `model-rationale`.
//   - `symbol` named a declared-symbol span. Any located evidence record already
//     carries a `location`, and no producer ever needed to tell a symbol span
//     apart from any other one.
//   - `command`, `config`, `policy` describe subsystems this engine does not have
//     and is not gaining — it executes nothing, and policy outcomes are recorded
//     as `RejectedFinding.reason`, not as evidence.
//   - `proof` duplicated the verification domain's own `Verdict`/`Claim` contract.
//   - `diff` claimed a finding rests on a hunk; the diff travels as
//     `reviewedDiffRanges` metadata, and a citation into changed code is a
//     citation into a FILE.
//   - `deterministic-signal` was KEPT once, deliberately, as the sole exception to
//     the rule this file otherwise follows: add a value in the SAME CHANGE that
//     produces it, never before. The signal-facts context section reaches
//     discovery (`review.signalFacts.enabled`), but nothing ever let a finding
//     cite one of those facts, and the measurement that would have added that
//     citation path came back null (reports/2026-08-10-signal-facts-result.md).
//     The exception did not pay off, so it goes now.
//
// `citation` does not repeat that mistake: it lands in the SAME CHANGE as its
// producer, `citationEvidenceFor` (discovery/citation-evidence.ts), which mints it
// only for a discovery-cited source line that a deterministic check re-read and
// confirmed.
export const EvidenceKindSchema = z.enum([
  'file',
  'diagnostic',
  'model-rationale',
  'citation',
  'tool-read',
  'tool-search'
])

export const RejectReasonSchema = z.enum([
  'schema-invalid',
  'location-invalid',
  'not-in-scope',
  'insufficient-evidence',
  'duplicate',
  'below-threshold',
  'unsafe-content',
  'provider-error',
  'refuted',
  'deterministic-contradiction',
  'weak-evidence',
  'static-analysis-duplicate'
])

export const ReporterEligibilitySchema = z.enum(['inline', 'summary-only', 'artifact-only'])
export const BaselineStatusSchema = z.enum(['new', 'existing', 'resolved', 'unknown'])

// Internally generated ids take the form `<prefix>_<hex>` and may carry an
// extra segment for grouped tasks (e.g. `task_intent_<hex>`). The pattern allows
// one or more `_<alnum>` segments so multi-segment ids validate consistently
// across candidate, refutation, admission, and report contracts. Test fixtures keep
// the `test-...` form.
export const ContractIdSchema = z
  .string()
  .regex(/^(?:test-[A-Za-z0-9_-]+|[a-z]+(?:_[a-z0-9]+)+)$/)

// Build a schema for an internally generated id with a fixed `<prefix>_` form.
// Ids are `<prefix>_<seg>(_<seg>)*` of lowercase alphanumeric segments (e.g.
// `task_<hex>`, `task_intent_<hex>`, `cand_<hex>`); the `test-...` fixture form is
// accepted too. Reuse these named primitives instead of inlining per-call regexes
// so id validation cannot drift between the generation, planning, admission, and
// report stages (the source of past `provider_error`-masked schema failures).
export const prefixedIdSchema = (prefix: string): z.ZodString =>
  z
    .string()
    .regex(
      new RegExp(`^(?:test-[A-Za-z0-9_-]+|${prefix}_[a-z0-9]+(?:_[a-z0-9]+)*)$`, 'u')
    )

export const TaskIdSchema = prefixedIdSchema('task')
export const CandidateIdSchema = prefixedIdSchema('cand')
export const ContextLedgerIdSchema = prefixedIdSchema('ctx')

export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

export const CodeLocationSchema = z
  .strictObject({
    path: RepositoryRelativePathSchema,
    startLine: z.int().min(1),
    startColumn: z.int().min(1).optional(),
    endLine: z.int().min(1).optional(),
    endColumn: z.int().min(1).optional(),
    side: z.enum(['new', 'old', 'file'])
  })
  .refine(
    (location) =>
      location.endLine === undefined || location.endLine >= location.startLine,
    {
      path: ['endLine'],
      message: 'endLine must be greater than or equal to startLine.'
    }
  )

export const RelatedLocationSchema = z.strictObject({
  id: z.string().min(1),
  location: CodeLocationSchema,
  message: z.string().min(1).max(300)
})

export const DataFlowPathSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1).max(120),
  steps: z.array(RelatedLocationSchema).min(1)
})

export const FindingFingerprintSchema = z.strictObject({
  algorithm: z.string().min(1),
  value: z.string().regex(/^[a-z0-9]+$/)
})

export const EvidenceRecordSchema = z.strictObject({
  id: ContractIdSchema,
  kind: EvidenceKindSchema,
  summary: z.string().min(1).max(500),
  location: CodeLocationSchema.optional(),
  source: z.string().min(1),
  sourceVersion: z.string().optional(),
  contentHash: Sha256Schema.optional(),
  rawContentRef: z.string().optional(),
  redactionApplied: z.boolean(),
  ruleId: z.string().optional(),
  helpUri: z.url().optional(),
  cwe: z.array(z.string().regex(/^CWE-[0-9]+$/)).optional(),
  // Normalized 0-10 security severity as the PRODUCER of this evidence stated it
  // (spec 15, Mechanism 2). It lives on the evidence record, not only on the
  // admitted finding, because it is a property of the observation rather than of
  // the engine's verdict: an ingested analyzer alert carries a severity its tool
  // assigned, and that number must survive into the report without being mistaken
  // for this engine's own severity decision. Nothing propagates it to
  // `AdmittedFinding.securitySeverity` — that would let a third-party artifact set
  // a finding's severity without passing the model or the admission gate.
  securitySeverity: z.number().min(0).max(10).optional(),
  relatedLocations: z.array(RelatedLocationSchema).optional(),
  dataFlow: z.array(DataFlowPathSchema).optional()
})

export const RefutationVerdictSchema = z.enum([
  'proved',
  'refuted',
  'needs-more-evidence',
  'provider-error'
])

export const VerificationCheckSchema = z.strictObject({
  kind: z.string().min(1).max(120),
  result: z.enum(['passed', 'failed', 'unknown']),
  summary: z.string().min(1).max(500),
  evidenceIds: z.array(ContractIdSchema)
})

// Sized to its ONLY producer. The refuter is asked for a rationale within 1200
// characters (`rationaleSummary` in the discovery contract), so a destination
// below 1200 does not guard against a runaway model — it guarantees a cut on
// ordinary output. This was 1000, and the last 200 characters of a refutation
// argument are where its qualifications live.
export const REFUTATION_SUMMARY_MAX = 1200

export const RefutationResultSchema = z.strictObject({
  id: ContractIdSchema,
  candidateId: CandidateIdSchema,
  verdict: RefutationVerdictSchema,
  summary: z.string().min(1).max(REFUTATION_SUMMARY_MAX),
  evidenceIds: z.array(ContractIdSchema),
  checks: z.array(VerificationCheckSchema)
})

export const FindingProvenanceSchema = z.strictObject({
  reviewer: z.string().min(1),
  modelProvider: z.string().optional(),
  modelName: z.string().optional(),
  promptHash: Sha256Schema.optional(),
  instructionHashes: z.array(Sha256Schema),
  skillHashes: z.array(Sha256Schema),
  signalVersions: z.record(z.string(), z.string()),
  configHash: Sha256Schema
})

export const FixEditSchema = z.strictObject({
  path: RepositoryRelativePathSchema,
  startLine: z.int().min(1),
  endLine: z.int().min(1),
  replacement: z.string().min(1).max(4000),
  description: z.string().min(1).max(500).optional()
})

export const FixProposalSchema = z.strictObject({
  summary: z.string().min(1).max(1200),
  evidenceIds: z.array(ContractIdSchema).min(1),
  safety: z.literal('manual-review'),
  edits: z.array(FixEditSchema).max(5).optional()
})

// Max length of a finding's description. Exported so a destination that MIRRORS
// a finding's description — the eval report's produced-finding summary — sizes
// itself to the source's own bound instead of picking its own smaller number. A
// mirror capped below this does not bound anything the producer can emit; it
// silently truncates ordinary output, which is the drift `REJECTED_FINDING_MESSAGE_MAX`
// exists to prevent one contract over.
export const FINDING_DESCRIPTION_MAX = 1200

export const AdmittedFindingSchema = z.strictObject({
  id: ContractIdSchema,
  taskId: TaskIdSchema,
  category: FindingCategorySchema,
  severity: SeveritySchema,
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(FINDING_DESCRIPTION_MAX),
  location: CodeLocationSchema,
  evidenceIds: z.array(ContractIdSchema).min(1),
  proposedBy: z.string().min(1),
  fixProposal: FixProposalSchema.optional(),
  admissionStatus: z.literal('admitted'),
  admittedAt: z.iso.datetime(),
  admissionEvidenceIds: z.array(ContractIdSchema).min(1),
  reporterEligibility: ReporterEligibilitySchema,
  provenance: FindingProvenanceSchema,
  refutationId: ContractIdSchema.optional(),
  baselineStatus: BaselineStatusSchema,
  fingerprints: z.array(FindingFingerprintSchema).min(1),
  securitySeverity: z.number().min(0).max(10).optional(),
  ruleId: z.string().optional(),
  helpUri: z.url().optional(),
  cwe: z.array(z.string().regex(/^CWE-[0-9]+$/)).optional(),
  relatedLocations: z.array(RelatedLocationSchema).optional(),
  dataFlow: z.array(DataFlowPathSchema).optional()
})

// Max length for a rejection message. Exported so the construction sites that
// copy model-authored summaries into `RejectedFinding.message` truncate to the
// same cap (single source of truth) instead of hard-coding the number.
//
// Sized to its producer for the same reason as `REFUTATION_SUMMARY_MAX`: the
// refutation rationale that lands here is written to 1200 characters, so 500 —
// the previous value — discarded 58% of it. This is the field that says WHY A
// FINDING WAS SUPPRESSED, read by someone asking whether a suppression was
// right, and more than half the answer was being removed before they saw it.
//
// Not a noise risk, measured rather than assumed: over the 37-case corpus the
// median run rejects zero candidates and the worst rejects four, and the section
// that renders them is one a reader opens deliberately.
export const REJECTED_FINDING_MESSAGE_MAX = 1200

export const RejectedFindingSchema = z.strictObject({
  candidateId: CandidateIdSchema,
  status: z.enum(['rejected', 'needs-more-evidence']),
  reason: RejectReasonSchema,
  // Rejection messages are populated from model-authored summaries (aggregate,
  // refutation, and judge rationales) that can exceed this cap. Construction
  // sites must truncate via `truncateForContract` before parsing; the cap is kept
  // as a plain max so the field stays representable in the generated JSON Schema.
  message: z.string().max(REJECTED_FINDING_MESSAGE_MAX),
  evidenceIds: z.array(ContractIdSchema).optional(),
  // The rejected candidate's own severity, when the rejecting call site has the
  // parsed candidate in hand. Optional, not defaulted: a candidate that failed
  // schema validation before it could be parsed has no severity to record, and
  // a construction site that has not been updated to pass it through simply
  // omits it rather than fabricating a value. This exists so eval measurement
  // can tally rejections by severity (spec 06) -- without it, "is the model
  // over-calling severity" is confounded by the admission floor deleting every
  // model-origin `low` candidate before anyone downstream can observe it.
  severity: SeveritySchema.optional()
})

export type FindingCategory = z.infer<typeof FindingCategorySchema>
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>
export type RejectReason = z.infer<typeof RejectReasonSchema>
export type ReporterEligibility = z.infer<typeof ReporterEligibilitySchema>
export type BaselineStatus = z.infer<typeof BaselineStatusSchema>
export type CodeLocation = z.infer<typeof CodeLocationSchema>
export type RelatedLocation = z.infer<typeof RelatedLocationSchema>
export type DataFlowPath = z.infer<typeof DataFlowPathSchema>
export type FindingFingerprint = z.infer<typeof FindingFingerprintSchema>

/**
 * Comparison key for fingerprint equality, across findings, verdicts and claims.
 *
 * Lives beside the type because two domains each had their own copy: admission
 * used it to decide whether a baselined finding still appears, verification to
 * corroborate a claim. Identical today; a change to either — hashing the pair,
 * ordering multi-algorithm fingerprints — would have made the two disagree about
 * which findings are the same, and disagreement there is a wrong match rather
 * than an error anyone would see.
 */
export const fingerprintKey = (fingerprint: FindingFingerprint): string =>
  `${fingerprint.algorithm}:${fingerprint.value}`
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>
export type RefutationVerdict = z.infer<typeof RefutationVerdictSchema>
export type VerificationCheck = z.infer<typeof VerificationCheckSchema>
export type RefutationResult = z.infer<typeof RefutationResultSchema>
export type FindingProvenance = z.infer<typeof FindingProvenanceSchema>
export type FixEdit = z.infer<typeof FixEditSchema>
export type FixProposal = z.infer<typeof FixProposalSchema>
export type AdmittedFinding = z.infer<typeof AdmittedFindingSchema>
export type RejectedFinding = z.infer<typeof RejectedFindingSchema>
