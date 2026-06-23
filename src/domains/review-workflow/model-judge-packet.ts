import {
  type EvidenceRecord,
  type ProofPacket,
  type RefutationResult,
  type ReviewIntent
} from '../../shared/contracts/index.js'
import {
  type CandidateFinding,
  type ReviewedDiffRange
} from '../admission/index.js'
import {
  FindingJudgeInputSchema,
  type FindingJudgeInput,
  type ReviewContextDocument,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import { type ReviewWorkflowInput } from './workflow-contracts.js'
import {
  createTaskPacketBudgetExceededError,
  serializedBytes
} from './model-packet-budget.js'

export type FindingJudgePacket = {
  readonly input: FindingJudgeInput
}

const reviewContextForCandidate = (
  input: {
    readonly workflowInput: ReviewWorkflowInput
    readonly tasks: readonly WorkflowReviewTask[]
    readonly candidate: CandidateFinding
  }
): readonly ReviewContextDocument[] => {
  const candidatePath = input.candidate.location.path
  const originatingTask = input.tasks.find(
    (task) => task.id === input.candidate.taskId
  )

  return originatingTask !== undefined && originatingTask.reviewContext.length > 0
    ? originatingTask.reviewContext
    : (input.workflowInput.reviewContext ?? []).filter(
        (context) => context.path === undefined || context.path === candidatePath
      )
}

const createFindingJudgeInput = (
  input: {
    readonly workflowInput: ReviewWorkflowInput
    readonly tasks: readonly WorkflowReviewTask[]
    readonly candidate: CandidateFinding
    readonly sharedDigest: string
    readonly evidence: readonly EvidenceRecord[]
    readonly reviewIntents: readonly ReviewIntent[]
    readonly proofPackets: readonly ProofPacket[]
    readonly refutationResults: readonly RefutationResult[]
    readonly reviewContext: readonly ReviewContextDocument[]
    readonly additionalEvidenceIds: readonly string[]
  }
): FindingJudgeInput => {
  const candidatePath = input.candidate.location.path
  const candidateEvidenceIds = new Set(input.candidate.evidenceIds)
  const proofPackets = input.proofPackets.filter(
    (proofPacket) => proofPacket.candidateId === input.candidate.id
  )
  const proofPacketIds = new Set(proofPackets.map((proofPacket) => proofPacket.id))
  const refutationResults = input.refutationResults.filter((refutation) =>
    proofPacketIds.has(refutation.proofPacketId)
  )
  const supportingEvidenceIds = new Set([
    ...candidateEvidenceIds,
    ...proofPackets.flatMap((proofPacket) => proofPacket.evidenceIds),
    ...refutationResults.flatMap((refutation) => refutation.evidenceIds),
    ...input.additionalEvidenceIds
  ])

  return FindingJudgeInputSchema.parse({
    runId: input.workflowInput.runId,
    candidate: input.candidate,
    reviewedDiffRanges: (input.workflowInput.reviewedDiffRanges ?? []).filter(
      (range: ReviewedDiffRange) => range.path === candidatePath
    ),
    evidence: input.evidence.filter((evidence) =>
      supportingEvidenceIds.has(evidence.id)
    ),
    reviewContext: input.reviewContext,
    reviewIntents: input.reviewIntents.filter(
      (intent) =>
        intent.taskIds.includes(input.candidate.taskId) ||
        intent.paths.includes(candidatePath)
    ),
    proofPackets,
    refutationResults,
    instructions: input.workflowInput.instructions,
    skills: input.workflowInput.skills,
    sharedDigest: input.sharedDigest,
    provenance: input.workflowInput.provenance
  })
}

const fitFindingJudgeInputToBudget = (
  input: {
    readonly judgeInput: FindingJudgeInput
    readonly candidate: CandidateFinding
    readonly additionalReviewContext: readonly ReviewContextDocument[]
    readonly maxTaskInputBytes: number | undefined
  }
): FindingJudgeInput => {
  if (input.maxTaskInputBytes === undefined) {
    return input.judgeInput
  }

  const currentBytes = serializedBytes(input.judgeInput)

  if (currentBytes <= input.maxTaskInputBytes) {
    return input.judgeInput
  }

  const withoutIntents = FindingJudgeInputSchema.parse({
    ...input.judgeInput,
    reviewIntents: []
  })

  if (serializedBytes(withoutIntents) <= input.maxTaskInputBytes) {
    return withoutIntents
  }

  const withoutSharedDigest = FindingJudgeInputSchema.parse({
    ...withoutIntents,
    sharedDigest: '(shared digest omitted for judge packet budget)'
  })

  if (serializedBytes(withoutSharedDigest) <= input.maxTaskInputBytes) {
    return withoutSharedDigest
  }

  const withFollowUpContextOnly = FindingJudgeInputSchema.parse({
    ...withoutSharedDigest,
    reviewContext: input.additionalReviewContext
  })

  if (serializedBytes(withFollowUpContextOnly) <= input.maxTaskInputBytes) {
    return withFollowUpContextOnly
  }

  const withoutReviewContext = FindingJudgeInputSchema.parse({
    ...withoutSharedDigest,
    reviewContext: []
  })

  if (serializedBytes(withoutReviewContext) <= input.maxTaskInputBytes) {
    return withoutReviewContext
  }

  throw createTaskPacketBudgetExceededError({
    taskId: input.candidate.taskId,
    maxTaskInputBytes: input.maxTaskInputBytes,
    serializedBytes: currentBytes
  })
}

export const findingJudgeInputForCandidate = (
  input: {
    readonly workflowInput: ReviewWorkflowInput
    readonly tasks: readonly WorkflowReviewTask[]
    readonly candidate: CandidateFinding
    readonly sharedDigest: string
    readonly evidence: readonly EvidenceRecord[]
    readonly reviewIntents: readonly ReviewIntent[]
    readonly proofPackets: readonly ProofPacket[]
    readonly refutationResults: readonly RefutationResult[]
    readonly additionalEvidenceIds?: readonly string[]
    readonly additionalReviewContext?: readonly ReviewContextDocument[]
  }
): FindingJudgePacket => {
  const additionalReviewContext = input.additionalReviewContext ?? []
  const judgeInput = createFindingJudgeInput({
    ...input,
    reviewContext: [
      ...reviewContextForCandidate(input),
      ...additionalReviewContext
    ],
    additionalEvidenceIds: input.additionalEvidenceIds ?? []
  })

  return {
    input: fitFindingJudgeInputToBudget({
      judgeInput,
      candidate: input.candidate,
      additionalReviewContext,
      maxTaskInputBytes: input.workflowInput.maxTaskInputBytes
    })
  }
}
