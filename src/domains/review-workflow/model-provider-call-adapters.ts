import {
  normalizeFindingRefutationResult,
  type FindingAggregateReviewInput,
  type FindingAggregateReviewOutput,
  type FindingJudgeInput,
  type FindingJudgeOutput,
  type FindingRefutationInput,
  type FindingRefutationResult,
  type IntentPlanningInput,
  type ModelReviewIntentPlan,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import { type ReviewIntent } from '../../shared/contracts/index.js'
import { normalizeModelReviewIntentPlan } from './workflow-task-planning.js'

type ProviderCallLogger = {
  readonly debug: (
    message: string,
    metadata?: Readonly<Record<string, unknown>>
  ) => void
}

export const runIntentPlanningProviderCall = async (
  input: {
    readonly planningInput: IntentPlanningInput
    readonly tasks: readonly WorkflowReviewTask[]
    readonly planReviewIntents: (
      input: IntentPlanningInput,
      signal: AbortSignal | undefined
    ) => Promise<ModelReviewIntentPlan>
    readonly logger: ProviderCallLogger
    readonly signal?: AbortSignal | undefined
  }
): Promise<readonly ReviewIntent[]> => {
  input.logger.debug('Intent planning provider call started.', {
    task_count: input.planningInput.tasks.length,
    reviewed_path_count: input.planningInput.reviewedPaths.length
  })
  const plan = await input.planReviewIntents(
    input.planningInput,
    input.signal
  )
  const intents = normalizeModelReviewIntentPlan(input.tasks, plan)

  input.logger.debug('Intent planning provider call completed.', {
    intent_count: intents.length
  })

  return intents
}

export const runRefutationProviderCall = async (
  input: {
    readonly refutationInput: FindingRefutationInput
    readonly refuteFinding: (
      input: FindingRefutationInput,
      signal: AbortSignal | undefined
    ) => Promise<FindingRefutationResult>
    readonly logger: ProviderCallLogger
    readonly signal?: AbortSignal | undefined
  }
): Promise<FindingRefutationResult> => {
  input.logger.debug('Refutation check provider call started.', {
    candidate_id: input.refutationInput.candidate.id,
    path: input.refutationInput.candidate.location.path,
    evidence_count: input.refutationInput.evidence.length,
    context_count: input.refutationInput.reviewContext.length
  })
  const refutation = await input.refuteFinding(
    input.refutationInput,
    input.signal
  )
  const normalizedRefutation = normalizeFindingRefutationResult(refutation)

  input.logger.debug('Refutation check provider call completed.', {
    candidate_id: input.refutationInput.candidate.id,
    verdict: normalizedRefutation.verdict
  })

  return normalizedRefutation
}

export const runAggregateProofReviewProviderCall = async (
  input: {
    readonly aggregateInput: FindingAggregateReviewInput
    readonly aggregateFindingProofs: (
      input: FindingAggregateReviewInput,
      signal: AbortSignal | undefined
    ) => Promise<FindingAggregateReviewOutput>
    readonly logger: ProviderCallLogger
    readonly signal?: AbortSignal | undefined
  }
): Promise<FindingAggregateReviewOutput> => {
  input.logger.debug('Aggregate proof review provider call started.', {
    candidate_count: input.aggregateInput.candidates.length,
    proof_packet_count: input.aggregateInput.proofPackets.length,
    evidence_count: input.aggregateInput.evidence.length
  })
  const aggregateResult = await input.aggregateFindingProofs(
    input.aggregateInput,
    input.signal
  )

  input.logger.debug('Aggregate proof review provider call completed.', {
    candidate_count: input.aggregateInput.candidates.length,
    verdict: aggregateResult.verdict,
    decision_count: aggregateResult.decisions.length
  })

  return aggregateResult
}

export const runJudgeProviderCall = async (
  input: {
    readonly judgeInput: FindingJudgeInput
    readonly judgeFinding: (
      input: FindingJudgeInput,
      signal: AbortSignal | undefined
    ) => Promise<FindingJudgeOutput>
    readonly logger: ProviderCallLogger
    readonly signal?: AbortSignal | undefined
  }
): Promise<FindingJudgeOutput> => {
  input.logger.debug('Judge check provider call started.', {
    candidate_id: input.judgeInput.candidate.id,
    path: input.judgeInput.candidate.location.path,
    evidence_count: input.judgeInput.evidence.length,
    context_count: input.judgeInput.reviewContext.length,
    intent_count: input.judgeInput.reviewIntents.length
  })
  const judgeResult = await input.judgeFinding(
    input.judgeInput,
    input.signal
  )

  input.logger.debug('Judge check provider call completed.', {
    candidate_id: input.judgeInput.candidate.id,
    verdict: judgeResult.verdict
  })

  return judgeResult
}

export type { ProviderCallLogger }
