import { ModelTaskDiagnosticSchema } from '../../shared/contracts/index.js'
import { type ContextRetriever } from '../context-retrieval/index.js'
import {
  type FindingInvestigationRunner,
  type ModelTaskSuggestions,
  type SiblingSweepInput,
  type TaskReviewInput,
  type TaskReviewResult,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import { type ContextRequestArtifactCache } from './model-context-artifacts.js'
import { selectModelTaskCandidates } from './model-task-candidate-selection.js'
import { logModelTaskReviewCompletion } from './model-task-completion-logger.js'
import { runModelTaskPrimaryProof } from './model-task-primary-proof-runner.js'
import { runModelTaskSiblingSweep } from './model-task-sibling-sweep.js'
import { modelTaskSuggestionRunner } from './model-task-suggestion-runner.js'
import { assembleModelTaskReviewResult } from './model-task-review-result.js'
import { type ReviewWorkflowInput } from './workflow-contracts.js'

type ModelTaskReviewLogger = {
  readonly debug: (
    message: string,
    metadata?: Readonly<Record<string, unknown>>
  ) => void
}

export type ModelTaskReviewRunners = {
  readonly reviewTask: (
    input: TaskReviewInput,
    signal: AbortSignal | undefined
  ) => Promise<ModelTaskSuggestions>
  readonly investigateSuspicion: FindingInvestigationRunner
  readonly sweepSiblingSuspicions: (
    input: SiblingSweepInput,
    signal: AbortSignal | undefined
  ) => Promise<ModelTaskSuggestions>
}

export const runModelBackedTaskReview = async (
  input: {
    readonly workflowInput: ReviewWorkflowInput
    readonly taskInput: TaskReviewInput
    readonly task: WorkflowReviewTask
    readonly contextRetriever?: ContextRetriever | undefined
    readonly reserveModelInvestigationSlots: (requested: number) => number
    readonly runners: ModelTaskReviewRunners
    readonly logger: ModelTaskReviewLogger
    readonly signal?: AbortSignal | undefined
  }
): Promise<TaskReviewResult> => {
  const suggestions = await modelTaskSuggestionRunner({
    logger: input.logger,
    reviewTask: input.runners.reviewTask
  })(input.taskInput, input.signal)
  const contextArtifactCache: ContextRequestArtifactCache = new Map()
  const selectedCandidates = selectModelTaskCandidates({
    taskInput: input.taskInput,
    suggestions,
    maxSuspicionsPerTask: input.workflowInput.maxSuspicionsPerTask,
    reserveModelInvestigationSlots: input.reserveModelInvestigationSlots
  })
  const proofArtifacts = await runModelTaskPrimaryProof({
    taskInput: input.taskInput,
    selectedCandidates,
    contextRetriever: input.contextRetriever,
    promotionPolicy: input.workflowInput.promotionPolicy,
    maxInvestigationRounds: input.workflowInput.maxInvestigationRounds,
    maxTaskInputBytes: input.workflowInput.maxTaskInputBytes,
    investigateSuspicion: input.runners.investigateSuspicion,
    contextArtifactCache,
    logger: input.logger,
    signal: input.signal
  })

  const siblingArtifacts = await runModelTaskSiblingSweep({
    taskInput: input.taskInput,
    task: input.task,
    judgeFindings: input.workflowInput.judgeFindings,
    maxSuspicionsPerTask: input.workflowInput.maxSuspicionsPerTask,
    promotionPolicy: input.workflowInput.promotionPolicy,
    maxInvestigationRounds: input.workflowInput.maxInvestigationRounds,
    maxTaskInputBytes: input.workflowInput.maxTaskInputBytes,
    primaryCandidates: selectedCandidates.candidates,
    proofArtifacts,
    contextRetriever: input.contextRetriever,
    contextArtifactCache,
    reserveModelInvestigationSlots: input.reserveModelInvestigationSlots,
    sweepSiblingSuspicions: input.runners.sweepSiblingSuspicions,
    investigateSuspicion: input.runners.investigateSuspicion,
    logger: input.logger,
    signal: input.signal
  })

  logModelTaskReviewCompletion({
    task: input.task,
    suggestions,
    selectedCandidates,
    primaryArtifacts: proofArtifacts,
    siblingArtifacts,
    logger: input.logger
  })

  return assembleModelTaskReviewResult({
    primaryCandidates: selectedCandidates.candidates,
    primaryArtifacts: proofArtifacts,
    siblingArtifacts,
    modelTaskDiagnostics: [
      ModelTaskDiagnosticSchema.parse({
        taskId: input.task.id,
        taskKind: input.task.kind,
        round: input.task.round,
        paths: input.task.paths,
        evidenceCount: input.taskInput.evidence.length,
        reviewContextCount: input.task.reviewContext.length,
        reviewIntentCount: input.taskInput.reviewIntents.length,
        verificationQuestionCount: input.taskInput.reviewIntents.reduce(
          (count, intent) => count + intent.verificationQuestions.length,
          0
        ),
        suggestionCount: suggestions.suspicions.length,
        convertedCandidateCount: selectedCandidates.convertedCandidateCount,
        selectedCandidateCount: selectedCandidates.candidates.length,
        budgetDroppedCandidateCount:
          selectedCandidates.budgetDroppedCandidateCount,
        modelSuspicionCount: proofArtifacts.modelSuspicions.length,
        proofPacketCount: proofArtifacts.proofPackets.length,
        zeroCandidateReason:
          selectedCandidates.candidates.length > 0
            ? 'none'
            : suggestions.suspicions.length === 0
              ? 'no-suggestions'
              : selectedCandidates.convertedCandidateCount === 0
                ? 'all-suggestions-dropped'
                : 'investigation-budget-exhausted',
        droppedSuspicionReasons: selectedCandidates.droppedSuspicionReasons,
        ...(Object.keys(selectedCandidates.schemaInvalidSuggestionIssueCounts)
          .length === 0
          ? {}
          : {
              schemaInvalidSuggestionIssueCounts:
                selectedCandidates.schemaInvalidSuggestionIssueCounts
            })
      })
    ]
  })
}
