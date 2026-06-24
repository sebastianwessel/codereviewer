import {
  type EvidenceRecord,
  type ProofPacket,
  type RefutationResult
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import {
  type FindingRefutationRunner,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import {
  candidateWithinReviewedScope,
  isModelProposedCandidate
} from './model-admission-candidate-scope.js'
import { createRefutationEvidence } from './model-admission-refutation-evidence.js'
import { executeAdmissionRefutation } from './model-admission-refutation-execution.js'
import { activeRefutationResultForCandidate } from './model-admission-refutation-result.js'
import { type AdmissionCandidateOutcome } from './model-admission-outcome.js'
import {
  noRefuterAdmissionOutcome,
  outOfDiffScopeOutcome,
  supportSignalCandidateOutcome
} from './model-admission-preflight-outcome.js'
import {
  admissibleRefutationOutcome,
  refutedCandidateOutcome,
  weakSuspicionRejectedOutcome
} from './model-admission-refutation-verdict-outcome.js'
import { providerIssueForError } from './model-provider-issues.js'
import { type ReviewWorkflowInput } from './workflow-contracts.js'

export const reviewCandidateForAdmission = async (
  input: {
    readonly workflowInput: ReviewWorkflowInput
    readonly tasks: readonly WorkflowReviewTask[]
    readonly candidate: CandidateFinding
    readonly allCandidates: readonly CandidateFinding[]
    readonly sharedDigest: string
    readonly reviewEvidence: readonly EvidenceRecord[]
    readonly proofPackets: readonly ProofPacket[]
    readonly refutationResults: readonly RefutationResult[]
    readonly refuteFinding?: FindingRefutationRunner | undefined
    readonly signal?: AbortSignal
  }
): Promise<AdmissionCandidateOutcome> => {
  if (input.refuteFinding === undefined) {
    return noRefuterAdmissionOutcome({
      candidates: [input.candidate],
      workflowEvidence: input.workflowInput.evidence
    })
  }

  if (!isModelProposedCandidate(input.candidate)) {
    return supportSignalCandidateOutcome(input.candidate)
  }

  if (
    !candidateWithinReviewedScope(
      input.candidate,
      input.workflowInput.reviewedDiffRanges
    )
  ) {
    return outOfDiffScopeOutcome(input.candidate)
  }

  const refutationExecution = await executeAdmissionRefutation({
    workflowInput: input.workflowInput,
    tasks: input.tasks,
    candidate: input.candidate,
    allCandidates: input.allCandidates,
    sharedDigest: input.sharedDigest,
    reviewEvidence: input.reviewEvidence,
    proofPackets: input.proofPackets,
    refutationResults: input.refutationResults,
    refuteFinding: input.refuteFinding,
    issueForError: providerIssueForError,
    ...(input.signal === undefined ? {} : { signal: input.signal })
  })

  if (refutationExecution.status === 'provider-error') {
    return refutationExecution.outcome
  }

  const refutation = refutationExecution.refutation
  const refutationEvidence = createRefutationEvidence({
    candidate: input.candidate,
    refutation
  })
  const refutationResult = activeRefutationResultForCandidate({
    candidate: input.candidate,
    proofPackets: input.proofPackets,
    refutation,
    refutationEvidence
  })

  if (refutation.verdict === 'refuted') {
    return refutedCandidateOutcome({
      candidate: input.candidate,
      refutation,
      refutationEvidence,
      ...(refutationResult === undefined ? {} : { refutationResult })
    })
  }

  if (
    refutation.verdict === 'needs-more-evidence' &&
    input.workflowInput.promotionPolicy.modelWeakOrRefuted === 'rejected'
  ) {
    return weakSuspicionRejectedOutcome({
      candidate: input.candidate,
      refutation,
      refutationEvidence,
      ...(refutationResult === undefined ? {} : { refutationResult })
    })
  }

  // A candidate that passes refutation (`proved`) is admitted directly;
  // `needs-more-evidence` is admitted as artifact-only (see
  // admissibleRefutationOutcome); `refuted` was already rejected above.
  return admissibleRefutationOutcome({
    candidate: input.candidate,
    refutation,
    refutationEvidence,
    ...(refutationResult === undefined ? {} : { refutationResult })
  })
}
