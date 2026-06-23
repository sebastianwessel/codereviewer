import {
  type EvidenceRecord,
  type RefutationResult
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { type FindingRefutationResult } from './model-agent-contracts.js'
import {
  emptyAdmissionCandidateOutcome,
  type AdmissionCandidateOutcome
} from './model-admission-outcome.js'
import { enrichProvedCandidate } from './model-admission-refutation-evidence.js'
import { type JudgeReviewOutcome } from './model-judge-review.js'

export const admissionOutcomeForJudgeReview = (input: {
  readonly candidate: CandidateFinding
  readonly refutation: FindingRefutationResult
  readonly refutationEvidence: EvidenceRecord
  readonly refutationResult?: RefutationResult | undefined
  readonly artifactOnlyCandidateIds: readonly string[]
  readonly judgeOutcome: JudgeReviewOutcome
}): AdmissionCandidateOutcome => {
  if (input.judgeOutcome.status !== 'passed') {
    return {
      ...emptyAdmissionCandidateOutcome(),
      evidence: [input.refutationEvidence, ...input.judgeOutcome.evidence],
      rejectedFindings: input.judgeOutcome.rejectedFindings,
      admissionDecisions: input.judgeOutcome.admissionDecisions,
      artifactOnlyCandidateIds: input.artifactOnlyCandidateIds,
      judgeResults: input.judgeOutcome.judgeResults,
      providerIssues: input.judgeOutcome.providerIssues,
      refutationResults:
        input.refutationResult === undefined ? [] : [input.refutationResult]
    }
  }

  return {
    ...emptyAdmissionCandidateOutcome(),
    admissionCandidates: [
      enrichProvedCandidate({
        candidate: input.candidate,
        refutation: input.refutation,
        refutationEvidence: input.refutationEvidence
      })
    ],
    evidence: [input.refutationEvidence, ...input.judgeOutcome.evidence],
    artifactOnlyCandidateIds: input.artifactOnlyCandidateIds,
    judgeResults: input.judgeOutcome.judgeResults,
    refutationResults:
      input.refutationResult === undefined ? [] : [input.refutationResult],
    providerIssues: input.judgeOutcome.providerIssues
  }
}
