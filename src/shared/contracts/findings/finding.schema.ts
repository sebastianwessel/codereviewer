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

export const EvidenceKindSchema = z.enum([
  'diff',
  'file',
  'symbol',
  'diagnostic',
  'command',
  'model-rationale',
  'config',
  'policy',
  'data-flow',
  'related-location',
  'rule',
  'baseline',
  'deterministic-signal',
  'tool-read',
  'tool-search',
  'proof',
  'refutation'
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
  'weak-suspicion',
  'static-analysis-duplicate'
])

export const ReporterEligibilitySchema = z.enum(['inline', 'summary-only', 'artifact-only'])
export const BaselineStatusSchema = z.enum(['new', 'existing', 'resolved', 'unknown'])

// Internally generated ids take the form `<prefix>_<hex>` and may carry an
// extra segment for grouped tasks (e.g. `task_intent_<hex>`). The pattern allows
// one or more `_<alnum>` segments so multi-segment ids validate consistently
// across candidate, proof, admission, and report contracts. Test fixtures keep
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
  relatedLocations: z.array(RelatedLocationSchema).optional(),
  dataFlow: z.array(DataFlowPathSchema).optional()
})

export const DeterministicSignalSchema = z.strictObject({
  id: ContractIdSchema,
  kind: z.enum([
    'line-anchor',
    'symbol-span',
    'import-edge',
    'test-hint',
    'config-hint',
    'scope-check',
    'duplicate-key',
    'contradiction',
    'external-tool-summary'
  ]),
  path: RepositoryRelativePathSchema.optional(),
  location: CodeLocationSchema.optional(),
  summary: z.string().min(1).max(500),
  evidenceIds: z.array(ContractIdSchema)
})

export const ContextRequestSchema = z
  .strictObject({
    tool: z.enum(['read', 'list', 'grep']),
    path: RepositoryRelativePathSchema.optional(),
    query: z.string().min(1).max(120).optional(),
    reason: z.string().min(1).max(300)
  })
  .superRefine((value, context) => {
    if ((value.tool === 'read' || value.tool === 'list') && value.path === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'path is required for read and list context requests'
      })
    }

    if (value.tool === 'grep' && value.query === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['query'],
        message: 'query is required for grep context requests'
      })
    }
  })

export const ProofPacketSchema = z.strictObject({
  id: ContractIdSchema,
  suspicionId: ContractIdSchema,
  candidateId: CandidateIdSchema,
  changedBehavior: z.string().min(1).max(1200),
  executionOrDataPath: z.string().min(1).max(1200),
  violatedInvariant: z.string().min(1).max(1200),
  impact: z.string().min(1).max(1200),
  introducedByChange: z.string().min(1).max(1200),
  evidenceIds: z.array(ContractIdSchema).min(1),
  contradictionChecks: z.array(z.string().min(1).max(500)),
  fixDirection: z.string().min(1).max(1200)
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

export const RefutationResultSchema = z.strictObject({
  id: ContractIdSchema,
  proofPacketId: ContractIdSchema,
  verdict: RefutationVerdictSchema,
  summary: z.string().min(1).max(1000),
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

export const AdmittedFindingSchema = z.strictObject({
  id: ContractIdSchema,
  taskId: TaskIdSchema,
  category: FindingCategorySchema,
  severity: SeveritySchema,
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(1200),
  location: CodeLocationSchema,
  evidenceIds: z.array(ContractIdSchema).min(1),
  proposedBy: z.string().min(1),
  suggestedFix: z.string().max(1200).optional(),
  fixProposal: FixProposalSchema.optional(),
  admissionStatus: z.literal('admitted'),
  admittedAt: z.iso.datetime(),
  admissionEvidenceIds: z.array(ContractIdSchema).min(1),
  reporterEligibility: ReporterEligibilitySchema,
  provenance: FindingProvenanceSchema,
  proofPacketId: ContractIdSchema.optional(),
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
export const REJECTED_FINDING_MESSAGE_MAX = 500

export const RejectedFindingSchema = z.strictObject({
  candidateId: CandidateIdSchema,
  status: z.enum(['rejected', 'needs-more-evidence']),
  reason: RejectReasonSchema,
  // Rejection messages are populated from model-authored summaries (aggregate,
  // refutation, and judge rationales) that can exceed this cap. Construction
  // sites must truncate via `truncateForContract` before parsing; the cap is kept
  // as a plain max so the field stays representable in the generated JSON Schema.
  message: z.string().max(REJECTED_FINDING_MESSAGE_MAX),
  evidenceIds: z.array(ContractIdSchema).optional()
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
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>
export type DeterministicSignal = z.infer<typeof DeterministicSignalSchema>
export type ProofPacket = z.infer<typeof ProofPacketSchema>
export type RefutationVerdict = z.infer<typeof RefutationVerdictSchema>
export type VerificationCheck = z.infer<typeof VerificationCheckSchema>
export type ContextRequest = z.infer<typeof ContextRequestSchema>
export type RefutationResult = z.infer<typeof RefutationResultSchema>
export type FindingProvenance = z.infer<typeof FindingProvenanceSchema>
export type FixEdit = z.infer<typeof FixEditSchema>
export type FixProposal = z.infer<typeof FixProposalSchema>
export type AdmittedFinding = z.infer<typeof AdmittedFindingSchema>
export type RejectedFinding = z.infer<typeof RejectedFindingSchema>
