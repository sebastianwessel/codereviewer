import { z } from 'zod'
import {
  EvidenceRecordSchema,
  PromotionPolicyConfigSchema,
  RepositoryRelativePathSchema,
  RefutationResultSchema,
  ReviewReportSchema
} from '../../../shared/contracts/index.js'
import { ContextLedgerEntrySchema } from '../../review-planning/index.js'
import { CandidateFindingSchema } from '../../admission/index.js'
import { ContextRetrievalBudgetSchema } from '../../context-retrieval/index.js'
import {
  BaselineFingerprintRecordSchema,
  ContextDocumentSchema,
  QualityGateThresholdsSchema,
  ReviewContextDocumentSchema,
  ReviewedDiffRangeSchema,
  ReviewedLineRangeSchema,
  SkillContextDocumentSchema,
  WorkflowAdmissionDecisionSchema,
  WorkflowAdmissionPolicySchema,
  WorkflowProvenanceInputSchema,
  WorkflowReviewTaskSchema,
  WorkflowTaskEventSchema
} from './agent-contracts.js'

export const ReviewWorkflowInputSchema = z.strictObject({
  runId: z.string().min(1),
  repositoryRoot: z.string().min(1).optional(),
  reviewedPaths: z.array(RepositoryRelativePathSchema),
  reviewedLineRanges: z.array(ReviewedLineRangeSchema).optional(),
  reviewedDiffRanges: z.array(ReviewedDiffRangeSchema).optional(),
  // Raw unified diff text for the reviewed change. Holistic discovery presents
  // it to the model as the authoritative "what changed" signal. Defaults to ''
  // when no diff text is supplied.
  reviewedDiffText: z.string().default(''),
  // Dedicated additive security pass (spec 15, Mechanism 1). When true, each
  // review task issues a SECOND, security-only discovery call whose candidates are
  // additive (they merge with the general pass and never displace it). Off by
  // default: the disabled path runs a single discovery call per task, byte-for-byte
  // unchanged. The extra candidates flow through the same refutation + admission.
  securityPassEnabled: z.boolean().default(false),
  // Context scout (spec 18). When set, a cheap scout call per task names the
  // out-of-change symbols this change depends on and their bodies are injected as
  // referenced-definition context. Absent, no scout call is issued and the
  // discovery packet is byte-for-byte what it is today.
  contextScout: z
    .strictObject({
      maxSymbols: z.int().min(1),
      maxBytesPerSymbol: z.int().min(1)
    })
    .optional(),
  // Un-anchored discovery pass (spec 19). Present ONLY when the pass is enabled,
  // exactly like `contextScout` above: absent means no extra call is issued and
  // the discovery packet is byte-for-byte what it is today. When present, each
  // task additionally reviews its changed files as bounded units WITH THE DIFF
  // WITHHELD, and the bounds travel with the toggle because a pass that cannot be
  // bounded must not run.
  unanchoredPass: z
    .strictObject({
      unitLines: z.int().min(1),
      strideLines: z.int().min(1),
      maxUnitsPerFile: z.int().min(1),
      maxUnitsPerRun: z.int().min(1)
    })
    .optional(),
  evidence: z.array(EvidenceRecordSchema),
  candidates: z.array(CandidateFindingSchema),
  instructions: z.array(ContextDocumentSchema),
  skills: z.array(SkillContextDocumentSchema),
  reviewContext: z.array(ReviewContextDocumentSchema).optional(),
  tasks: z.array(WorkflowReviewTaskSchema).optional(),
  maxConcurrentTasks: z.int().min(1).max(32).optional(),
  maxTaskInputBytes: z.int().min(10000).max(10000000).optional(),
  contextRetrievalBudget: ContextRetrievalBudgetSchema.optional(),
  promotionPolicy: PromotionPolicyConfigSchema.default({
    modelWeakOrRefuted: 'artifact-only'
  }),
  provenance: WorkflowProvenanceInputSchema,
  baselineFingerprints: z.array(BaselineFingerprintRecordSchema).optional(),
  baselineConfigured: z.boolean().default(false),
  admissionPolicy: WorkflowAdmissionPolicySchema.default({
    inlineSeverityThreshold: 'high',
    actionableSeverityThreshold: 'medium',
    admittedAt: new Date(0).toISOString()
  }),
  qualityGate: QualityGateThresholdsSchema.default({})
})

export const ReviewWorkflowOutputSchema = z.strictObject({
  admittedFindings: z.array(ReviewReportSchema.shape.admittedFindings.element),
  rejectedFindings: z.array(ReviewReportSchema.shape.rejectedFindings.element),
  evidence: z.array(EvidenceRecordSchema),
  candidateFindings: z.array(CandidateFindingSchema),
  contextLedgerEntries: z.array(ContextLedgerEntrySchema),
  refutationResults: z.array(RefutationResultSchema),
  providerIssues: ReviewReportSchema.shape.providerIssues,
  admissionDecisions: z.array(WorkflowAdmissionDecisionSchema),
  taskEvents: z.array(WorkflowTaskEventSchema),
  qualityGate: ReviewReportSchema.shape.qualityGate.unwrap(),
  instructionHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)),
  skillHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)),
  warnings: z.array(z.string())
})

export type ReviewWorkflowInput = z.infer<typeof ReviewWorkflowInputSchema>
export type ReviewWorkflowInputDraft = z.input<typeof ReviewWorkflowInputSchema>
export type ReviewWorkflowOutput = z.infer<typeof ReviewWorkflowOutputSchema>
