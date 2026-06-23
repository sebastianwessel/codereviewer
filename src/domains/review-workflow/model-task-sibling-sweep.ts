import {
  type ProofPacket,
  type PromotionPolicyConfig
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { type ContextRetriever } from '../context-retrieval/index.js'
import {
  TaskReviewResultSchema,
  type FindingInvestigationRunner,
  type ModelTaskSuggestions,
  type SiblingSweepInput,
  type TaskReviewInput,
  type TaskReviewResult,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import { type ContextRequestArtifactCache } from './model-context-artifacts.js'
import {
  runModelTaskSiblingProviderSweep,
  type ModelTaskSiblingProofArtifacts,
  type ModelTaskSiblingProviderLogger
} from './model-task-sibling-provider-runner.js'
import { runModelTaskSiblingProofSweep } from './model-task-sibling-proof-runner.js'
import { selectModelTaskSiblingCandidates } from './model-task-sibling-selection.js'

export type ModelTaskSiblingSweepInput = {
  readonly taskInput: TaskReviewInput
  readonly task: WorkflowReviewTask
  readonly judgeFindings: boolean
  readonly maxSuspicionsPerTask?: number | undefined
  readonly promotionPolicy: PromotionPolicyConfig
  readonly maxInvestigationRounds?: number | undefined
  readonly maxTaskInputBytes?: number | undefined
  readonly primaryCandidates: readonly CandidateFinding[]
  readonly proofArtifacts: ModelTaskSiblingProofArtifacts
  readonly contextRetriever?: ContextRetriever | undefined
  readonly contextArtifactCache: ContextRequestArtifactCache
  readonly reserveModelInvestigationSlots: (requested: number) => number
  readonly sweepSiblingSuspicions: (
    input: SiblingSweepInput,
    signal: AbortSignal | undefined
  ) => Promise<ModelTaskSuggestions>
  readonly investigateSuspicion: FindingInvestigationRunner
  readonly logger: ModelTaskSiblingProviderLogger
  readonly signal?: AbortSignal | undefined
}

const shouldRunSiblingSweep = (
  input: TaskReviewInput,
  proofPackets: readonly ProofPacket[]
): boolean =>
  proofPackets.length > 0 &&
  (input.task.paths.length > 1 || input.reviewedDiffRanges.length > 1)

const emptyTaskReviewResult = (): TaskReviewResult =>
  TaskReviewResultSchema.parse({ candidates: [] })

export const runModelTaskSiblingSweep = async (
  input: ModelTaskSiblingSweepInput
): Promise<TaskReviewResult> => {
  if (
    !input.judgeFindings ||
    !shouldRunSiblingSweep(input.taskInput, input.proofArtifacts.proofPackets)
  ) {
    return emptyTaskReviewResult()
  }

  const providerSweep = await runModelTaskSiblingProviderSweep({
    taskInput: input.taskInput,
    proofArtifacts: input.proofArtifacts,
    logger: input.logger,
    sweepSiblingSuspicions: input.sweepSiblingSuspicions,
    signal: input.signal
  })
  const sweepSuggestions = providerSweep.suggestions

  if (sweepSuggestions === undefined) {
    return TaskReviewResultSchema.parse({
      candidates: [],
      providerIssues: providerSweep.providerIssues
    })
  }

  const selectedSiblings = selectModelTaskSiblingCandidates({
    taskInput: input.taskInput,
    suggestions: sweepSuggestions,
    primaryCandidates: input.primaryCandidates,
    maxSuspicionsPerTask: input.maxSuspicionsPerTask,
    reserveModelInvestigationSlots: input.reserveModelInvestigationSlots
  })
  return runModelTaskSiblingProofSweep({
    taskInput: input.taskInput,
    task: input.task,
    suggestions: sweepSuggestions,
    selectedSiblings,
    contextRetriever: input.contextRetriever,
    promotionPolicy: input.promotionPolicy,
    maxInvestigationRounds: input.maxInvestigationRounds,
    maxTaskInputBytes: input.maxTaskInputBytes,
    investigateSuspicion: input.investigateSuspicion,
    contextArtifactCache: input.contextArtifactCache,
    logger: input.logger,
    signal: input.signal
  })
}
