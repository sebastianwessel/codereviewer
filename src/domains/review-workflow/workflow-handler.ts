import { type Logger } from '@purista/harness'
import {
  type ContextDocument,
  type FindingAggregateReviewRunner,
  type FindingJudgeRunner,
  type FindingRefutationRunner,
  type ProviderIssue,
  type ReviewIntentPlanningRunner,
  type SkillContextDocument,
  type TaskReviewInput,
  type TaskReviewResult,
  type WorkflowReviewTask,
  type WorkflowTaskEvent
} from './model-agent-contracts.js'
import { type CandidateFinding } from '../admission/index.js'
import {
  createContextRetriever,
  type ContextRetriever
} from '../context-retrieval/index.js'
import { type ContextLedgerEntry } from '../review-planning/index.js'
import {
  createReviewSharedContext,
  type ReviewSharedContext
} from '../shared-context/index.js'
import { createStructuredError } from '../../shared/errors/error-normalizer.js'
import { sha256 } from '../../shared/hash/hash.js'
import { prepareCandidatesForAdmission } from './model-admission-review.js'
import { reviewAggregateFindingProofs } from './model-aggregate-review.js'
import { providerIssueForError } from './model-provider-issues.js'
import {
  isTaskPacketBudgetExceededError,
  taskReviewInputFor
} from './model-task-packet.js'
import { renderSharedDigest } from './model-shared-digest.js'
import {
  applyReviewIntentsToTasks,
  deterministicReviewIntentsForTasks,
  executionTasksForReviewIntents,
  intentPlanningInputFor,
  tasksForWorkflowInput
} from './workflow-task-planning.js'
import {
  ReviewTaskExecutionError,
  isReviewTaskExecutionError,
  runQueuedReviewTasks
} from './workflow-task-queue.js'
import {
  admissionDecisionForRejectedPromotion,
  completeReviewWorkflow,
  rejectedFindingForPromotionDecision
} from './workflow-completion.js'
import {
  type ReviewWorkflowInput,
  type ReviewWorkflowOutput
} from './workflow-contracts.js'

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
  contextRetriever: ContextRetriever | undefined,
  reserveModelInvestigationSlots: (requested: number) => number
) => Promise<TaskReviewResult>

export const runReviewWorkflowHandler = async (params: {
  readonly input: ReviewWorkflowInput
  readonly signal: AbortSignal | undefined
  readonly logger: Logger
  readonly maxConcurrentTasks: number
  readonly onTaskEvent?: (event: WorkflowTaskEvent) => void
  readonly runTask: ReviewWorkflowTaskRunner
  readonly refuteFinding?: FindingRefutationRunner
  readonly planReviewIntents?: ReviewIntentPlanningRunner
  readonly aggregateFindingProofs?: FindingAggregateReviewRunner
  readonly judgeFinding?: FindingJudgeRunner
}): Promise<ReviewWorkflowOutput> => {
  const { input, logger } = params
  const rawTasks = tasksForWorkflowInput(input)
  const concurrency = boundedWorkflowConcurrency(
    input.maxConcurrentTasks,
    params.maxConcurrentTasks
  )
  logger.debug('Review workflow handler started.', {
    task_count: rawTasks.length,
    reviewed_path_count: input.reviewedPaths.length,
    max_concurrent_tasks: concurrency
  })
  const instructionHashes = hashAllowedInstructionContent(input.instructions)
  const skillHashes = hashAllowedSkillContent(input.skills)
  const planningProviderIssues: ProviderIssue[] = []
  const shouldRunModelIntentPlanner =
    input.intentPlanning === 'model' &&
    rawTasks.length > 1 &&
    params.planReviewIntents !== undefined
  const reviewIntents =
    shouldRunModelIntentPlanner
      ? await params
          .planReviewIntents(intentPlanningInputFor(input, rawTasks), params.signal)
          .catch((error: unknown) => {
            planningProviderIssues.push(
              providerIssueForError({
                error,
                stage: 'intent-planning',
                recovered: true
              })
            )

            return deterministicReviewIntentsForTasks(rawTasks)
          })
      : deterministicReviewIntentsForTasks(rawTasks)
  const intentAnnotatedTasks = applyReviewIntentsToTasks(rawTasks, reviewIntents)
  const tasks = executionTasksForReviewIntents(
    intentAnnotatedTasks,
    reviewIntents,
    {
      canUseClusterTask: (task) => {
        try {
          taskReviewInputFor(
            input,
            task,
            reviewIntents,
            '(no admitted shared context yet)'
          )
          return true
        } catch (error: unknown) {
          if (isTaskPacketBudgetExceededError(error)) {
            return false
          }

          throw error
        }
      }
    }
  )
  const shared = createWorkflowSharedContext(input)
  let remainingModelInvestigations =
    input.maxInvestigationsPerRun ?? Number.POSITIVE_INFINITY
  const reserveModelInvestigationSlots = (requested: number): number => {
    const allowed = Math.max(
      0,
      Math.min(requested, remainingModelInvestigations)
    )
    remainingModelInvestigations -= allowed

    return allowed
  }
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
      const taskPacket = taskReviewInputFor(
        input,
        task,
        reviewIntents,
        sharedDigest
      )
      return params.runTask(
        taskPacket.input,
        task,
        params.signal,
        contextRetriever,
        reserveModelInvestigationSlots
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
  const modelSuspicions = queued.results.flatMap(
    (result) => result.modelSuspicions
  )
  const modelTaskDiagnostics = queued.results.flatMap(
    (result) => result.modelTaskDiagnostics
  )
  const investigationTraces = queued.results.flatMap(
    (result) => result.investigationTraces
  )
  const proofPackets = queued.results.flatMap((result) => result.proofPackets)
  const refutationResults = queued.results.flatMap(
    (result) => result.refutationResults
  )
  const taskPromotionDecisions = queued.results.flatMap(
    (result) => result.promotionDecisions
  )
  const taskProviderIssues = queued.results.flatMap(
    (result) => result.providerIssues
  )
  const mergedCandidates = mergeCandidates(input.candidates, taskCandidates)
  const rejectedPromotionDecisions = taskPromotionDecisions.filter(
    (decision) => decision.status === 'rejected'
  )
  const rejectedPromotionCandidateIds = new Set(
    rejectedPromotionDecisions.map((decision) => decision.candidateId)
  )
  const promotionArtifactOnlyCandidateIds = taskPromotionDecisions
    .filter((decision) => decision.status === 'artifact-only')
    .map((decision) => decision.candidateId)
  const promotionRejectedFindings = rejectedPromotionDecisions.map(
    rejectedFindingForPromotionDecision
  )
  const promotionAdmissionDecisions = rejectedPromotionDecisions.map(
    admissionDecisionForRejectedPromotion
  )
  const aggregateReview = await reviewAggregateFindingProofs({
    workflowInput: input,
    ...(params.aggregateFindingProofs === undefined
      ? {}
      : { aggregateFindingProofs: params.aggregateFindingProofs }),
    candidates: mergedCandidates,
    sharedDigest: renderSharedDigest(shared.digest()),
    reviewIntents,
    proofPackets,
    refutationResults,
    investigationTraces,
    evidence: [...input.evidence, ...taskEvidenceRecords],
    ...(params.signal === undefined ? {} : { signal: params.signal })
  })
  const visibleTaskPromotionDecisions = taskPromotionDecisions.filter(
    (decision) => !aggregateReview.rejectedCandidateIds.has(decision.candidateId)
  )
  const prepared = await prepareCandidatesForAdmission({
    workflowInput: input,
    tasks,
    candidates: mergedCandidates.filter(
      (candidate) =>
        !rejectedPromotionCandidateIds.has(candidate.id) &&
        !aggregateReview.rejectedCandidateIds.has(candidate.id)
    ),
    sharedDigest: renderSharedDigest(shared.digest()),
    reviewEvidence: [...input.evidence, ...taskEvidenceRecords],
    reviewIntents,
    proofPackets,
    refutationResults,
    ...(params.refuteFinding === undefined
      ? {}
      : { refuteFinding: params.refuteFinding }),
    skipJudgeCandidateIds: aggregateReview.coveredCandidateIds,
    ...(params.judgeFinding === undefined
      ? {}
      : { judgeFinding: params.judgeFinding }),
    ...(contextRetriever === undefined ? {} : { contextRetriever }),
    ...(params.signal === undefined ? {} : { signal: params.signal })
  }).catch((error: unknown) => {
    throw new ReviewTaskExecutionError({
      taskEvents: queued.taskEvents,
      partialResults: queued.results,
      originalError: error
    })
  })

  const output = completeReviewWorkflow({
    workflowInput: input,
    candidateFindings: mergedCandidates,
    admissionCandidates: prepared.admissionCandidates,
    artifactOnlyCandidateIds: [
      ...prepared.artifactOnlyCandidateIds,
      ...promotionArtifactOnlyCandidateIds
    ],
    modelSuspicions,
    investigationTraces,
    proofPackets,
    refutationResults: [...refutationResults, ...prepared.refutationResults],
    aggregateResults: aggregateReview.aggregateResults,
    reviewIntents,
    modelTaskDiagnostics,
    judgeResults: prepared.judgeResults,
    promotionDecisions: visibleTaskPromotionDecisions,
    providerIssues: [
      ...planningProviderIssues,
      ...taskProviderIssues,
      ...aggregateReview.providerIssues,
      ...prepared.providerIssues
    ],
    contextLedgerEntries,
    evidence: [...prepared.evidence, ...taskEvidenceRecords],
    preRejectedFindings: [
      ...prepared.rejectedFindings,
      ...aggregateReview.rejectedFindings,
      ...promotionRejectedFindings
    ],
    preAdmissionDecisions: [
      ...prepared.admissionDecisions,
      ...aggregateReview.admissionDecisions,
      ...promotionAdmissionDecisions
    ],
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
