import {
  type EvidenceRecord,
  type ProofPacket,
  type RefutationResult
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import {
  type FindingRefutationResult,
  type FindingRefutationRunner,
  type WorkflowReviewTask
} from './model-agent-contracts.js'
import {
  refutationProviderErrorOutcome,
  type RefutationProviderErrorStage
} from './model-admission-provider-error-outcome.js'
import { type AdmissionCandidateOutcome } from './model-admission-outcome.js'
import {
  proofLoopRefutationFor,
  proofPacketForCandidate,
  refutationResultFromProofLoop
} from './model-admission-refutation-reuse.js'
import { findingRefutationInputForCandidate } from './model-refutation-packet.js'
import {
  providerIssueForError,
  type ProviderIssueForError
} from './model-provider-issues.js'
import { type ReviewWorkflowInput } from './workflow-contracts.js'

export type AdmissionRefutationExecutionResult =
  | {
      readonly status: 'completed'
      readonly refutation: FindingRefutationResult
    }
  | {
      readonly status: 'provider-error'
      readonly outcome: AdmissionCandidateOutcome
    }

export const executeAdmissionRefutation = async (
  input: {
    readonly workflowInput: ReviewWorkflowInput
    readonly tasks: readonly WorkflowReviewTask[]
    readonly candidate: CandidateFinding
    readonly allCandidates: readonly CandidateFinding[]
    readonly sharedDigest: string
    readonly reviewEvidence: readonly EvidenceRecord[]
    readonly proofPackets: readonly ProofPacket[]
    readonly refutationResults: readonly RefutationResult[]
    readonly refuteFinding: FindingRefutationRunner
    readonly issueForError?: ProviderIssueForError
    readonly signal?: AbortSignal
  }
): Promise<AdmissionRefutationExecutionResult> => {
  const providerErrorOutcome = (
    error: unknown,
    stage: RefutationProviderErrorStage
  ): AdmissionRefutationExecutionResult => ({
    status: 'provider-error',
    outcome: refutationProviderErrorOutcome({
      candidate: input.candidate,
      error,
      stage,
      issueForError: input.issueForError ?? providerIssueForError
    })
  })

  const proofPacket = proofPacketForCandidate(
    input.candidate,
    input.proofPackets
  )
  const proofLoopRefutationArtifact = proofLoopRefutationFor(
    proofPacket,
    input.refutationResults
  )
  const proofLoopRefutation = refutationResultFromProofLoop({
    candidate: input.candidate,
    proofPackets: input.proofPackets,
    refutationResults: input.refutationResults
  })

  if (
    proofLoopRefutation !== undefined &&
    proofLoopRefutation.verdict !== 'proved'
  ) {
    return {
      status: 'completed',
      refutation: proofLoopRefutation
    }
  }

  let refutationInput: ReturnType<
    typeof findingRefutationInputForCandidate
  >['input']

  try {
    refutationInput = findingRefutationInputForCandidate({
      workflowInput: input.workflowInput,
      tasks: input.tasks,
      candidate: input.candidate,
      allCandidates: input.allCandidates,
      sharedDigest: input.sharedDigest,
      reviewEvidence: input.reviewEvidence,
      additionalEvidenceIds: [
        ...(proofPacket?.evidenceIds ?? []),
        ...(proofLoopRefutationArtifact?.evidenceIds ?? [])
      ]
    }).input
  } catch (error: unknown) {
    return providerErrorOutcome(error, 'refutation-packet')
  }

  try {
    return {
      status: 'completed',
      refutation: await input.refuteFinding(refutationInput, input.signal)
    }
  } catch (error: unknown) {
    return providerErrorOutcome(error, 'refutation-check')
  }
}
