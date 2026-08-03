import {
  RejectedFindingSchema,
  type RejectedFinding
} from '../../../../shared/contracts/index.js'
import { type CandidateFinding } from '../../../admission/index.js'
import { normalizeError } from '../../../../shared/errors/error-normalizer.js'
import {
  emptyAdmissionCandidateOutcome,
  type AdmissionCandidateOutcome
} from './outcome.js'
import { providerIssueForError } from '../provider-issues.js'

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
    evidenceIds: input.candidate.evidenceIds,
    severity: input.candidate.severity
  })
}

export const refutationProviderErrorOutcome = (
  input: {
    readonly candidate: CandidateFinding
    readonly error: unknown
    readonly stage: RefutationProviderErrorStage
  }
): AdmissionCandidateOutcome => {
  const rejectedFinding = rejectedFindingForRefutationError({
    candidate: input.candidate,
    error: input.error
  })

  return {
    ...emptyAdmissionCandidateOutcome(),
    rejectedFindings: [rejectedFinding],
    providerIssues: [
      providerIssueForError({
        error: input.error,
        stage: input.stage,
        // Not recovered: the candidate was never adjudicated. It is rejected as
        // `needs-more-evidence`, which removes it from the gate's input — so
        // calling this recovered let a refutation outage shrink the very set the
        // gate is measuring, and pass.
        recovered: false
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
