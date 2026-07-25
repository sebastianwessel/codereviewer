import { type CandidateFinding } from '../../../admission/index.js'
import { type EvidenceRecord } from '../../../../shared/contracts/index.js'
import {
  FindingRefutationBatchInputSchema,
  type FindingRefutationBatchInput,
  type WorkflowReviewTask
} from '../agent-contracts.js'
import {
  createTaskPacketBudgetExceededError,
  serializedBytes
} from '../packet-budget.js'
import { type ReviewWorkflowInput } from '../contracts.js'

export type FindingRefutationPacket = {
  readonly input: FindingRefutationBatchInput
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

// A deterministic support signal corroborates a model candidate when it sits at an
// overlapping location in the same file or cites the same evidence.
const supportSignalCandidateSupports = (
  candidate: CandidateFinding,
  supportCandidate: CandidateFinding
): boolean =>
  supportCandidate.proposedBy !== 'review-agent' &&
  supportCandidate.location.path === candidate.location.path &&
  (candidateLocationsOverlap(candidate, supportCandidate) ||
    candidatesShareEvidence(candidate, supportCandidate))

const createFindingRefutationBatchInput = (
  input: {
    readonly workflowInput: ReviewWorkflowInput
    readonly task: WorkflowReviewTask | undefined
    readonly candidates: readonly CandidateFinding[]
    readonly allCandidates: readonly CandidateFinding[]
    readonly sharedDigest: string
    readonly reviewEvidence?: readonly EvidenceRecord[]
  }
): FindingRefutationBatchInput => {
  const candidatePaths = new Set(
    input.candidates.map((candidate) => candidate.location.path)
  )
  const candidateEvidenceIds = new Set(
    input.candidates.flatMap((candidate) => candidate.evidenceIds)
  )
  const reviewEvidence = input.reviewEvidence ?? input.workflowInput.evidence
  // The batch shares the originating task's context; without a task (a candidate
  // supplied on the workflow input) fall back to the workflow context for the paths
  // the batch actually covers.
  const reviewContext =
    input.task !== undefined && input.task.reviewContext.length > 0
      ? input.task.reviewContext
      : (input.workflowInput.reviewContext ?? []).filter(
          (context) =>
            context.path === undefined || candidatePaths.has(context.path)
        )

  return FindingRefutationBatchInputSchema.parse({
    runId: input.workflowInput.runId,
    provenance: input.workflowInput.provenance,
    instructions: input.workflowInput.instructions,
    skills: input.workflowInput.skills,
    sharedDigest: input.sharedDigest,
    reviewContext,
    reviewedDiffRanges: (input.workflowInput.reviewedDiffRanges ?? []).filter(
      (range) => candidatePaths.has(range.path)
    ),
    evidence: reviewEvidence.filter((evidence) =>
      candidateEvidenceIds.has(evidence.id)
    ),
    supportSignalCandidates: input.allCandidates.filter((supportCandidate) =>
      input.candidates.some((candidate) =>
        supportSignalCandidateSupports(candidate, supportCandidate)
      )
    ),
    candidates: input.candidates
  })
}

// Shed the least load-bearing context first when a batch packet exceeds the
// provider input budget: the shared digest, then deterministic support signals,
// then the review context. A batch that still does not fit is reported so the
// caller can split it into smaller batches rather than losing the candidates.
const fitFindingRefutationBatchInputToBudget = (
  refutationInput: FindingRefutationBatchInput,
  maxTaskInputBytes: number | undefined
): FindingRefutationBatchInput => {
  if (maxTaskInputBytes === undefined) {
    return refutationInput
  }

  const currentBytes = serializedBytes(refutationInput)

  if (currentBytes <= maxTaskInputBytes) {
    return refutationInput
  }

  const withoutSharedDigest = FindingRefutationBatchInputSchema.parse({
    ...refutationInput,
    sharedDigest: '(shared digest omitted for refutation packet budget)'
  })

  if (serializedBytes(withoutSharedDigest) <= maxTaskInputBytes) {
    return withoutSharedDigest
  }

  const withoutSupportSignals = FindingRefutationBatchInputSchema.parse({
    ...withoutSharedDigest,
    supportSignalCandidates: []
  })

  if (serializedBytes(withoutSupportSignals) <= maxTaskInputBytes) {
    return withoutSupportSignals
  }

  const withoutReviewContext = FindingRefutationBatchInputSchema.parse({
    ...withoutSupportSignals,
    reviewContext: []
  })

  if (serializedBytes(withoutReviewContext) <= maxTaskInputBytes) {
    return withoutReviewContext
  }

  throw createTaskPacketBudgetExceededError({
    taskId: refutationInput.candidates[0]?.taskId ?? 'unknown-task',
    maxTaskInputBytes,
    serializedBytes: currentBytes
  })
}

export const findingRefutationBatchInput = (
  input: {
    readonly workflowInput: ReviewWorkflowInput
    readonly task: WorkflowReviewTask | undefined
    readonly candidates: readonly CandidateFinding[]
    readonly allCandidates: readonly CandidateFinding[]
    readonly sharedDigest: string
    readonly reviewEvidence?: readonly EvidenceRecord[]
  }
): FindingRefutationPacket => ({
  input: fitFindingRefutationBatchInputToBudget(
    createFindingRefutationBatchInput(input),
    input.workflowInput.maxTaskInputBytes
  )
})
