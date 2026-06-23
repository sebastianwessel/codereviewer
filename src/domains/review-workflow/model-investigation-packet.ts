import {
  type EvidenceRecord
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import {
  FindingInvestigationInputSchema,
  type FindingInvestigationInput,
  type ReviewContextDocument,
  type TaskReviewInput
} from './model-agent-contracts.js'
import {
  createTaskPacketBudgetExceededError,
  serializedBytes
} from './model-packet-budget.js'

export type FindingInvestigationPacket = {
  readonly input: FindingInvestigationInput
}

const defaultProofQuestions = [
  'What changed behavior is introduced or materially exposed by the reviewed diff?',
  'What execution path, data flow, or configuration path makes the behavior reachable?',
  'Which invariant, contract, or security property is violated?',
  'What concrete impact follows if this behavior ships?',
  'What evidence or contradiction would refute the suspicion?'
] as const

const compactProofQuestionsFor = (
  taskInput: TaskReviewInput,
  candidate: CandidateFinding
): readonly string[] => {
  const taskQuestions = taskInput.task.verificationQuestions ?? []
  const intentQuestions = taskInput.reviewIntents.flatMap((intent) =>
    intent.taskIds.includes(candidate.taskId) ||
    intent.paths.includes(candidate.location.path)
      ? intent.verificationQuestions
      : []
  )
  const questions: string[] = []

  for (const question of [
    ...taskQuestions,
    ...intentQuestions,
    ...defaultProofQuestions
  ]) {
    const trimmed = question.trim()
    if (trimmed.length === 0 || questions.includes(trimmed)) {
      continue
    }
    questions.push(trimmed.slice(0, 240))
    if (questions.length >= 8) {
      break
    }
  }

  return questions
}

export const findingInvestigationInputForCandidate = (
  input: {
    readonly taskInput: TaskReviewInput
    readonly candidate: CandidateFinding
    readonly suspicion: FindingInvestigationInput['suspicion']
    readonly contextEvidence: readonly EvidenceRecord[]
    readonly contextReviewContext: readonly ReviewContextDocument[]
    readonly evidenceIds: readonly string[]
    readonly maxTaskInputBytes?: number | undefined
  }
): FindingInvestigationPacket => {
  const evidenceIdSet = new Set(input.evidenceIds)
  const taskEvidence = input.taskInput.evidence.filter((evidence) =>
    evidenceIdSet.has(evidence.id)
  )
  const taskWithoutNestedContext = {
    ...input.taskInput.task,
    reviewContext: []
  }
  const reviewContext =
    input.contextReviewContext.length > 0
      ? input.contextReviewContext
      : input.taskInput.task.reviewContext
  const baseInput = FindingInvestigationInputSchema.parse({
    runId: input.taskInput.runId,
    task: taskWithoutNestedContext,
    candidate: input.candidate,
    suspicion: input.suspicion,
    proofQuestions: compactProofQuestionsFor(input.taskInput, input.candidate),
    reviewedDiffRanges: input.taskInput.reviewedDiffRanges.filter(
      (range) => range.path === input.candidate.location.path
    ),
    evidence: [...taskEvidence, ...input.contextEvidence],
    reviewContext,
    instructions: input.taskInput.instructions,
    skills: input.taskInput.skills,
    sharedDigest: input.taskInput.sharedDigest,
    provenance: input.taskInput.provenance
  })

  return {
    input: fitFindingInvestigationInputToBudget({
      investigationInput: baseInput,
      contextReviewContext: input.contextReviewContext,
      maxTaskInputBytes: input.maxTaskInputBytes
    })
  }
}

const fitFindingInvestigationInputToBudget = (
  input: {
    readonly investigationInput: FindingInvestigationInput
    readonly contextReviewContext: readonly ReviewContextDocument[]
    readonly maxTaskInputBytes?: number | undefined
  }
): FindingInvestigationInput => {
  if (input.maxTaskInputBytes === undefined) {
    return input.investigationInput
  }

  const currentBytes = serializedBytes(input.investigationInput)

  if (currentBytes <= input.maxTaskInputBytes) {
    return input.investigationInput
  }

  const withoutSharedDigest = FindingInvestigationInputSchema.parse({
    ...input.investigationInput,
    sharedDigest: '(shared digest omitted for investigation packet budget)'
  })

  if (serializedBytes(withoutSharedDigest) <= input.maxTaskInputBytes) {
    return withoutSharedDigest
  }

  const withRetrievedContextOnly = FindingInvestigationInputSchema.parse({
    ...withoutSharedDigest,
    reviewContext: input.contextReviewContext
  })

  if (serializedBytes(withRetrievedContextOnly) <= input.maxTaskInputBytes) {
    return withRetrievedContextOnly
  }

  const withoutReviewContext = FindingInvestigationInputSchema.parse({
    ...withoutSharedDigest,
    reviewContext: []
  })

  if (serializedBytes(withoutReviewContext) <= input.maxTaskInputBytes) {
    return withoutReviewContext
  }

  throw createTaskPacketBudgetExceededError({
    taskId: input.investigationInput.task.id,
    maxTaskInputBytes: input.maxTaskInputBytes,
    serializedBytes: currentBytes
  })
}
