import {
  type EvidenceRecord,
  type FindingAggregateResult,
  type InvestigationTrace,
  type ProofPacket,
  type RefutationResult,
  type ReviewIntent
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { type FindingAggregateReviewRunner } from './model-agent-contracts.js'
import {
  findingAggregateInputForProofs,
  findingAggregateResultForModelOutput
} from './model-aggregate-packet.js'
import {
  providerIssueForError,
  type ProviderIssue
} from './model-provider-issues.js'
import { type ReviewWorkflowInput } from './workflow-contracts.js'

export type ModelAggregateProviderReviewResult = {
  readonly aggregateResults: readonly FindingAggregateResult[]
  readonly providerIssues: readonly ProviderIssue[]
}

export const runModelAggregateProviderReview = async (input: {
  readonly workflowInput: ReviewWorkflowInput
  readonly aggregateFindingProofs: FindingAggregateReviewRunner
  readonly candidates: readonly CandidateFinding[]
  readonly sharedDigest: string
  readonly reviewIntents: readonly ReviewIntent[]
  readonly proofPackets: readonly ProofPacket[]
  readonly refutationResults: readonly RefutationResult[]
  readonly investigationTraces: readonly InvestigationTrace[]
  readonly evidence: readonly EvidenceRecord[]
  readonly signal?: AbortSignal | undefined
}): Promise<ModelAggregateProviderReviewResult> => {
  const providerIssues: ProviderIssue[] = []
  const aggregateInput = (() => {
    try {
      return findingAggregateInputForProofs({
        workflowInput: input.workflowInput,
        candidates: input.candidates,
        sharedDigest: input.sharedDigest,
        reviewIntents: input.reviewIntents,
        proofPackets: input.proofPackets,
        refutationResults: input.refutationResults,
        investigationTraces: input.investigationTraces,
        evidence: input.evidence
      }).input
    } catch (error: unknown) {
      providerIssues.push(
        providerIssueForError({
          error,
          stage: 'aggregate-packet',
          recovered: true
        })
      )

      return undefined
    }
  })()

  if (aggregateInput === undefined) {
    return {
      aggregateResults: [],
      providerIssues
    }
  }

  const aggregateResults = await input
    .aggregateFindingProofs(aggregateInput, input.signal)
    .then((output) => [
      findingAggregateResultForModelOutput({
        aggregateInput,
        output
      })
    ])
    .catch((error: unknown) => {
      providerIssues.push(
        providerIssueForError({
          error,
          stage: 'aggregate-proof-review',
          recovered: true
        })
      )

      return []
    })

  return {
    aggregateResults,
    providerIssues
  }
}
