import {
  RejectedFindingSchema,
  type EvidenceRecord,
  type FindingJudgeResult,
  type RejectedFinding
} from '../../shared/contracts/index.js'
import { normalizeError } from '../../shared/errors/error-normalizer.js'
import { type CandidateFinding } from '../admission/index.js'
import { type AdmissionDecisionRecord } from '../shared-context/index.js'
import {
  type ProviderIssue,
  type ProviderIssueForError
} from './model-provider-issues.js'

export type JudgeProviderErrorOutcome = {
  readonly status: 'provider-error'
  readonly evidence: readonly EvidenceRecord[]
  readonly rejectedFindings: readonly RejectedFinding[]
  readonly admissionDecisions: readonly AdmissionDecisionRecord[]
  readonly judgeResults: readonly FindingJudgeResult[]
  readonly providerIssues: readonly ProviderIssue[]
}

export const judgeProviderErrorOutcome = (
  input: {
    readonly candidate: CandidateFinding
    readonly refutationEvidence: EvidenceRecord
    readonly error: unknown
    readonly stage: string
    readonly messagePrefix: string
    readonly providerIssueForError: ProviderIssueForError
  }
): JudgeProviderErrorOutcome => {
  const normalized = normalizeError(input.error, {
    source: 'provider',
    operation: input.stage
  })

  return {
    status: 'provider-error',
    evidence: [],
    rejectedFindings: [
      RejectedFindingSchema.parse({
        candidateId: input.candidate.id,
        status: 'needs-more-evidence',
        reason: 'provider-error',
        message: `${input.messagePrefix}: ${normalized.code}`.slice(0, 500),
        evidenceIds: [input.refutationEvidence.id]
      })
    ],
    admissionDecisions: [
      {
        candidateId: input.candidate.id,
        status: 'needs-more-evidence',
        rejectedReason: 'provider-error'
      }
    ],
    judgeResults: [],
    providerIssues: [
      input.providerIssueForError({
        error: input.error,
        stage: input.stage,
        recovered: true
      })
    ]
  }
}
