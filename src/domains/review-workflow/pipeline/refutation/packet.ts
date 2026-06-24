import { type CandidateFinding } from '../../../admission/index.js'
import { type EvidenceRecord } from '../../../../shared/contracts/index.js'
import {
  FindingRefutationInputSchema,
  type FindingRefutationInput,
  type WorkflowReviewTask
} from '../agent-contracts.js'
import {
  createTaskPacketBudgetExceededError,
  serializedBytes
} from '../packet-budget.js'
import { type ReviewWorkflowInput } from '../contracts.js'

export type FindingRefutationPacket = {
  readonly input: FindingRefutationInput
}

const locationEndLine = (candidate: CandidateFinding): number =>
  candidate.location.endLine ?? candidate.location.startLine

const candidateLocationsOverlap = (
  left: CandidateFinding,
  right: CandidateFinding
): boolean =>
  left.location.path === right.location.path &&
  left.location.startLine <= locationEndLine(right) &&
  right.location.startLine <= locationEndLine(left)

const candidatesShareEvidence = (
  left: CandidateFinding,
  right: CandidateFinding
): boolean => {
  const leftEvidenceIds = new Set(left.evidenceIds)

  return right.evidenceIds.some((evidenceId) => leftEvidenceIds.has(evidenceId))
}

const supportSignalCandidateSupports = (
  candidate: CandidateFinding,
  supportCandidate: CandidateFinding
): boolean =>
  supportCandidate.proposedBy !== 'review-agent' &&
  supportCandidate.location.path === candidate.location.path &&
  (candidateLocationsOverlap(candidate, supportCandidate) ||
    candidatesShareEvidence(candidate, supportCandidate))

const createFindingRefutationInput = (
  input: {
    readonly workflowInput: ReviewWorkflowInput
    readonly tasks: readonly WorkflowReviewTask[]
    readonly candidate: CandidateFinding
    readonly allCandidates: readonly CandidateFinding[]
    readonly sharedDigest: string
    readonly reviewEvidence?: readonly EvidenceRecord[]
    readonly additionalEvidenceIds?: readonly string[]
  }
): FindingRefutationInput => {
  const candidateEvidenceIds = new Set([
    ...input.candidate.evidenceIds,
    ...(input.additionalEvidenceIds ?? [])
  ])
  const candidatePath = input.candidate.location.path
  const reviewEvidence = input.reviewEvidence ?? input.workflowInput.evidence
  const originatingTask = input.tasks.find(
    (task) => task.id === input.candidate.taskId
  )
  const reviewContext =
    originatingTask !== undefined && originatingTask.reviewContext.length > 0
      ? originatingTask.reviewContext
      : (input.workflowInput.reviewContext ?? []).filter(
          (context) => context.path === undefined || context.path === candidatePath
        )

  // Construct in the same order as FindingRefutationInputSchema so the serialized
  // packet keeps the task-shared fields (the cacheable prefix) before the
  // per-candidate fields; `candidate` is last.
  return FindingRefutationInputSchema.parse({
    runId: input.workflowInput.runId,
    reviewContext,
    instructions: input.workflowInput.instructions,
    skills: input.workflowInput.skills,
    provenance: input.workflowInput.provenance,
    sharedDigest: input.sharedDigest,
    reviewedDiffRanges: (input.workflowInput.reviewedDiffRanges ?? []).filter(
      (range) => range.path === candidatePath
    ),
    evidence: reviewEvidence.filter((evidence) =>
      candidateEvidenceIds.has(evidence.id)
    ),
    supportSignalCandidates: input.allCandidates.filter(
      (supportCandidate) =>
        supportSignalCandidateSupports(input.candidate, supportCandidate)
    ),
    candidate: input.candidate
  })
}

const fitFindingRefutationInputToBudget = (
  refutationInput: FindingRefutationInput,
  maxTaskInputBytes: number | undefined
): FindingRefutationInput => {
  if (maxTaskInputBytes === undefined) {
    return refutationInput
  }

  const currentBytes = serializedBytes(refutationInput)

  if (currentBytes <= maxTaskInputBytes) {
    return refutationInput
  }

  const withoutSharedDigest = FindingRefutationInputSchema.parse({
    ...refutationInput,
    sharedDigest: '(shared digest omitted for refutation packet budget)'
  })

  if (serializedBytes(withoutSharedDigest) <= maxTaskInputBytes) {
    return withoutSharedDigest
  }

  const withoutSupportSignals = FindingRefutationInputSchema.parse({
    ...withoutSharedDigest,
    supportSignalCandidates: []
  })

  if (serializedBytes(withoutSupportSignals) <= maxTaskInputBytes) {
    return withoutSupportSignals
  }

  const withoutReviewContext = FindingRefutationInputSchema.parse({
    ...withoutSupportSignals,
    reviewContext: []
  })

  if (serializedBytes(withoutReviewContext) <= maxTaskInputBytes) {
    return withoutReviewContext
  }

  throw createTaskPacketBudgetExceededError({
    taskId: refutationInput.candidate.taskId,
    maxTaskInputBytes,
    serializedBytes: currentBytes
  })
}

export const findingRefutationInputForCandidate = (
  input: {
    readonly workflowInput: ReviewWorkflowInput
    readonly tasks: readonly WorkflowReviewTask[]
    readonly candidate: CandidateFinding
    readonly allCandidates: readonly CandidateFinding[]
    readonly sharedDigest: string
    readonly reviewEvidence?: readonly EvidenceRecord[]
    readonly additionalEvidenceIds?: readonly string[]
  }
): FindingRefutationPacket => ({
  input: fitFindingRefutationInputToBudget(
    createFindingRefutationInput(input),
    input.workflowInput.maxTaskInputBytes
  )
})
