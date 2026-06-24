import type {
  CodeReviewerConfig,
  EvidenceRecord
} from '../../shared/contracts/index.js'
import { EvidenceRecordSchema } from '../../shared/contracts/index.js'
import { sha256 } from '../../shared/hash/hash.js'
import type {
  BaselineFingerprintRecord,
  CandidateFinding,
  QualityGateThresholds,
  ReviewedDiffRange,
  ReviewedLineRange
} from '../admission/index.js'
import { deterministicSignalExtractorVersions } from '../deterministic-signals/index.js'
import type {
  InstructionContextDocument,
  SkillContextDocument,
  WorkflowReviewTask
} from './review-runner-context.js'
import { taskInputBudgetFor, type AiReviewRuntimeBudget } from './review-runner-budgets.js'
import type { ReviewWorkflowInput } from './workflow-contracts.js'

// Build deterministic quality-gate thresholds from configuration. `failOnNewOnly`
// falls back to the baseline setting per spec 06; `maxMedium` stays omitted
// ("no fail") unless configured.
export const qualityGateThresholdsFor = (
  config: CodeReviewerConfig
): QualityGateThresholds => ({
  maxCritical: config.qualityGate.maxCritical,
  maxHigh: config.qualityGate.maxHigh,
  ...(config.qualityGate.maxMedium === undefined
    ? {}
    : { maxMedium: config.qualityGate.maxMedium }),
  failOnProviderError: config.qualityGate.failOnProviderError,
  failOnNewOnly:
    config.qualityGate.failOnNewOnly ?? config.baseline.failOnNewOnly
})

export const contextEvidenceForTasks = (
  tasks: readonly WorkflowReviewTask[]
): readonly EvidenceRecord[] => {
  const evidenceById = new Map<string, EvidenceRecord>()

  for (const task of tasks) {
    for (const context of task.reviewContext) {
      if (context.kind !== 'file' || context.path === undefined) {
        continue
      }

      const contentHash = sha256(context.content)
      const id = `evctx_${sha256(
        `${context.ledgerEntryId}:${context.path}:${contentHash}`
      ).slice(0, 24)}`

      evidenceById.set(
        id,
        EvidenceRecordSchema.parse({
          id,
          kind: 'file',
          summary: `Reviewed source context for ${context.path}.`,
          location: {
            path: context.path,
            startLine: 1,
            side: 'file'
          },
          source: 'review-context',
          contentHash,
          rawContentRef: context.ledgerEntryId,
          redactionApplied: true
        })
      )
    }
  }

  return [...evidenceById.values()]
}

export const effectiveIntentPlanningMode = (
  config: CodeReviewerConfig,
  tasks: readonly WorkflowReviewTask[]
): ReviewWorkflowInput['intentPlanning'] => {
  if (tasks.length <= 1 || config.aiReview.intentPlanning === 'deterministic') {
    return 'deterministic'
  }

  if (config.aiReview.intentPlanning === 'model') {
    return 'model'
  }

  return config.review.mode === 'local' ? 'deterministic' : 'model'
}

export const createWorkflowInput = (
  input: {
    readonly runId: string
    readonly repositoryRoot: string
    readonly reviewedPaths: readonly string[]
    readonly reviewedLineRanges: readonly ReviewedLineRange[]
    readonly reviewedDiffRanges: readonly ReviewedDiffRange[]
    readonly evidence: readonly EvidenceRecord[]
    readonly candidates: readonly CandidateFinding[]
    readonly config: CodeReviewerConfig
    readonly configHash: string
    readonly providerId: string
    readonly modelName: string
    readonly admittedAt: string
    readonly baselineConfigured: boolean
    readonly baselineFingerprints?: readonly BaselineFingerprintRecord[]
    readonly instructions: readonly InstructionContextDocument[]
    readonly skills: readonly SkillContextDocument[]
    readonly tasks: readonly WorkflowReviewTask[]
    readonly aiReviewBudget: AiReviewRuntimeBudget
  }
): ReviewWorkflowInput => ({
  runId: input.runId,
  repositoryRoot: input.repositoryRoot,
  reviewedPaths: [...input.reviewedPaths],
  reviewedLineRanges: input.reviewedLineRanges.map((range) => ({ ...range })),
  reviewedDiffRanges: input.reviewedDiffRanges.map((range) => ({ ...range })),
  evidence: [
    ...input.evidence.map((record) => ({ ...record })),
    ...contextEvidenceForTasks(input.tasks)
  ],
  candidates: input.candidates.map((candidate) => ({ ...candidate })),
  instructions: input.instructions.map((instruction) => ({ ...instruction })),
  skills: input.skills.map((skill) => ({ ...skill })),
  reviewContext: input.tasks.flatMap((task) =>
    task.reviewContext.map((context) => ({ ...context }))
  ),
  tasks: input.tasks.map((task) => ({
    ...task,
    reviewContext: task.reviewContext.map((context) => ({ ...context }))
  })),
  maxConcurrentTasks: input.config.review.maxConcurrentTasks,
  ...(taskInputBudgetFor(input.config) === undefined
    ? {}
    : { maxTaskInputBytes: taskInputBudgetFor(input.config) }),
  maxSuspicionsPerTask: input.aiReviewBudget.maxSuspicionsPerTask,
  maxInvestigationsPerRun: input.aiReviewBudget.maxInvestigationsPerRun,
  maxInvestigationRounds: input.aiReviewBudget.maxInvestigationRounds,
  contextRetrievalBudget: input.aiReviewBudget.contextRetrievalBudget,
  intentPlanning: effectiveIntentPlanningMode(input.config, input.tasks),
  discoveryMode: input.config.aiReview.discoveryMode,
  judgeFindings: input.config.aiReview.judgeFindings,
  promotionPolicy: input.config.promotionPolicy,
  provenance: {
    reviewer: 'review-agent',
    modelProvider: input.providerId,
    modelName: input.modelName,
    signalVersions: deterministicSignalExtractorVersions,
    configHash: input.configHash
  },
  admissionPolicy: {
    inlineSeverityThreshold: input.config.review.inlineSeverityThreshold,
    actionableSeverityThreshold: input.config.aiReview.actionableSeverityThreshold,
    admittedAt: input.admittedAt
  },
  ...(input.baselineFingerprints === undefined
    ? {}
    : {
        baselineFingerprints: input.baselineFingerprints.map((entry) => ({
          fingerprints: entry.fingerprints.map((fingerprint) => ({
            ...fingerprint
          }))
        }))
      }),
  baselineConfigured: input.baselineConfigured,
  qualityGate: qualityGateThresholdsFor(input.config)
})
