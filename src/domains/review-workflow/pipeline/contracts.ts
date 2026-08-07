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
import {
  ContextRetrievalBudgetSchema,
  ContextRetrievalEligibilityConfigSchema
} from '../../context-retrieval/index.js'
import {
  BaselineFingerprintRecordSchema,
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
  // Spec 27. Absent means unlimited, which is today's behaviour.
  maxFilesPerDiscoveryCall: z.int().min(1).optional(),
  evidence: z.array(EvidenceRecordSchema),
  candidates: z.array(CandidateFindingSchema),
  // No run-wide `instructions` field: reviewer instructions are carried per task
  // on `tasks[].instructions`, because `instructions.files[].scope` (spec 04)
  // makes "which instructions apply" a property of a task's reviewed files
  // rather than of the run. A run-wide list kept alongside the per-task one would
  // be a second answer to the same question, and the packet builders would have
  // to pick — so it is gone rather than deprecated.
  skills: z.array(SkillContextDocumentSchema),
  reviewContext: z.array(ReviewContextDocumentSchema).optional(),
  tasks: z.array(WorkflowReviewTaskSchema).optional(),
  maxConcurrentTasks: z.int().min(1).max(32).optional(),
  maxTaskInputBytes: z.int().min(10000).max(10000000).optional(),
  contextRetrievalBudget: ContextRetrievalBudgetSchema.optional(),
  // The operator's configured `paths.include` / `paths.exclude` (spec 04), for
  // the retriever the workflow builds to back cross-file discovery (spec 16).
  //
  // It has to be carried explicitly. The workflow receives `reviewedPaths` — the
  // files this change touched — and those are the OUTPUT of scoping, not the
  // scope: they say nothing about which unchanged files the discovery tools may
  // look at, which is the whole question the eligibility gate answers. Without
  // this field the gate compiled its permissive defaults (`**/*` plus the
  // built-in excludes), so a path the operator excluded was read in full by the
  // one lane where an untrusted model drives the tools. Absent means no scope was
  // configured, which is not the same as an empty one.
  paths: ContextRetrievalEligibilityConfigSchema.optional(),
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
  // Spec 27. Optional for the same reason it is optional on the report: a workflow
  // that issued no discovery call has nothing to state, and an absent record is not
  // a recorded zero.
  discovery: ReviewReportSchema.shape.discovery,
  qualityGate: ReviewReportSchema.shape.qualityGate.unwrap(),
  instructionHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)),
  skillHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)),
  warnings: z.array(z.string())
})

export type ReviewWorkflowInput = z.infer<typeof ReviewWorkflowInputSchema>
export type ReviewWorkflowInputDraft = z.input<typeof ReviewWorkflowInputSchema>
export type ReviewWorkflowOutput = z.infer<typeof ReviewWorkflowOutputSchema>
