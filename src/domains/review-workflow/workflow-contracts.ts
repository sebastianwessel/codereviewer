import { z } from 'zod'
import {
  EvidenceRecordSchema,
  FindingAggregateResultSchema,
  FindingJudgeResultSchema,
  InvestigationTraceSchema,
  ModelSuspicionSchema,
  ProofPacketSchema,
  PromotionDecisionSchema,
  PromotionPolicyConfigSchema,
  RepositoryRelativePathSchema,
  RefutationResultSchema,
  ReviewIntentSchema,
  ReviewReportSchema
} from '../../shared/contracts/index.js'
import { ContextLedgerEntrySchema } from '../review-planning/index.js'
import { CandidateFindingSchema } from '../admission/index.js'
import { ContextRetrievalBudgetSchema } from '../context-retrieval/index.js'
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
} from './model-agent-contracts.js'

export const ReviewWorkflowInputSchema = z.strictObject({
  runId: z.string().min(1),
  repositoryRoot: z.string().min(1).optional(),
  reviewedPaths: z.array(RepositoryRelativePathSchema),
  reviewedLineRanges: z.array(ReviewedLineRangeSchema).optional(),
  reviewedDiffRanges: z.array(ReviewedDiffRangeSchema).optional(),
  // Raw unified diff text for the reviewed change. Holistic discovery presents
  // it to the model as the authoritative "what changed" signal. Defaults to ''
  // (suspicion mode and provided-candidate runs do not require it).
  reviewedDiffText: z.string().default(''),
  evidence: z.array(EvidenceRecordSchema),
  candidates: z.array(CandidateFindingSchema),
  instructions: z.array(ContextDocumentSchema),
  skills: z.array(SkillContextDocumentSchema),
  reviewContext: z.array(ReviewContextDocumentSchema).optional(),
  tasks: z.array(WorkflowReviewTaskSchema).optional(),
  maxConcurrentTasks: z.int().min(1).max(32).optional(),
  maxTaskInputBytes: z.int().min(10000).max(10000000).optional(),
  maxSuspicionsPerTask: z.int().min(0).max(20).optional(),
  maxInvestigationsPerRun: z.int().min(0).max(200).optional(),
  maxInvestigationRounds: z.int().min(1).max(5).optional(),
  contextRetrievalBudget: ContextRetrievalBudgetSchema.optional(),
  intentPlanning: z.enum(['deterministic', 'model']).default('deterministic'),
  discoveryMode: z.enum(['suspicion', 'holistic']).default('holistic'),
  judgeFindings: z.boolean().default(false),
  promotionPolicy: PromotionPolicyConfigSchema.default({
    modelProof: 'actionable',
    modelWeakOrRefuted: 'artifact-only',
    staticAnalysisDuplicate: 'artifact-only',
    deterministicContradiction: 'rejected'
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
  reviewIntents: z.array(ReviewIntentSchema),
  modelSuspicions: z.array(ModelSuspicionSchema),
  modelTaskDiagnostics: ReviewReportSchema.shape.modelTaskDiagnostics,
  investigationTraces: z.array(InvestigationTraceSchema),
  proofPackets: z.array(ProofPacketSchema),
  refutationResults: z.array(RefutationResultSchema),
  aggregateResults: z.array(FindingAggregateResultSchema),
  judgeResults: z.array(FindingJudgeResultSchema),
  promotionDecisions: z.array(PromotionDecisionSchema),
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
