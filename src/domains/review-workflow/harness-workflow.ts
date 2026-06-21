import {
  type BuiltinToolName,
  defineHarness,
  type Logger,
  type ModelAlias,
  type SkillsConfig
} from '@purista/harness'
import { z } from 'zod'
import {
  EvidenceRecordSchema,
  FindingProvenanceSchema,
  RejectedFindingSchema,
  RepositoryRelativePathSchema,
  ReviewReportSchema,
  type AdmittedFinding,
  type EvidenceRecord,
  type QualityGateResult,
  type RejectedFinding
} from '../../shared/contracts/index.js'
import {
  createReviewTaskQueue,
  type ReviewTaskQueueRecord,
  ReviewTaskSchema as PlannedReviewTaskSchema
} from '../review-planning/index.js'
import {
  createStructuredError,
  normalizeError,
  type StructuredError
} from '../../shared/errors/error-normalizer.js'
import { assertAnalyzerEvidenceOwnsPath } from '../language-analyzers/index.js'
import {
  admitCandidate,
  CandidateFindingSchema,
  evaluateQualityGate,
  matchBaselineFindings,
  reviewedLineRangeForContent,
  type BaselineFingerprintRecord,
  type CandidateFinding,
  type QualityGateThresholds,
  type ReviewedDiffRange,
  type ReviewedLineRange
} from '../admission/index.js'
import {
  createReviewSharedContext,
  type AdmissionDecisionRecord,
  type ReviewSharedContext,
  type SharedContextEntry
} from '../shared-context/index.js'
import { createNoopReviewLogger } from '../observability/index.js'
import { sha256 } from '../../shared/hash/hash.js'

const ContextDocumentSchema = z.strictObject({
  path: RepositoryRelativePathSchema,
  content: z.string(),
  allowed: z.boolean(),
  ledgerEntryId: z.string().regex(/^ctx_[a-f0-9]+$/).optional()
})

const SkillContextDocumentSchema = z.strictObject({
  name: z.string().min(1),
  path: RepositoryRelativePathSchema,
  directory: RepositoryRelativePathSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  allowed: z.boolean()
})

const ReviewContextDocumentSchema = z.strictObject({
  kind: z.enum(['file', 'analyzer-output', 'test-mapping']),
  path: RepositoryRelativePathSchema.optional(),
  content: z.string(),
  ledgerEntryId: z.string().regex(/^ctx_[a-f0-9]+$/)
})

const WorkflowReviewTaskSchema = PlannedReviewTaskSchema.extend({
  reviewContext: z.array(ReviewContextDocumentSchema).default([])
})

const WorkflowTaskEventSchema = z.strictObject({
  id: PlannedReviewTaskSchema.shape.id,
  kind: PlannedReviewTaskSchema.shape.kind,
  round: PlannedReviewTaskSchema.shape.round,
  paths: PlannedReviewTaskSchema.shape.paths,
  state: z.enum(['planned', 'running', 'completed', 'failed']),
  workerId: z.string().min(1).optional(),
  message: z.string().min(1).optional()
})

const WorkflowAdmissionDecisionSchema = z.strictObject({
  candidateId: z.string().min(1),
  status: z.enum(['admitted', 'rejected', 'needs-more-evidence']),
  findingId: z.string().min(1).optional(),
  rejectedReason: RejectedFindingSchema.shape.reason.optional(),
  supersedes: z.string().min(1).optional()
})

const QualityGateThresholdsSchema = z.strictObject({
  maxCritical: z.int().min(0).optional(),
  maxHigh: z.int().min(0).optional(),
  maxMedium: z.int().min(0).optional(),
  minEvidenceLevel: z.enum(['non-model', 'model-ok']).optional(),
  failOnProviderError: z.boolean().optional(),
  failOnNewOnly: z.boolean().optional()
})

const WorkflowAdmissionPolicySchema = z.strictObject({
  inlineSeverityThreshold: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  admittedAt: z.string().datetime()
})

const ReviewedLineRangeSchema = z.strictObject({
  path: RepositoryRelativePathSchema,
  startLine: z.int().min(1),
  endLine: z.int().min(0)
})

const ReviewedDiffRangeSchema = z.strictObject({
  path: RepositoryRelativePathSchema,
  startLine: z.int().min(1),
  endLine: z.int().min(0)
})

const WorkflowProvenanceInputSchema = FindingProvenanceSchema.omit({
  instructionHashes: true,
  skillHashes: true
})

const BaselineFingerprintRecordSchema = z.strictObject({
  fingerprints: z.array(
    z.strictObject({
      algorithm: z.string().min(1),
      value: z.string().regex(/^[a-z0-9]+$/)
    })
  )
})

export const ScriptedReviewWorkflowInputSchema = z.strictObject({
  runId: z.string().min(1),
  reviewedPaths: z.array(RepositoryRelativePathSchema),
  reviewedLineRanges: z.array(ReviewedLineRangeSchema).optional(),
  reviewedDiffRanges: z.array(ReviewedDiffRangeSchema).optional(),
  evidence: z.array(EvidenceRecordSchema),
  candidates: z.array(CandidateFindingSchema),
  instructions: z.array(ContextDocumentSchema),
  skills: z.array(SkillContextDocumentSchema),
  reviewContext: z.array(ReviewContextDocumentSchema).optional(),
  tasks: z.array(WorkflowReviewTaskSchema).optional(),
  maxConcurrentTasks: z.int().min(1).max(32).optional(),
  maxTaskInputBytes: z.int().min(10000).max(10000000).optional(),
  provenance: WorkflowProvenanceInputSchema,
  baselineFingerprints: z.array(BaselineFingerprintRecordSchema).optional(),
  baselineConfigured: z.boolean().default(false),
  admissionPolicy: WorkflowAdmissionPolicySchema.default({
    inlineSeverityThreshold: 'high',
    admittedAt: new Date(0).toISOString()
  }),
  qualityGate: QualityGateThresholdsSchema
})

export const ScriptedReviewWorkflowOutputSchema = z.strictObject({
  admittedFindings: z.array(ReviewReportSchema.shape.admittedFindings.element),
  rejectedFindings: z.array(ReviewReportSchema.shape.rejectedFindings.element),
  evidence: z.array(EvidenceRecordSchema),
  candidateFindings: z.array(CandidateFindingSchema),
  admissionDecisions: z.array(WorkflowAdmissionDecisionSchema),
  taskEvents: z.array(WorkflowTaskEventSchema),
  qualityGate: ReviewReportSchema.shape.qualityGate.unwrap(),
  instructionHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)),
  skillHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)),
  warnings: z.array(z.string())
})

const ProposedCandidatesSchema = z.strictObject({
  candidates: z.array(CandidateFindingSchema)
})

const ModelCandidateSuggestionSchema = z.object({
  category: CandidateFindingSchema.shape.category.optional(),
  severity: CandidateFindingSchema.shape.severity.optional(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().min(1).max(3000).optional(),
  path: RepositoryRelativePathSchema.optional(),
  startLine: z.int().min(1).optional(),
  evidenceIds: z.array(z.string()).optional(),
  fixSummary: z.string().min(1).max(1200).optional(),
  fixEdits: z
    .array(
      z.strictObject({
        path: RepositoryRelativePathSchema,
        startLine: z.int().min(1),
        endLine: z.int().min(1),
        replacement: z.string().min(1).max(4000),
        description: z.string().min(1).max(500).optional()
      })
    )
    .max(5)
    .optional()
})

const ModelTaskSuggestionsSchema = z.strictObject({
  candidates: z.array(ModelCandidateSuggestionSchema).default([])
})

const TaskReviewInputSchema = z.strictObject({
  runId: z.string().min(1),
  task: WorkflowReviewTaskSchema,
  evidence: z.array(EvidenceRecordSchema),
  candidates: z.array(CandidateFindingSchema),
  instructions: z.array(ContextDocumentSchema),
  skills: z.array(SkillContextDocumentSchema),
  sharedDigest: z.string(),
  provenance: WorkflowProvenanceInputSchema
})

const TaskReviewResultSchema = z.strictObject({
  candidates: z.array(CandidateFindingSchema)
})

export type ScriptedReviewWorkflowInput = z.infer<
  typeof ScriptedReviewWorkflowInputSchema
>
export type ScriptedReviewWorkflowInputDraft = z.input<
  typeof ScriptedReviewWorkflowInputSchema
>

export type ScriptedReviewWorkflowOutput = z.infer<
  typeof ScriptedReviewWorkflowOutputSchema
>

type TaskReviewPacket = {
  readonly input: z.infer<typeof TaskReviewInputSchema>
}
type TaskReviewResult = z.infer<typeof TaskReviewResultSchema>

export class ReviewTaskExecutionError<R = unknown> extends Error {
  readonly taskEvents: readonly z.infer<typeof WorkflowTaskEventSchema>[]
  readonly partialResults: readonly R[]
  readonly originalError: unknown

  constructor(input: {
    readonly taskEvents: readonly z.infer<typeof WorkflowTaskEventSchema>[]
    readonly partialResults: readonly R[]
    readonly originalError: unknown
  }) {
    super('One or more review tasks failed.')
    this.name = 'ReviewTaskExecutionError'
    this.taskEvents = input.taskEvents
    this.partialResults = input.partialResults
    this.originalError = input.originalError
  }
}

export const isReviewTaskExecutionError = (
  error: unknown
): error is ReviewTaskExecutionError =>
  error instanceof ReviewTaskExecutionError

export type CreateReviewHarnessOptions = {
  readonly modelAlias: ModelAlias
  readonly skills?: SkillsConfig
  readonly skillIds?: readonly string[]
  readonly skillTools?: readonly BuiltinToolName[]
  readonly logger?: Logger
  readonly maxConcurrentTasks?: number
  readonly runTimeoutMs?: number
  readonly failBeforeAdmission?: 'provider-timeout' | 'cancelled'
  readonly onTaskEvent?: (
    event: z.infer<typeof WorkflowTaskEventSchema>
  ) => void
}

const effectiveMaxConcurrentTasks = (
  maxConcurrentTasks: number | undefined
): number => maxConcurrentTasks ?? 4

const harnessRunTimeoutMs = (runTimeoutMs: number | undefined): number =>
  runTimeoutMs ?? 0

const boundedWorkflowConcurrency = (
  workflowMaxConcurrentTasks: number | undefined,
  harnessMaxConcurrentTasks: number
): number =>
  Math.min(
    workflowMaxConcurrentTasks ?? harnessMaxConcurrentTasks,
    harnessMaxConcurrentTasks
  )

const hashAllowedInstructionContent = (
  instructions: readonly z.infer<typeof ContextDocumentSchema>[]
): readonly string[] =>
  instructions.map((instruction) => {
    if (!instruction.allowed) {
      throw createStructuredError({
        code: 'instruction_read_denied',
        message: `Instruction file "${instruction.path}" is not allowed for this review run.`,
        category: 'config',
        recoverable: true,
        exitCode: 2,
        details: {
          path: instruction.path
        }
      })
    }

    return sha256(instruction.content)
  })

const hashAllowedSkillContent = (
  skills: readonly z.infer<typeof SkillContextDocumentSchema>[]
): readonly string[] =>
  skills.map((skill) => {
    if (!skill.allowed) {
      throw createStructuredError({
        code: 'skill_read_denied',
        message: `Skill "${skill.name}" is not allowed for this review run.`,
        category: 'config',
        recoverable: true,
        exitCode: 2,
        details: {
          name: skill.name,
          path: skill.path
        }
      })
    }

    return skill.contentHash
  })

const failIfRequested = (
  failBeforeAdmission: CreateReviewHarnessOptions['failBeforeAdmission']
): void => {
  if (failBeforeAdmission === 'provider-timeout') {
    throw createStructuredError({
      code: 'provider_timeout',
      message: 'Provider operation timed out before admission.',
      category: 'provider',
      recoverable: true,
      exitCode: 4,
      details: {
        operation: 'scripted_review_agent'
      }
    })
  }

  if (failBeforeAdmission === 'cancelled') {
    throw createStructuredError({
      code: 'provider_cancelled',
      message: 'Provider operation was cancelled before admission.',
      category: 'provider',
      recoverable: true,
      exitCode: 4,
      details: {
        operation: 'scripted_review_agent'
      }
    })
  }
}

const runAdmission = (
  input: {
    readonly workflowInput: ScriptedReviewWorkflowInput
    readonly candidates: readonly CandidateFinding[]
    readonly instructionHashes: readonly string[]
    readonly skillHashes: readonly string[]
  }
): {
  readonly admittedFindings: readonly AdmittedFinding[]
  readonly rejectedFindings: readonly RejectedFinding[]
  readonly admissionDecisions: readonly AdmissionDecisionRecord[]
} => {
  const context = createReviewSharedContext()
  const admittedFindings: AdmittedFinding[] = []
  const rejectedFindings: RejectedFinding[] = []
  const admissionDecisions: AdmissionDecisionRecord[] = []
  const reviewedLineRanges =
    input.workflowInput.reviewedLineRanges ??
    reviewedLineRangesFromReviewContext(input.workflowInput.reviewContext ?? [])
  const reviewedDiffRanges: readonly ReviewedDiffRange[] | undefined =
    input.workflowInput.reviewedDiffRanges

  for (const evidence of input.workflowInput.evidence) {
    assertAnalyzerEvidenceOwnsPath(evidence)
    context.appendEvidenceRecord(evidence)
  }

  for (const candidate of input.candidates) {
    context.appendCandidateFinding(candidate)
    const result = admitCandidate({
      candidate,
      evidence: input.workflowInput.evidence,
      existingAdmittedFindings: admittedFindings,
      policy: {
        reviewedPaths: input.workflowInput.reviewedPaths,
        ...(reviewedLineRanges === undefined ? {} : { reviewedLineRanges }),
        ...(reviewedDiffRanges === undefined ? {} : { reviewedDiffRanges }),
        minimumSeverity: 'info',
        inlineSeverityThreshold:
          input.workflowInput.admissionPolicy.inlineSeverityThreshold,
        provenance: {
          ...input.workflowInput.provenance,
          instructionHashes: input.instructionHashes,
          skillHashes: input.skillHashes
        },
        admittedAt: input.workflowInput.admissionPolicy.admittedAt
      }
    })

    if (result.status === 'admitted') {
      admittedFindings.push(result.admittedFinding)
      context.appendAdmittedFinding(result.admittedFinding)
      const decision: AdmissionDecisionRecord = {
        candidateId: candidate.id,
        status: 'admitted',
        findingId: result.admittedFinding.id
      }
      admissionDecisions.push(decision)
      context.appendAdmissionDecision(decision)
    } else {
      rejectedFindings.push(result.rejectedFinding)
      context.appendRejectedFinding(result.rejectedFinding)
      const decision: AdmissionDecisionRecord = {
        candidateId: candidate.id,
        status: result.status,
        rejectedReason: result.rejectedFinding.reason
      }
      admissionDecisions.push(decision)
      context.appendAdmissionDecision(decision)
    }
  }

  return { admittedFindings, rejectedFindings, admissionDecisions }
}

const reviewedLineRangesFromReviewContext = (
  reviewContext: readonly z.infer<typeof ReviewContextDocumentSchema>[]
): readonly ReviewedLineRange[] | undefined => {
  const ranges = reviewContext
    .filter(
      (document) => document.kind === 'file' && document.path !== undefined
    )
    .map((document) =>
      reviewedLineRangeForContent({
        path: document.path!,
        content: document.content
      })
    )

  return ranges.length === 0 ? undefined : ranges
}

const mergeCandidates = (
  inputCandidates: readonly CandidateFinding[],
  proposedCandidates: readonly CandidateFinding[]
): readonly CandidateFinding[] => {
  const candidatesById = new Map<string, CandidateFinding>()

  for (const candidate of [...inputCandidates, ...proposedCandidates]) {
    candidatesById.set(candidate.id, candidate)
  }

  return [...candidatesById.values()]
}

const taskIdForPath = (path: string): string =>
  `task_${sha256(path).slice(0, 16)}`

const pathFromEvidence = (evidence: EvidenceRecord): string | undefined =>
  evidence.location?.path

const pathFromCandidate = (candidate: CandidateFinding): string =>
  candidate.location.path

const taskCoversPath = (
  task: z.infer<typeof WorkflowReviewTaskSchema>,
  path: string | undefined
): boolean => path !== undefined && task.paths.includes(path)

const tasksForWorkflowInput = (
  input: ScriptedReviewWorkflowInput
): readonly z.infer<typeof WorkflowReviewTaskSchema>[] => {
  const inputTasks = input.tasks ?? []
  const inputReviewContext = input.reviewContext ?? []

  if (inputTasks.length > 0) {
    return inputTasks.map((task) =>
      task.reviewContext.length > 0
        ? task
        : {
            ...task,
            reviewContext: inputReviewContext.filter(
              (context) =>
                context.path === undefined ||
                task.paths.includes(context.path)
            )
          }
    )
  }

  return input.reviewedPaths.map((path) => ({
    id: taskIdForPath(path),
    round: 1,
    kind: 'file',
    paths: [path],
    factIds: [],
    evidenceIds: input.evidence
      .filter((evidence) => pathFromEvidence(evidence) === path)
      .map((evidence) => evidence.id),
    candidateIds: input.candidates
      .filter((candidate) => pathFromCandidate(candidate) === path)
      .map((candidate) => candidate.id),
    reviewContext: inputReviewContext.filter(
      (context) => context.path === undefined || context.path === path
    ),
    contextEntryIds: inputReviewContext
      .filter((context) => context.path === undefined || context.path === path)
      .map((context) => context.ledgerEntryId),
    priority: 0
  }))
}

const taskReviewInputFor = (
  input: ScriptedReviewWorkflowInput,
  task: z.infer<typeof WorkflowReviewTaskSchema>,
  sharedDigest: string
): TaskReviewPacket => {
  const evidence = input.evidence.filter((record) =>
    task.evidenceIds.length > 0
      ? task.evidenceIds.includes(record.id)
      : taskCoversPath(task, pathFromEvidence(record))
  )

  for (const record of evidence) {
    assertAnalyzerEvidenceOwnsPath(record)
  }

  const taskInput = TaskReviewInputSchema.parse({
    runId: input.runId,
    task,
    evidence,
    candidates: input.candidates.filter((candidate) =>
      task.candidateIds.length > 0
        ? task.candidateIds.includes(candidate.id)
        : taskCoversPath(task, pathFromCandidate(candidate))
    ),
    instructions: input.instructions,
    skills: input.skills,
    sharedDigest,
    provenance: input.provenance
  })

  return fitTaskReviewInputToBudget(taskInput, input.maxTaskInputBytes)
}

const serializedBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value))

const createTaskPacketBudgetExceededError = (
  input: {
    readonly taskId: string
    readonly maxTaskInputBytes: number
    readonly serializedBytes: number
  }
): StructuredError =>
  createStructuredError({
    code: 'task_packet_budget_exceeded',
    message:
      'Review task packet exceeds the configured provider input budget. The packet was not truncated; split the review scope further or increase the provider task budget.',
    category: 'provider',
    recoverable: true,
    exitCode: 4,
    details: {
      taskId: input.taskId,
      maxTaskInputBytes: input.maxTaskInputBytes,
      serializedBytes: input.serializedBytes
    }
  })

const fitTaskReviewInputToBudget = (
  taskInput: z.infer<typeof TaskReviewInputSchema>,
  maxTaskInputBytes: number | undefined
): TaskReviewPacket => {
  if (maxTaskInputBytes === undefined) {
    return {
      input: taskInput
    }
  }

  const currentBytes = serializedBytes(taskInput)

  if (currentBytes <= maxTaskInputBytes) {
    return {
      input: taskInput
    }
  }

  throw createTaskPacketBudgetExceededError({
    taskId: taskInput.task.id,
    maxTaskInputBytes,
    serializedBytes: currentBytes
  })
}

const suggestionDuplicatesInputCandidate = (
  input: z.infer<typeof TaskReviewInputSchema>,
  suggestion: z.infer<typeof ModelCandidateSuggestionSchema>,
  evidenceIds: readonly string[]
): boolean => {
  if (
    suggestion.category === undefined ||
    suggestion.path === undefined ||
    suggestion.startLine === undefined
  ) {
    return false
  }

  const suggestionEvidenceIds = new Set(evidenceIds)

  return input.candidates.some(
    (candidate) =>
      candidate.category === suggestion.category &&
      candidate.location.path === suggestion.path &&
      candidate.location.startLine === suggestion.startLine &&
      candidate.evidenceIds.some((evidenceId) =>
        suggestionEvidenceIds.has(evidenceId)
      )
  )
}

const candidateFromSuggestion = (
  input: z.infer<typeof TaskReviewInputSchema>,
  suggestion: z.infer<typeof ModelCandidateSuggestionSchema>
): CandidateFinding | undefined => {
  if (
    suggestion.category === undefined ||
    suggestion.severity === undefined ||
    suggestion.title === undefined ||
    suggestion.description === undefined ||
    suggestion.path === undefined ||
    suggestion.startLine === undefined ||
    suggestion.evidenceIds === undefined ||
    suggestion.evidenceIds.length === 0 ||
    !input.task.paths.includes(suggestion.path)
  ) {
    return undefined
  }

  const taskEvidenceIds = new Set(input.evidence.map((evidence) => evidence.id))
  const evidenceIds = suggestion.evidenceIds.filter((evidenceId) =>
    taskEvidenceIds.has(evidenceId)
  )

  if (evidenceIds.length === 0) {
    return undefined
  }

  if (suggestionDuplicatesInputCandidate(input, suggestion, evidenceIds)) {
    return undefined
  }

  const id = `cand_${sha256(
    `${input.task.id}:${suggestion.path}:${suggestion.startLine}:${suggestion.title}`
  ).slice(0, 16)}`
  const fixEdits = (suggestion.fixEdits ?? []).filter((edit) =>
    input.task.paths.includes(edit.path)
  )

  return CandidateFindingSchema.parse({
    id,
    taskId: input.task.id,
    category: suggestion.category,
    severity: suggestion.severity,
    title: suggestion.title.slice(0, 120),
    description: suggestion.description.slice(0, 1200),
    location: {
      path: suggestion.path,
      startLine: suggestion.startLine,
      side: 'file'
    },
    evidenceIds,
    proposedBy: 'review-agent',
    ...(suggestion.fixSummary === undefined && fixEdits.length === 0
      ? {}
      : {
          fixProposal: {
            summary:
              suggestion.fixSummary ??
              'Apply the proposed evidence-backed manual edit.',
            evidenceIds,
            safety: 'manual-review',
            ...(fixEdits.length === 0 ? {} : { edits: fixEdits })
          }
        })
  })
}

const candidatesFromModelSuggestions = (
  input: z.infer<typeof TaskReviewInputSchema>,
  suggestions: z.infer<typeof ModelTaskSuggestionsSchema>
): readonly CandidateFinding[] =>
  suggestions.candidates
    .map((suggestion) => candidateFromSuggestion(input, suggestion))
    .filter((candidate): candidate is CandidateFinding => candidate !== undefined)

const renderSharedDigest = (
  entries: readonly SharedContextEntry[],
  limit = 12
): string => {
  const selected = entries
    .filter((entry) =>
      entry.kind === 'repository-fact' ||
      entry.kind === 'task-state' ||
      entry.kind === 'admitted-finding'
    )
    .slice(-limit)

  if (selected.length === 0) {
    return '(no admitted shared context yet)'
  }

  return selected
    .map((entry) => {
      const task = entry.taskId === undefined ? '' : ` task=${entry.taskId}`
      const evidence =
        entry.evidenceIds.length === 0
          ? ''
          : ` evidence=${entry.evidenceIds.length}`

      return `[${entry.kind} source=${entry.source}${task}] ${entry.summary}${evidence}`
    })
    .join('\n')
}

const createWorkflowSharedContext = (
  input: ScriptedReviewWorkflowInput
): ReviewSharedContext => {
  const shared = createReviewSharedContext()

  for (const evidence of input.evidence) {
    shared.appendEvidenceRecord(evidence)
  }

  return shared
}

const appendLiveAdmittedCandidatesToSharedDigest = (
  input: {
    readonly shared: ReviewSharedContext
    readonly workflowInput: ScriptedReviewWorkflowInput
    readonly candidates: readonly CandidateFinding[]
    readonly admittedFindings: AdmittedFinding[]
    readonly instructionHashes: readonly string[]
    readonly skillHashes: readonly string[]
  }
): void => {
  for (const candidate of input.candidates) {
    const result = admitCandidate({
      candidate,
      evidence: input.workflowInput.evidence,
      existingAdmittedFindings: input.admittedFindings,
      policy: {
        reviewedPaths: input.workflowInput.reviewedPaths,
        minimumSeverity: 'info',
        inlineSeverityThreshold:
          input.workflowInput.admissionPolicy.inlineSeverityThreshold,
        provenance: {
          ...input.workflowInput.provenance,
          instructionHashes: input.instructionHashes,
          skillHashes: input.skillHashes
        },
        admittedAt: input.workflowInput.admissionPolicy.admittedAt
      }
    })

    if (result.status === 'admitted') {
      input.admittedFindings.push(result.admittedFinding)
      input.shared.appendAdmittedFinding(result.admittedFinding)
    }
  }
}

const runQueuedTasks = async <R>(
  input: {
    readonly tasks: readonly z.infer<typeof WorkflowReviewTaskSchema>[]
    readonly maxConcurrentTasks: number
    readonly logger?: Logger
    readonly runTask: (
      task: z.infer<typeof WorkflowReviewTaskSchema>,
      sharedDigest: string
    ) => Promise<R>
    readonly sharedDigest?: () => string
    readonly onTaskCompleted?: (
      task: z.infer<typeof WorkflowReviewTaskSchema>,
      result: R
    ) => void
    readonly onTaskEvent?: (
      event: z.infer<typeof WorkflowTaskEventSchema>
    ) => void
  }
): Promise<{
  readonly results: readonly R[]
  readonly taskEvents: readonly z.infer<typeof WorkflowTaskEventSchema>[]
}> => {
  const queue = createReviewTaskQueue(input.tasks)
  const results: R[] = []
  let firstError: unknown
  const emitTaskEvent = (
    record: ReviewTaskQueueRecord<z.infer<typeof WorkflowReviewTaskSchema>>
  ): void => {
    input.onTaskEvent?.(taskEventFromQueueRecord(record))
  }

  for (const record of queue.snapshot()) {
    emitTaskEvent(record)
  }

  const hasOpenTasks = (): boolean => {
    const latestByTaskId = new Map(
      queue.snapshot().map((record) => [record.id, record])
    )

    return [...latestByTaskId.values()].some(
      (record) => record.state === 'planned' || record.state === 'running'
    )
  }
  const waitForEligibleTask = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, 1))

  input.logger?.debug('Review task queue started.', {
    task_count: input.tasks.length,
    max_concurrent_tasks: input.maxConcurrentTasks
  })

  const runWorker = async (workerIndex: number): Promise<void> => {
    const workerId = `worker-${workerIndex + 1}`

    while (firstError === undefined) {
      const [task] = queue.claimBatch({
        limit: 1,
        workerId
      })
      const claimedRecord = queue.snapshot().at(-1)

      if (claimedRecord !== undefined && claimedRecord.id === task?.id) {
        emitTaskEvent(claimedRecord)
      }

      if (task === undefined) {
        if (!hasOpenTasks()) {
          return
        }

        await waitForEligibleTask()
        continue
      }

      input.logger?.debug('Review task claimed.', {
        task_id: task.id,
        task_round: task.round,
        worker_id: workerId,
        completed_task_count: results.length,
        pending_task_count: Math.max(0, input.tasks.length - results.length)
      })

      const sharedDigest =
        input.sharedDigest?.() ?? '(no admitted shared context yet)'

      // Provider-call retries (transient/network/timeout/rate-limit, classified)
      // are handled inside the harness model retry policy on the model alias, so
      // the queue runs each task exactly once.
      try {
        const result = await input.runTask(task, sharedDigest)

        queue.complete(task.id, 'worker completed')
        const completedRecord = queue.snapshot().at(-1)

        if (completedRecord !== undefined) {
          emitTaskEvent(completedRecord)
        }
        results.push(result)
        input.onTaskCompleted?.(task, result)
        input.logger?.debug('Review task completed.', {
          task_id: task.id,
          task_round: task.round,
          worker_id: workerId,
          completed_task_count: results.length,
          pending_task_count: Math.max(0, input.tasks.length - results.length)
        })
      } catch (error) {
        queue.fail(task.id, 'worker failed')
        const failedRecord = queue.snapshot().at(-1)

        if (failedRecord !== undefined) {
          emitTaskEvent(failedRecord)
        }
        firstError ??= error
        input.logger?.debug('Review task failed.', {
          task_id: task.id,
          task_round: task.round,
          worker_id: workerId,
          completed_task_count: results.length,
          pending_task_count: Math.max(0, input.tasks.length - results.length)
        })
        return
      }
    }
  }

  await Promise.all(
    Array.from({ length: input.maxConcurrentTasks }, (_value, index) =>
      runWorker(index)
    )
  )

  if (firstError !== undefined) {
    input.logger?.debug('Review task queue failed.', {
      completed_task_count: results.length,
      pending_task_count: Math.max(0, input.tasks.length - results.length)
    })

    throw new ReviewTaskExecutionError({
      taskEvents: queue.snapshot().map(taskEventFromQueueRecord),
      partialResults: results,
      originalError: firstError
    })
  }

  input.logger?.debug('Review task queue drained.', {
    completed_task_count: results.length
  })

  return {
    results,
    taskEvents: queue.snapshot().map(taskEventFromQueueRecord)
  }
}

const taskEventFromQueueRecord = (
  record: ReviewTaskQueueRecord<z.infer<typeof WorkflowReviewTaskSchema>>
): z.infer<typeof WorkflowTaskEventSchema> =>
  WorkflowTaskEventSchema.parse({
    id: record.id,
    kind: record.kind,
    round: record.round,
    paths: record.paths,
    state: record.state,
    ...(record.workerId === undefined ? {} : { workerId: record.workerId }),
    ...(record.message === undefined ? {} : { message: record.message })
  })

const completeWorkflow = (
  input: {
    readonly workflowInput: ScriptedReviewWorkflowInput
    readonly candidates: readonly CandidateFinding[]
    readonly taskEvents: readonly z.infer<typeof WorkflowTaskEventSchema>[]
    readonly instructionHashes: readonly string[]
    readonly skillHashes: readonly string[]
  }
): ScriptedReviewWorkflowOutput => {
  const mergedCandidates = mergeCandidates(
    input.workflowInput.candidates,
    input.candidates
  )
  const { admittedFindings, rejectedFindings, admissionDecisions } = runAdmission({
    ...input,
    candidates: mergedCandidates
  })
  const baseline = matchBaselineFindings({
    admittedFindings,
    ...(input.workflowInput.baselineFingerprints === undefined
      ? {}
      : {
          baselineFingerprints:
            input.workflowInput
              .baselineFingerprints as readonly BaselineFingerprintRecord[]
        }),
    baselineConfigured: input.workflowInput.baselineConfigured
  })
  const qualityGate = evaluateQualityGate({
    admittedFindings: baseline.admittedFindings,
    thresholds: input.workflowInput.qualityGate as QualityGateThresholds
  })

  return ScriptedReviewWorkflowOutputSchema.parse({
    admittedFindings: baseline.admittedFindings,
    rejectedFindings,
    evidence: input.workflowInput.evidence,
    candidateFindings: mergedCandidates,
    admissionDecisions,
    taskEvents: input.taskEvents,
    qualityGate,
    instructionHashes: input.instructionHashes,
    skillHashes: input.skillHashes,
    warnings: baseline.warnings
  })
}

const readonlySkillTools = ['read', 'list', 'grep'] as const satisfies readonly BuiltinToolName[]

// Per-task execution differs between the scripted and model-backed harnesses
// (the agent output schema and result mapping); everything else in the workflow
// handler is shared.
type ReviewWorkflowTaskRunner = (
  taskInput: z.infer<typeof TaskReviewInputSchema>,
  task: z.infer<typeof WorkflowReviewTaskSchema>,
  signal: AbortSignal | undefined
) => Promise<TaskReviewResult>

// Shared workflow handler body for both harness flavors. Builds tasks, runs them
// through the bounded queue with a live shared digest, and completes admission.
const runReviewWorkflowHandler = async (params: {
  readonly input: ScriptedReviewWorkflowInput
  readonly signal: AbortSignal | undefined
  readonly logger: Logger
  readonly maxConcurrentTasks: number
  readonly onTaskEvent?: (
    event: z.infer<typeof WorkflowTaskEventSchema>
  ) => void
  readonly runTask: ReviewWorkflowTaskRunner
}): Promise<ScriptedReviewWorkflowOutput> => {
  const { input, logger } = params
  const concurrency = boundedWorkflowConcurrency(
    input.maxConcurrentTasks,
    params.maxConcurrentTasks
  )
  logger.debug('Review workflow handler started.', {
    task_count: tasksForWorkflowInput(input).length,
    reviewed_path_count: input.reviewedPaths.length,
    max_concurrent_tasks: concurrency
  })
  const instructionHashes = hashAllowedInstructionContent(input.instructions)
  const skillHashes = hashAllowedSkillContent(input.skills)
  const tasks = tasksForWorkflowInput(input)
  const shared = createWorkflowSharedContext(input)
  const liveAdmittedFindings: AdmittedFinding[] = []
  const queued = await runQueuedTasks<TaskReviewResult>({
    tasks,
    maxConcurrentTasks: concurrency,
    logger,
    ...(params.onTaskEvent === undefined
      ? {}
      : { onTaskEvent: params.onTaskEvent }),
    sharedDigest: () => renderSharedDigest(shared.digest()),
    runTask: async (task, sharedDigest) => {
      const taskPacket = taskReviewInputFor(input, task, sharedDigest)
      return params.runTask(taskPacket.input, task, params.signal)
    },
    onTaskCompleted: (_task, result) => {
      appendLiveAdmittedCandidatesToSharedDigest({
        shared,
        workflowInput: input,
        candidates: result.candidates,
        admittedFindings: liveAdmittedFindings,
        instructionHashes,
        skillHashes
      })
    }
  }).catch((error: unknown) => {
    if (isReviewTaskExecutionError(error)) {
      throw new ReviewTaskExecutionError({
        taskEvents: error.taskEvents,
        partialResults: error.partialResults,
        originalError: error.originalError
      })
    }

    throw error
  })

  const output = completeWorkflow({
    workflowInput: input,
    candidates: queued.results.flatMap((result) => result.candidates),
    taskEvents: queued.taskEvents,
    instructionHashes,
    skillHashes
  })

  logger.debug('Review workflow handler completed.', {
    task_event_count: queued.taskEvents.length,
    candidate_count: output.candidateFindings.length,
    admitted_finding_count: output.admittedFindings.length,
    rejected_finding_count: output.rejectedFindings.length
  })

  return output
}

const reviewWorkflowDelegation = (maxConcurrentTasks: number) => ({
  agents: ['review_task'] as const,
  modelAliases: ['reviewer'] as const,
  maxChildAgentCalls: 10000,
  maxParallelChildAgentCalls: maxConcurrentTasks
})

const harnessDefaults = (options: CreateReviewHarnessOptions, maxConcurrentTasks: number) => ({
  runTimeoutMs: harnessRunTimeoutMs(options.runTimeoutMs),
  delegation: {
    maxParallelChildAgentCalls: maxConcurrentTasks
  }
})

const buildReviewHarness = (options: CreateReviewHarnessOptions) => {
  const skills = options.skills ?? {}
  const logger = options.logger ?? createNoopReviewLogger()
  const maxConcurrentTasks = effectiveMaxConcurrentTasks(
    options.maxConcurrentTasks
  )

  return defineHarness({ name: 'codereviewer-review' })
    .logger(logger)
    .defaults(harnessDefaults(options, maxConcurrentTasks))
    .telemetry({ contentCaptureMode: 'NO_CONTENT' })
    .models({
      reviewer: options.modelAlias
    })
    .tools({})
    .skills(skills)
    .agents(({ agent }) => ({
      review_task: agent({
        model: 'reviewer',
        input: TaskReviewInputSchema,
        output: ProposedCandidatesSchema,
        builtinTools: false,
        instructions:
          'Return candidate findings already provided by the scripted task input.',
        handler: async (ctx) => {
          failIfRequested(options.failBeforeAdmission)

          return {
            candidates: ctx.input.candidates
          }
        }
      })
    }))
    .workflows(({ workflow }) => ({
      review_repository: workflow({
        input: ScriptedReviewWorkflowInputSchema,
        output: ScriptedReviewWorkflowOutputSchema,
        delegation: reviewWorkflowDelegation(maxConcurrentTasks),
        handler: (ctx) =>
          runReviewWorkflowHandler({
            input: ctx.input,
            signal: ctx.signal,
            logger,
            maxConcurrentTasks,
            ...(options.onTaskEvent === undefined
              ? {}
              : { onTaskEvent: options.onTaskEvent }),
            runTask: async (taskInput, task, signal) => {
              logger.debug('Review task call started.', {
                task_id: task.id,
                task_round: task.round,
                path_count: task.paths.length,
                task_context_count: task.reviewContext.length,
                evidence_count: taskInput.evidence.length,
                candidate_count: taskInput.candidates.length
              })
              const proposed = await ctx.agents.review_task(
                taskInput,
                signal === undefined ? {} : { signal }
              )

              logger.debug('Review task call completed.', {
                task_id: task.id,
                task_round: task.round,
                candidate_count: proposed.candidates.length
              })
              return TaskReviewResultSchema.parse({
                candidates: proposed.candidates
              })
            }
          })
      })
    }))
    .build()
}

const modelReviewerInstructions = [
  'Review only the provided task packet. Do not review files outside task.paths.',
  'Return only candidate findings supported by evidence IDs present in this task input.',
  'Input candidates are already handled by deterministic admission; do not return them again.',
  'Return only additional findings that are not duplicates of input candidates or admitted shared context.',
  'Prioritize correctness, security, reliability, maintainability, minimal noise, and concrete remediation.',
  'Do not invent files, line numbers, evidence IDs, or unsupported claims.',
  'Each suggestion should include category, severity, title, description, path, startLine, and evidenceIds.',
  'Every evidenceIds entry must be copied exactly from task evidence.',
  'Every path must be one of task.paths and startLine must be a positive integer.',
  'Use fixSummary when a concrete remediation direction is available.',
  'Use fixEdits for concrete manual-review edit suggestions: path, startLine, endLine, replacement, and optional description.',
  'Return a JSON object with a candidates array. Return {"candidates": []} when the evidence does not support a finding.'
].join('\n')

const buildModelBackedReviewHarness = (options: CreateReviewHarnessOptions) => {
  const skills = options.skills ?? {}
  const logger = options.logger ?? createNoopReviewLogger()
  const maxConcurrentTasks = effectiveMaxConcurrentTasks(
    options.maxConcurrentTasks
  )
  const skillIds = options.skillIds ?? Object.keys(skills)
  const skillTools = options.skillTools ?? readonlySkillTools
  const skillAgentOptions =
    skillIds.length === 0
      ? {
          builtinTools: false as const,
          maxSteps: 1
        }
      : {
          builtinTools: skillTools,
          skills: skillIds,
          maxSteps: 4
        }

  return defineHarness({ name: 'codereviewer-review' })
    .logger(logger)
    .defaults(harnessDefaults(options, maxConcurrentTasks))
    .telemetry({ contentCaptureMode: 'NO_CONTENT' })
    .models({
      reviewer: options.modelAlias
    })
    .tools({})
    .skills(skills)
    .agents(({ agent }) => ({
      review_task: agent({
        model: 'reviewer',
        input: TaskReviewInputSchema,
        output: ModelTaskSuggestionsSchema,
        ...skillAgentOptions,
        instructions: modelReviewerInstructions
      })
    }))
    .workflows(({ workflow }) => ({
      review_repository: workflow({
        input: ScriptedReviewWorkflowInputSchema,
        output: ScriptedReviewWorkflowOutputSchema,
        delegation: reviewWorkflowDelegation(maxConcurrentTasks),
        handler: (ctx) =>
          runReviewWorkflowHandler({
            input: ctx.input,
            signal: ctx.signal,
            logger,
            maxConcurrentTasks,
            ...(options.onTaskEvent === undefined
              ? {}
              : { onTaskEvent: options.onTaskEvent }),
            runTask: async (taskInput, task, signal) => {
              logger.debug('Review task provider call started.', {
                task_id: task.id,
                task_round: task.round,
                path_count: task.paths.length,
                task_context_count: task.reviewContext.length,
                evidence_count: taskInput.evidence.length,
                candidate_count: taskInput.candidates.length
              })
              const suggestions = await ctx.agents.review_task(
                taskInput,
                signal === undefined ? {} : { signal }
              )
              const candidates = candidatesFromModelSuggestions(
                taskInput,
                suggestions
              )

              logger.debug('Review task provider call completed.', {
                task_id: task.id,
                task_round: task.round,
                suggestion_count: suggestions.candidates.length,
                candidate_count: candidates.length
              })
              return TaskReviewResultSchema.parse({ candidates })
            }
          })
      })
    }))
    .build()
}

export type ReviewHarness = ReturnType<typeof buildReviewHarness>
export type ModelBackedReviewHarness = ReturnType<
  typeof buildModelBackedReviewHarness
>

export const createReviewHarness = buildReviewHarness
export const createModelBackedReviewHarness = buildModelBackedReviewHarness

const runReviewWorkflowSession = async (
  options: {
    readonly harness: ReviewHarness | ModelBackedReviewHarness
    readonly sessionId: string
    readonly input: ScriptedReviewWorkflowInputDraft
    readonly operation: string
    readonly signal?: AbortSignal
  }
): Promise<ScriptedReviewWorkflowOutput> => {
  try {
    const session = await options.harness.getSession(options.sessionId)

    try {
      const input = ScriptedReviewWorkflowInputSchema.parse(options.input)
      const invokeOptions =
        options.signal === undefined ? {} : { signal: options.signal }

      return await session.workflows.review_repository.prompt(
        input,
        invokeOptions
      )
    } finally {
      await session.close()
    }
  } catch (error) {
    if (isReviewTaskExecutionError(error)) {
      throw error
    }

    throw normalizeError(error, {
      source: 'provider',
      operation: options.operation
    })
  }
}

export const runScriptedReviewWorkflow = (
  options: {
    readonly harness: ReviewHarness
    readonly sessionId: string
    readonly input: ScriptedReviewWorkflowInputDraft
    readonly signal?: AbortSignal
  }
): Promise<ScriptedReviewWorkflowOutput> =>
  runReviewWorkflowSession({
    ...options,
    operation: 'run_scripted_review_workflow'
  })

export const runModelBackedReviewWorkflow = (
  options: {
    readonly harness: ModelBackedReviewHarness
    readonly sessionId: string
    readonly input: ScriptedReviewWorkflowInputDraft
    readonly signal?: AbortSignal
  }
): Promise<ScriptedReviewWorkflowOutput> =>
  runReviewWorkflowSession({
    ...options,
    operation: 'run_model_backed_review_workflow'
  })
