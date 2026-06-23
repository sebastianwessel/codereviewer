import {
  type EvidenceRecord,
  FindingAggregateResultSchema,
  type FindingAggregateResult,
  type InvestigationTrace,
  type ProofPacket,
  type RefutationResult,
  type ReviewIntent
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { sha256 } from '../../shared/hash/hash.js'
import {
  FindingAggregateReviewInputSchema,
  type FindingAggregateReviewInput,
  type FindingAggregateReviewRunner
} from './model-agent-contracts.js'
import { type ReviewWorkflowInput } from './workflow-contracts.js'
import {
  createTaskPacketBudgetExceededError,
  serializedBytes
} from './model-packet-budget.js'

export type FindingAggregatePacket = {
  readonly input: FindingAggregateReviewInput
}

const createFindingAggregateInput = (
  input: {
    readonly workflowInput: ReviewWorkflowInput
    readonly candidates: readonly CandidateFinding[]
    readonly sharedDigest: string
    readonly reviewIntents: readonly ReviewIntent[]
    readonly proofPackets: readonly ProofPacket[]
    readonly refutationResults: readonly RefutationResult[]
    readonly investigationTraces: readonly InvestigationTrace[]
    readonly evidence: readonly EvidenceRecord[]
  }
): FindingAggregateReviewInput => {
  const proofCandidateIds = new Set(
    input.proofPackets.map((packet) => packet.candidateId)
  )
  const proofPacketIds = new Set(input.proofPackets.map((packet) => packet.id))
  const proofSuspicionIds = new Set(
    input.proofPackets.map((packet) => packet.suspicionId)
  )
  const refutationResults = input.refutationResults.filter((result) =>
    proofPacketIds.has(result.proofPacketId)
  )
  const candidates = input.candidates.filter((candidate) =>
    proofCandidateIds.has(candidate.id)
  )
  const candidateTaskIds = new Set(
    candidates.map((candidate) => candidate.taskId)
  )
  const candidatePaths = new Set(
    candidates.map((candidate) => candidate.location.path)
  )
  const evidenceIds = new Set([
    ...input.proofPackets.flatMap((packet) => packet.evidenceIds),
    ...refutationResults.flatMap((result) => result.evidenceIds)
  ])

  return FindingAggregateReviewInputSchema.parse({
    runId: input.workflowInput.runId,
    reviewIntents: input.reviewIntents.filter(
      (intent) =>
        intent.taskIds.some((taskId) => candidateTaskIds.has(taskId)) ||
        intent.paths.some((path) => candidatePaths.has(path))
    ),
    candidates,
    proofPackets: input.proofPackets,
    refutationResults,
    investigationTraces: input.investigationTraces.filter((trace) =>
      proofSuspicionIds.has(trace.suspicionId)
    ),
    evidence: input.evidence.filter((record) => evidenceIds.has(record.id)),
    sharedDigest: input.sharedDigest,
    provenance: input.workflowInput.provenance
  })
}

const fitFindingAggregateInputToBudget = (
  aggregateInput: FindingAggregateReviewInput,
  maxTaskInputBytes: number | undefined
): FindingAggregateReviewInput => {
  if (maxTaskInputBytes === undefined) {
    return aggregateInput
  }

  const currentBytes = serializedBytes(aggregateInput)

  if (currentBytes <= maxTaskInputBytes) {
    return aggregateInput
  }

  const withoutIntents = FindingAggregateReviewInputSchema.parse({
    ...aggregateInput,
    reviewIntents: []
  })

  if (serializedBytes(withoutIntents) <= maxTaskInputBytes) {
    return withoutIntents
  }

  const withoutTraces = FindingAggregateReviewInputSchema.parse({
    ...withoutIntents,
    investigationTraces: []
  })

  if (serializedBytes(withoutTraces) <= maxTaskInputBytes) {
    return withoutTraces
  }

  const withoutSharedDigest = FindingAggregateReviewInputSchema.parse({
    ...withoutTraces,
    sharedDigest: '(shared digest omitted for aggregate packet budget)'
  })

  if (serializedBytes(withoutSharedDigest) <= maxTaskInputBytes) {
    return withoutSharedDigest
  }

  throw createTaskPacketBudgetExceededError({
    taskId: 'task_aggregate',
    maxTaskInputBytes,
    serializedBytes: currentBytes
  })
}

export const findingAggregateInputForProofs = (
  input: {
    readonly workflowInput: ReviewWorkflowInput
    readonly candidates: readonly CandidateFinding[]
    readonly sharedDigest: string
    readonly reviewIntents: readonly ReviewIntent[]
    readonly proofPackets: readonly ProofPacket[]
    readonly refutationResults: readonly RefutationResult[]
    readonly investigationTraces: readonly InvestigationTrace[]
    readonly evidence: readonly EvidenceRecord[]
  }
): FindingAggregatePacket => ({
  input: fitFindingAggregateInputToBudget(
    createFindingAggregateInput(input),
    input.workflowInput.maxTaskInputBytes
  )
})

const aggregateDecisionVerdict = (
  decision: Awaited<ReturnType<FindingAggregateReviewRunner>>['decisions'][number],
  evidenceIds: readonly string[]
): FindingAggregateResult['decisions'][number]['verdict'] =>
  decision.verdict !== 'needs-more-evidence' && evidenceIds.length === 0
    ? 'needs-more-evidence'
    : decision.verdict

const aggregateResultVerdict = (
  output: Awaited<ReturnType<FindingAggregateReviewRunner>>,
  evidenceIds: readonly string[]
): FindingAggregateResult['verdict'] =>
  output.verdict === 'valid' && evidenceIds.length === 0
    ? 'needs-more-evidence'
    : output.verdict

export const findingAggregateResultForModelOutput = (
  input: {
    readonly aggregateInput: FindingAggregateReviewInput
    readonly output: Awaited<ReturnType<FindingAggregateReviewRunner>>
  }
): FindingAggregateResult => {
  const candidateIds = new Set(
    input.aggregateInput.candidates.map((candidate) => candidate.id)
  )
  const availableEvidenceIds = new Set(
    input.aggregateInput.evidence.map((record) => record.id)
  )
  const decisions = input.output.decisions
    .filter((decision) => candidateIds.has(decision.candidateId))
    .map((decision) => {
      const evidenceIds = decision.evidenceIds.filter((evidenceId) =>
        availableEvidenceIds.has(evidenceId)
      )

      return {
        candidateId: decision.candidateId,
        verdict: aggregateDecisionVerdict(decision, evidenceIds),
        summary: decision.summary,
        evidenceIds,
        relatedCandidateIds: decision.relatedCandidateIds.filter((candidateId) =>
          candidateIds.has(candidateId)
        )
      }
    })
  const evidenceIds = input.output.evidenceIds.filter((evidenceId) =>
    availableEvidenceIds.has(evidenceId)
  )
  const checkEvidenceIds = new Set([
    ...evidenceIds,
    ...decisions.flatMap((decision) => decision.evidenceIds)
  ])

  return FindingAggregateResultSchema.parse({
    id: `agg_${sha256(
      `${input.aggregateInput.runId}:${[...candidateIds].join(',')}:${input.output.verdict}:${input.output.summary}`
    ).slice(0, 16)}`,
    scope: 'run',
    verdict: aggregateResultVerdict(input.output, evidenceIds),
    summary: input.output.summary,
    candidateIds: [...candidateIds],
    evidenceIds,
    decisions,
    similarIssueChecks: input.output.similarIssueChecks.map((check) => ({
      ...check,
      evidenceIds: check.evidenceIds.filter((evidenceId) =>
        checkEvidenceIds.has(evidenceId)
      )
    }))
  })
}
