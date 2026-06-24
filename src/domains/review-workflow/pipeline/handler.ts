import { type Logger } from '@purista/harness'
import {
  type ContextDocument,
  type FindingRefutationRunner,
  type ProviderIssue,
  type SkillContextDocument,
  type TaskReviewInput,
  type TaskReviewResult,
  type WorkflowReviewTask,
  type WorkflowTaskEvent
} from './agent-contracts.js'
import { type CandidateFinding } from '../../admission/index.js'
import {
  createContextRetriever,
  type ContextRetriever
} from '../../context-retrieval/index.js'
import { type ContextLedgerEntry } from '../../review-planning/index.js'
import {
  createReviewSharedContext,
  type ReviewSharedContext
} from '../../shared-context/index.js'
import { createStructuredError } from '../../../shared/errors/error-normalizer.js'
import { sha256 } from '../../../shared/hash/hash.js'
import { prepareCandidatesForAdmission } from './admission/review.js'
import {
  isTaskPacketBudgetExceededError,
  taskReviewInputFor
} from './discovery/task-packet.js'
import { renderSharedDigest } from './shared-digest.js'
import { tasksForWorkflowInput } from './task-planning.js'
import {
  ReviewTaskExecutionError,
  isReviewTaskExecutionError,
  runQueuedReviewTasks
} from './task-queue.js'
import { completeReviewWorkflow } from './completion.js'
import {
  type ReviewWorkflowInput,
  type ReviewWorkflowOutput
} from './contracts.js'

const boundedWorkflowConcurrency = (
  workflowMaxConcurrentTasks: number | undefined,
  harnessMaxConcurrentTasks: number
): number =>
  Math.min(
    workflowMaxConcurrentTasks ?? harnessMaxConcurrentTasks,
    harnessMaxConcurrentTasks
  )

const hashAllowedInstructionContent = (
  instructions: readonly ContextDocument[]
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
  skills: readonly SkillContextDocument[]
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

const createWorkflowSharedContext = (
  input: ReviewWorkflowInput
): ReviewSharedContext => {
  const shared = createReviewSharedContext()

  for (const evidence of input.evidence) {
    shared.appendEvidenceRecord(evidence)
  }

  return shared
}

export type ReviewWorkflowTaskRunner = (
  taskInput: TaskReviewInput,
  task: WorkflowReviewTask,
  signal: AbortSignal | undefined,
  contextRetriever: ContextRetriever | undefined
) => Promise<TaskReviewResult>

export const runReviewWorkflowHandler = async (params: {
  readonly input: ReviewWorkflowInput
  readonly signal: AbortSignal | undefined
  readonly logger: Logger
  readonly maxConcurrentTasks: number
  readonly onTaskEvent?: (event: WorkflowTaskEvent) => void
  readonly runTask: ReviewWorkflowTaskRunner
  readonly refuteFinding?: FindingRefutationRunner
}): Promise<ReviewWorkflowOutput> => {
  const { input, logger } = params
  const tasks = tasksForWorkflowInput(input)
  const concurrency = boundedWorkflowConcurrency(
    input.maxConcurrentTasks,
    params.maxConcurrentTasks
  )
  logger.debug('Review workflow handler started.', {
    task_count: tasks.length,
    reviewed_path_count: input.reviewedPaths.length,
    max_concurrent_tasks: concurrency
  })
  const instructionHashes = hashAllowedInstructionContent(input.instructions)
  const skillHashes = hashAllowedSkillContent(input.skills)
  const shared = createWorkflowSharedContext(input)
  const contextLedgerEntries: ContextLedgerEntry[] = []
  const contextRetriever =
    input.repositoryRoot === undefined
      ? undefined
      : createContextRetriever({
          repositoryRoot: input.repositoryRoot,
          ...(input.contextRetrievalBudget === undefined
            ? {}
            : { budget: input.contextRetrievalBudget }),
          ledgerEntries: contextLedgerEntries
        })
  const queued = await runQueuedReviewTasks<TaskReviewResult>({
    tasks,
    maxConcurrentTasks: concurrency,
    logger,
    ...(params.onTaskEvent === undefined
      ? {}
      : { onTaskEvent: params.onTaskEvent }),
    sharedDigest: () => renderSharedDigest(shared.digest()),
    runTask: async (task, sharedDigest) => {
      const taskPacket = taskReviewInputFor(input, task, sharedDigest)
      return params.runTask(
        taskPacket.input,
        task,
        params.signal,
        contextRetriever
      )
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

  const taskCandidates = queued.results.flatMap((result) => result.candidates)
  const taskEvidenceRecords = queued.results.flatMap(
    (result) => result.evidenceRecords
  )
  const taskProviderIssues = queued.results.flatMap(
    (result) => result.providerIssues
  )
  const mergedCandidates = mergeCandidates(input.candidates, taskCandidates)
  const prepared = await prepareCandidatesForAdmission({
    workflowInput: input,
    tasks,
    candidates: mergedCandidates,
    sharedDigest: renderSharedDigest(shared.digest()),
    reviewEvidence: [...input.evidence, ...taskEvidenceRecords],
    ...(params.refuteFinding === undefined
      ? {}
      : { refuteFinding: params.refuteFinding }),
    ...(params.signal === undefined ? {} : { signal: params.signal })
  }).catch((error: unknown) => {
    throw new ReviewTaskExecutionError({
      taskEvents: queued.taskEvents,
      partialResults: queued.results,
      originalError: error
    })
  })

  const providerIssues: ProviderIssue[] = [
    ...taskProviderIssues,
    ...prepared.providerIssues
  ]

  const output = completeReviewWorkflow({
    workflowInput: input,
    candidateFindings: mergedCandidates,
    admissionCandidates: prepared.admissionCandidates,
    artifactOnlyCandidateIds: prepared.artifactOnlyCandidateIds,
    refutationResults: prepared.refutationResults,
    providerIssues,
    contextLedgerEntries,
    evidence: [...prepared.evidence, ...taskEvidenceRecords],
    preRejectedFindings: prepared.rejectedFindings,
    preAdmissionDecisions: prepared.admissionDecisions,
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

export { isTaskPacketBudgetExceededError }
