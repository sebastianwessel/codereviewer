import type { Logger } from '@purista/harness'
import type { CodeReviewerConfig, EvidenceRecord } from '../../../../shared/contracts/index.js'
import type { CandidateFinding } from '../../../admission/index.js'
import type {
  DeterministicSignalExtraction,
  SupportSignalSourceFile
} from '../../../deterministic-signals/index.js'
import type { NoContentEventRecorder } from '../../../observability/index.js'
import type { ReviewTask } from '../../../review-planning/index.js'
import {
  deterministicSignalStepStartAttributes,
  prepareReviewRunnerDeterministicSignals,
  type ReviewRunnerDeterministicSignalState
} from '../intake/deterministic-signals.js'
import {
  prepareReviewRunnerTaskPlanning,
  type ReviewRunnerTaskPlanningInput,
  type ReviewRunnerTaskPlanningResult
} from './task-planning.js'

type PrepareDeterministicSignals = typeof prepareReviewRunnerDeterministicSignals
type PrepareDeterministicSignalStartAttributes =
  typeof deterministicSignalStepStartAttributes
type PrepareTaskPlanning = typeof prepareReviewRunnerTaskPlanning

export type ReviewRunnerPlanningState = {
  readonly analysis: DeterministicSignalExtraction
  readonly evidence: readonly EvidenceRecord[]
  readonly reviewTasks: readonly ReviewTask[]
  readonly supportSignalCandidates: readonly CandidateFinding[]
  readonly deterministicSignals: ReviewRunnerDeterministicSignalState
  readonly taskPlanning: ReviewRunnerTaskPlanningResult
}

export const prepareReviewRunnerPlanningState = (input: {
  readonly config: CodeReviewerConfig
  readonly files: readonly { readonly path: string }[]
  readonly sourceFiles: readonly SupportSignalSourceFile[]
  readonly observability: NoContentEventRecorder
  readonly logger: Logger
  readonly prepareDeterministicSignalStartAttributes?: PrepareDeterministicSignalStartAttributes
  readonly prepareDeterministicSignals?: PrepareDeterministicSignals
  readonly prepareTaskPlanning?: PrepareTaskPlanning
}): ReviewRunnerPlanningState => {
  const prepareDeterministicSignalStartAttributes =
    input.prepareDeterministicSignalStartAttributes ??
    deterministicSignalStepStartAttributes
  const prepareDeterministicSignals =
    input.prepareDeterministicSignals ?? prepareReviewRunnerDeterministicSignals
  const prepareTaskPlanning =
    input.prepareTaskPlanning ?? prepareReviewRunnerTaskPlanning

  const analysisStep = input.observability.startStep(
    'deterministic_signals',
    prepareDeterministicSignalStartAttributes(input.sourceFiles)
  )
  input.logger.debug('Deterministic support signal extraction started.', {
    file_count: input.sourceFiles.length
  })
  const deterministicSignals = prepareDeterministicSignals(input.sourceFiles)
  const { analysis, evidence } = deterministicSignals
  analysisStep.end(deterministicSignals.metrics)
  input.logger.debug('Deterministic support signal extraction completed.', {
    fact_count: analysis.facts.length,
    evidence_count: evidence.length
  })

  const planningStep = input.observability.startStep('task_planning')
  input.logger.debug('Task planning started.')
  const planningInput: ReviewRunnerTaskPlanningInput = {
    depth: input.config.review.depth,
    files: input.files,
    facts: analysis.facts,
    evidence
  }
  const taskPlanning = prepareTaskPlanning(planningInput)
  planningStep.end({ taskCount: taskPlanning.metrics.taskCount })
  input.logger.debug('Task planning completed.', {
    task_count: taskPlanning.metrics.taskCount,
    support_signal_candidate_count:
      taskPlanning.metrics.supportSignalCandidateCount
  })

  return {
    analysis,
    evidence,
    reviewTasks: taskPlanning.reviewTasks,
    supportSignalCandidates: taskPlanning.supportSignalCandidates,
    deterministicSignals,
    taskPlanning
  }
}
