import {
  type EvidenceRecord,
  type ProofPacket,
  type RefutationResult,
  type ReviewIntent
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { type ContextRetriever } from '../context-retrieval/index.js'
import { type ContextRequestArtifactCache } from './model-context-artifacts.js'
import { reviewCandidateWithJudge } from './model-judge-review.js'
import {
  type FindingJudgeRunner,
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
import { admissionOutcomeForJudgeReview } from './model-admission-judge-outcome.js'
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
    readonly reviewIntents: readonly ReviewIntent[]
    readonly proofPackets: readonly ProofPacket[]
    readonly refutationResults: readonly RefutationResult[]
    readonly refuteFinding?: FindingRefutationRunner | undefined
    readonly judgeFinding?: FindingJudgeRunner | undefined
    readonly skipJudgeCandidateIds?: ReadonlySet<string> | undefined
    readonly contextRetriever?: ContextRetriever | undefined
    readonly judgeContextArtifactCache?: ContextRequestArtifactCache | undefined
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

  const artifactOnlyCandidateIds =
    refutation.verdict === 'needs-more-evidence' ? [input.candidate.id] : []

  if (refutation.verdict === 'needs-more-evidence') {
    return admissibleRefutationOutcome({
      candidate: input.candidate,
      refutation,
      refutationEvidence,
      ...(refutationResult === undefined ? {} : { refutationResult })
    })
  }

  // The judge is a strict critic OF A PROOF PACKET. Holistic-discovery
  // candidates are verified by refutation directly from reviewContext and carry
  // no proof packet, so a judge pass has nothing to critique and rejects them
  // wholesale. Only run the judge when the candidate actually has a proof packet
  // (suspicion-mode candidates); otherwise the refutation verdict stands.
  const candidateHasProofPacket = input.proofPackets.some(
    (packet) => packet.candidateId === input.candidate.id
  )

  if (
    input.workflowInput.judgeFindings &&
    input.judgeFinding !== undefined &&
    refutation.verdict === 'proved' &&
    candidateHasProofPacket &&
    !input.skipJudgeCandidateIds?.has(input.candidate.id)
  ) {
    const judgeOutcome = await reviewCandidateWithJudge({
      workflowInput: input.workflowInput,
      tasks: input.tasks,
      candidate: input.candidate,
      sharedDigest: input.sharedDigest,
      evidence: [...input.reviewEvidence, refutationEvidence],
      reviewIntents: input.reviewIntents,
      proofPackets: input.proofPackets,
      refutationResults: input.refutationResults,
      refutationEvidence,
      judgeFinding: input.judgeFinding,
      providerIssueForError,
      ...(input.judgeContextArtifactCache === undefined
        ? {}
        : { contextArtifactCache: input.judgeContextArtifactCache }),
      ...(input.contextRetriever === undefined
        ? {}
        : { contextRetriever: input.contextRetriever }),
      ...(input.signal === undefined ? {} : { signal: input.signal })
    })

    return admissionOutcomeForJudgeReview({
      candidate: input.candidate,
      refutation,
      refutationEvidence,
      ...(refutationResult === undefined ? {} : { refutationResult }),
      artifactOnlyCandidateIds,
      judgeOutcome
    })
  }

  return admissibleRefutationOutcome({
    candidate: input.candidate,
    refutation,
    refutationEvidence,
    ...(refutationResult === undefined ? {} : { refutationResult })
  })
}
