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
  'baseline'
])

export const RejectReasonSchema = z.enum([
  'schema-invalid',
  'location-invalid',
  'not-in-scope',
  'insufficient-evidence',
  'duplicate',
  'below-threshold',
  'unsafe-content',
  'provider-error'
])

export const ReporterEligibilitySchema = z.enum(['inline', 'summary-only', 'artifact-only'])
export const BaselineStatusSchema = z.enum(['new', 'existing', 'resolved', 'unknown'])

export const ContractIdSchema = z
  .string()
  .regex(/^(?:test-[A-Za-z0-9_-]+|[a-z]+_[a-z0-9]+)$/)

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

export const FindingProvenanceSchema = z.strictObject({
  reviewer: z.string().min(1),
  modelProvider: z.string().optional(),
  modelName: z.string().optional(),
  promptHash: Sha256Schema.optional(),
  instructionHashes: z.array(Sha256Schema),
  skillHashes: z.array(Sha256Schema),
  analyzerVersions: z.record(z.string(), z.string()),
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
  taskId: ContractIdSchema,
  category: FindingCategorySchema,
  severity: SeveritySchema,
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(1200),
  location: CodeLocationSchema,
  evidenceIds: z.array(ContractIdSchema).min(1),
  proposedBy: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  suggestedFix: z.string().max(1200).optional(),
  fixProposal: FixProposalSchema.optional(),
  admissionStatus: z.literal('admitted'),
  admittedAt: z.iso.datetime(),
  admissionEvidenceIds: z.array(ContractIdSchema).min(1),
  reporterEligibility: ReporterEligibilitySchema,
  provenance: FindingProvenanceSchema,
  baselineStatus: BaselineStatusSchema,
  fingerprints: z.array(FindingFingerprintSchema).min(1),
  securitySeverity: z.number().min(0).max(10).optional(),
  ruleId: z.string().optional(),
  helpUri: z.url().optional(),
  cwe: z.array(z.string().regex(/^CWE-[0-9]+$/)).optional(),
  relatedLocations: z.array(RelatedLocationSchema).optional(),
  dataFlow: z.array(DataFlowPathSchema).optional()
})

export const RejectedFindingSchema = z.strictObject({
  candidateId: ContractIdSchema,
  status: z.enum(['rejected', 'needs-more-evidence']),
  reason: RejectReasonSchema,
  message: z.string().max(500),
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
export type FindingProvenance = z.infer<typeof FindingProvenanceSchema>
export type FixEdit = z.infer<typeof FixEditSchema>
export type FixProposal = z.infer<typeof FixProposalSchema>
export type AdmittedFinding = z.infer<typeof AdmittedFindingSchema>
export type RejectedFinding = z.infer<typeof RejectedFindingSchema>
