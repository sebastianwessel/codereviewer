import type {
  CodeReviewerConfig,
  EvidenceRecord
} from '../../../shared/contracts/index.js'
import { EvidenceRecordSchema } from '../../../shared/contracts/index.js'
import { sha256 } from '../../../shared/hash/hash.js'
import type {
  BaselineFingerprintRecord,
  CandidateFinding,
  QualityGateThresholds,
  ReviewedDiffRange,
  ReviewedLineRange
} from '../../admission/index.js'
import { deterministicSignalExtractorVersions } from '../../deterministic-signals/index.js'
import type {
  SkillContextDocument,
  WorkflowReviewTask
} from './context/context.js'
import { taskInputBudgetFor, type AiReviewRuntimeBudget } from './support/budgets.js'
import type { ReviewWorkflowInput } from '../pipeline/contracts.js'

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
            // The chunk's own origin, not the file's. A large file is split into
            // several context documents, and pinning every one of them to line 1
            // pointed the evidence for a second-chunk finding at the top of the
            // file -- the same class of mislocation the chunk numbering itself
            // used to have.
            path: context.path,
            startLine: context.startLine ?? 1,
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

export const createWorkflowInput = (
  input: {
    readonly runId: string
    readonly repositoryRoot: string
    readonly reviewedPaths: readonly string[]
    readonly reviewedLineRanges: readonly ReviewedLineRange[]
    readonly reviewedDiffRanges: readonly ReviewedDiffRange[]
    readonly reviewedDiffText: string
    readonly evidence: readonly EvidenceRecord[]
    readonly candidates: readonly CandidateFinding[]
    readonly config: CodeReviewerConfig
    readonly configHash: string
    readonly providerId: string
    readonly modelName: string
    readonly admittedAt: string
    readonly baselineConfigured: boolean
    readonly baselineFingerprints?: readonly BaselineFingerprintRecord[]
    // Reviewer instructions are not passed here: context assembly resolves each
    // task's own set against `instructions.files[].scope` and attaches it to the
    // task, so `tasks` already carries them.
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
  reviewedDiffText: input.reviewedDiffText,
  securityPassEnabled: input.config.security.dedicatedPass.enabled,
  signalFactsEnabled: input.config.review.signalFacts.enabled,
  citationsEnabled: input.config.review.citations.enabled,
  ...(input.config.aiReview.maxFilesPerDiscoveryCall === undefined
    ? {}
    : {
        maxFilesPerDiscoveryCall:
          input.config.aiReview.maxFilesPerDiscoveryCall
      }),
  evidence: [
    ...input.evidence.map((record) => ({ ...record })),
    ...contextEvidenceForTasks(input.tasks)
  ],
  candidates: input.candidates.map((candidate) => ({ ...candidate })),
  skills: input.skills.map((skill) => ({ ...skill })),
  reviewContext: input.tasks.flatMap((task) =>
    task.reviewContext.map((context) => ({ ...context }))
  ),
  tasks: input.tasks.map((task) => ({
    ...task,
    reviewContext: task.reviewContext.map((context) => ({ ...context })),
    instructions: task.instructions.map((instruction) => ({ ...instruction }))
  })),
  maxConcurrentTasks: input.config.review.maxConcurrentTasks,
  ...(taskInputBudgetFor(input.config) === undefined
    ? {}
    : { maxTaskInputBytes: taskInputBudgetFor(input.config) }),
  // The workflow retriever backs the cross-file discovery tools (spec 16). When
  // that mode is on, its per-read cap is tightened to the cross-file value so one
  // large file cannot flood a discovery prompt.
  // Spec 28: an EXPLICIT cross-file cap still binds, because that is a deliberate
  // operator choice. Unset, nothing tightens the read: the reviewer narrows by line
  // range, and a real overflow is discovered from the provider rather than guessed.
  contextRetrievalBudget:
    input.config.review.crossFileRetrieval.enabled &&
    input.config.review.crossFileRetrieval.maxBytesPerRead !== undefined
      ? {
          ...input.aiReviewBudget.contextRetrievalBudget,
          maxBytesPerRead:
            input.config.review.crossFileRetrieval.maxBytesPerRead
        }
      : input.aiReviewBudget.contextRetrievalBudget,
  // The scope that retriever's eligibility gate binds to (spec 04). Carried
  // rather than left to the gate's defaults, which are `**/*` plus the built-in
  // excludes and therefore ignore whatever the operator configured — the same
  // scope the verification, impact and intent lanes each pass to their own
  // retriever.
  paths: {
    include: [...input.config.paths.include],
    exclude: [...input.config.paths.exclude]
  },
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
