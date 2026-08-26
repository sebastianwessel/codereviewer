import type { CandidateFinding } from '../../../admission/index.js'
import type { RefutationResolution } from '../refutation/execution.js'
import {
  candidateWithinReviewedScope,
  isModelProposedCandidate
} from './candidate-scope.js'
import { createRefutationEvidence } from '../refutation/evidence.js'
import { activeRefutationResultForCandidate } from '../refutation/result.js'
import { refutationProviderErrorOutcome } from './provider-error-outcome.js'
import type { AdmissionCandidateOutcome } from './outcome.js'
import {
  noRefuterAdmissionOutcome,
  outOfDiffScopeOutcome,
  supportSignalCandidateOutcome
} from './preflight-outcome.js'
import {
  admissibleRefutationOutcome,
  refutedCandidateOutcome,
  weakEvidenceRejectedOutcome
} from '../refutation/verdict-outcome.js'
import type { ReviewWorkflowInput } from '../contracts.js'

/**
 * Turns ONE candidate plus its already-resolved refutation verdict into an
 * admission outcome. The model call itself happens upstream, once per task
 * (`executeBatchRefutation`), so this stage stays pure: preflight scope checks, then
 * the verdict-to-outcome mapping.
 */
export const reviewCandidateForAdmission = (
  input: {
    readonly workflowInput: ReviewWorkflowInput
    readonly candidate: CandidateFinding
    readonly resolution: RefutationResolution | undefined
  }
): AdmissionCandidateOutcome => {
  if (input.resolution === undefined) {
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

  if (input.resolution.status === 'provider-error') {
    return refutationProviderErrorOutcome({
      candidate: input.candidate,
      error: input.resolution.error,
      stage: input.resolution.stage
    })
  }

  // The batch returned no verdict for this candidate. That is an absence of signal,
  // not a judgment: treat it exactly like `needs-more-evidence` so the candidate can
  // never be admitted as proved on a verdict the model never gave.
  const refutation =
    input.resolution.status === 'missing-verdict'
      ? {
          verdict: 'needs-more-evidence' as const,
          rationaleSummary:
            'The refutation batch returned no verdict for this candidate.'
        }
      : input.resolution.refutation
  const refutationEvidence = createRefutationEvidence({
    candidate: input.candidate,
    refutation
  })
  const refutationResult = activeRefutationResultForCandidate({
    candidate: input.candidate,
    refutation,
    refutationEvidence
  })

  if (refutation.verdict === 'refuted') {
    return refutedCandidateOutcome({
      candidate: input.candidate,
      refutation,
      refutationEvidence,
      refutationResult
    })
  }

  if (
    refutation.verdict === 'needs-more-evidence' &&
    input.workflowInput.promotionPolicy.modelWeakOrRefuted === 'rejected'
  ) {
    return weakEvidenceRejectedOutcome({
      candidate: input.candidate,
      refutation,
      refutationEvidence,
      refutationResult
    })
  }

  // A candidate that passes refutation (`proved`) is admitted directly;
  // `needs-more-evidence` is admitted as artifact-only (see
  // admissibleRefutationOutcome); `refuted` was already rejected above.
  return admissibleRefutationOutcome({
    candidate: input.candidate,
    refutation,
    refutationEvidence,
    refutationResult
  })
}
