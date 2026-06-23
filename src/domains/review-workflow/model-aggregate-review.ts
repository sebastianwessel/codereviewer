import {
  type EvidenceRecord,
  type InvestigationTrace,
  type ProofPacket,
  type RefutationResult,
  type ReviewIntent
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { type FindingAggregateReviewRunner } from './model-agent-contracts.js'
import {
  aggregateReviewOutcomeForResults,
  emptyAggregateReviewOutcome,
  type AggregateReviewOutcome
} from './model-aggregate-outcome.js'
import { runModelAggregateProviderReview } from './model-aggregate-provider-runner.js'
import { type ReviewWorkflowInput } from './workflow-contracts.js'

export const reviewAggregateFindingProofs = async (
  input: {
    readonly workflowInput: ReviewWorkflowInput
    readonly aggregateFindingProofs?: FindingAggregateReviewRunner | undefined
    readonly candidates: readonly CandidateFinding[]
    readonly sharedDigest: string
    readonly reviewIntents: readonly ReviewIntent[]
    readonly proofPackets: readonly ProofPacket[]
    readonly refutationResults: readonly RefutationResult[]
    readonly investigationTraces: readonly InvestigationTrace[]
    readonly evidence: readonly EvidenceRecord[]
    readonly signal?: AbortSignal | undefined
  }
): Promise<AggregateReviewOutcome> => {
  if (
    !input.workflowInput.judgeFindings ||
    input.aggregateFindingProofs === undefined ||
    input.proofPackets.length <= 1
  ) {
    return emptyAggregateReviewOutcome()
  }

  const aggregateReview = await runModelAggregateProviderReview({
    workflowInput: input.workflowInput,
    aggregateFindingProofs: input.aggregateFindingProofs,
    candidates: input.candidates,
    sharedDigest: input.sharedDigest,
    reviewIntents: input.reviewIntents,
    proofPackets: input.proofPackets,
    refutationResults: input.refutationResults,
    investigationTraces: input.investigationTraces,
    evidence: input.evidence,
    signal: input.signal
  })

  return aggregateReviewOutcomeForResults({
    aggregateResults: aggregateReview.aggregateResults,
    providerIssues: aggregateReview.providerIssues
  })
}
