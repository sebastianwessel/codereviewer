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
import { reviewCandidateForAdmission } from './model-admission-candidate-review.js'
import { noRefuterAdmissionOutcome } from './model-admission-preflight-outcome.js'
import { mapWithBoundedConcurrencyInOrder } from './workflow-ordered-bounded-map.js'
import {
  mergeAdmissionCandidateOutcomes,
  type AdmissionCandidateOutcome
} from './model-admission-outcome.js'
import { type ReviewWorkflowInput } from './workflow-contracts.js'

export const prepareCandidatesForAdmission = async (
  input: {
    readonly workflowInput: ReviewWorkflowInput
    readonly tasks: readonly WorkflowReviewTask[]
    readonly candidates: readonly CandidateFinding[]
    readonly sharedDigest: string
    readonly reviewEvidence?: readonly EvidenceRecord[]
    readonly proofPackets: readonly ProofPacket[]
    readonly refutationResults: readonly RefutationResult[]
    readonly refuteFinding?: FindingRefutationRunner
    readonly signal?: AbortSignal
  }
): Promise<AdmissionCandidateOutcome> => {
  if (input.refuteFinding === undefined) {
    return noRefuterAdmissionOutcome({
      candidates: input.candidates,
      workflowEvidence: input.workflowInput.evidence
    })
  }
  const refuteFinding = input.refuteFinding
  const reviewEvidence = input.reviewEvidence ?? input.workflowInput.evidence

  const outcomes = await mapWithBoundedConcurrencyInOrder({
    items: input.candidates,
    concurrency: input.workflowInput.maxConcurrentTasks ?? 1,
    mapItem: (candidate) =>
      reviewCandidateForAdmission({
        workflowInput: input.workflowInput,
        tasks: input.tasks,
        candidate,
        allCandidates: input.candidates,
        sharedDigest: input.sharedDigest,
        reviewEvidence,
        proofPackets: input.proofPackets,
        refutationResults: input.refutationResults,
        refuteFinding,
        ...(input.signal === undefined ? {} : { signal: input.signal })
      })
  })

  return mergeAdmissionCandidateOutcomes({
    workflowEvidence: input.workflowInput.evidence,
    outcomes
  })
}
