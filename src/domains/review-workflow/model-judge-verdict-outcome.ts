import {
  RejectedFindingSchema,
  type EvidenceRecord,
  type FindingJudgeResult,
  type RejectedFinding
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { type AdmissionDecisionRecord } from '../shared-context/index.js'
import { type ProviderIssue } from './model-provider-issues.js'

export type JudgeVerdictOutcome = {
  readonly status: 'passed' | 'rejected'
  readonly evidence: readonly EvidenceRecord[]
  readonly rejectedFindings: readonly RejectedFinding[]
  readonly admissionDecisions: readonly AdmissionDecisionRecord[]
  readonly judgeResults: readonly FindingJudgeResult[]
  readonly providerIssues: readonly ProviderIssue[]
}

export const judgeVerdictOutcome = (
  input: {
    readonly candidate: CandidateFinding
    readonly judgeResult: FindingJudgeResult
    readonly evidence: readonly EvidenceRecord[]
    readonly providerIssues: readonly ProviderIssue[]
  }
): JudgeVerdictOutcome => {
  if (input.judgeResult.verdict === 'false-positive') {
    return {
      status: 'rejected',
      evidence: input.evidence,
      rejectedFindings: [
        RejectedFindingSchema.parse({
          candidateId: input.candidate.id,
          status: 'rejected',
          reason: 'refuted',
          message: input.judgeResult.summary,
          evidenceIds: input.judgeResult.evidenceIds
        })
      ],
      admissionDecisions: [
        {
          candidateId: input.candidate.id,
          status: 'rejected',
          rejectedReason: 'refuted'
        }
      ],
      judgeResults: [input.judgeResult],
      providerIssues: input.providerIssues
    }
  }

  if (input.judgeResult.verdict === 'needs-more-evidence') {
    return {
      status: 'rejected',
      evidence: input.evidence,
      rejectedFindings: [
        RejectedFindingSchema.parse({
          candidateId: input.candidate.id,
          status: 'needs-more-evidence',
          reason: 'insufficient-evidence',
          message: input.judgeResult.summary,
          evidenceIds: input.judgeResult.evidenceIds
        })
      ],
      admissionDecisions: [
        {
          candidateId: input.candidate.id,
          status: 'needs-more-evidence',
          rejectedReason: 'insufficient-evidence'
        }
      ],
      judgeResults: [input.judgeResult],
      providerIssues: input.providerIssues
    }
  }

  return {
    status: 'passed',
    evidence: input.evidence,
    rejectedFindings: [],
    admissionDecisions: [],
    judgeResults: [input.judgeResult],
    providerIssues: input.providerIssues
  }
}
