import {
  RejectedFindingSchema,
  type RejectedFinding
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { normalizeError } from '../../shared/errors/error-normalizer.js'
import {
  emptyAdmissionCandidateOutcome,
  type AdmissionCandidateOutcome
} from './model-admission-outcome.js'
import {
  providerIssueForError,
  type ProviderIssueForError
} from './model-provider-issues.js'

export type RefutationProviderErrorStage =
  | 'refutation-packet'
  | 'refutation-check'

export const rejectedFindingForRefutationError = (input: {
  readonly candidate: CandidateFinding
  readonly error: unknown
}): RejectedFinding => {
  const normalized = normalizeError(input.error)

  return RejectedFindingSchema.parse({
    candidateId: input.candidate.id,
    status: 'needs-more-evidence',
    reason: 'provider-error',
    message: `Refutation check failed: ${normalized.code}`.slice(0, 500),
    evidenceIds: input.candidate.evidenceIds
  })
}

export const refutationProviderErrorOutcome = (
  input: {
    readonly candidate: CandidateFinding
    readonly error: unknown
    readonly stage: RefutationProviderErrorStage
    readonly issueForError?: ProviderIssueForError
  }
): AdmissionCandidateOutcome => {
  const rejectedFinding = rejectedFindingForRefutationError({
    candidate: input.candidate,
    error: input.error
  })
  const issueForError = input.issueForError ?? providerIssueForError

  return {
    ...emptyAdmissionCandidateOutcome(),
    rejectedFindings: [rejectedFinding],
    providerIssues: [
      issueForError({
        error: input.error,
        stage: input.stage,
        recovered: true
      })
    ],
    admissionDecisions: [
      {
        candidateId: input.candidate.id,
        status: 'needs-more-evidence',
        rejectedReason: 'provider-error'
      }
    ]
  }
}
