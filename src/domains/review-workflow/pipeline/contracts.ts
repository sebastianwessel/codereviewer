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
