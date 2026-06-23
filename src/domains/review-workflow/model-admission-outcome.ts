import {
  type EvidenceRecord,
  type FindingJudgeResult,
  type RefutationResult,
  type RejectedFinding
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { type AdmissionDecisionRecord } from '../shared-context/index.js'
import { type ProviderIssue } from './model-provider-issues.js'

export type AdmissionCandidateOutcome = {
  readonly admissionCandidates: readonly CandidateFinding[]
  readonly evidence: readonly EvidenceRecord[]
  readonly rejectedFindings: readonly RejectedFinding[]
  readonly admissionDecisions: readonly AdmissionDecisionRecord[]
  readonly artifactOnlyCandidateIds: readonly string[]
  readonly judgeResults: readonly FindingJudgeResult[]
  readonly refutationResults: readonly RefutationResult[]
  readonly providerIssues: readonly ProviderIssue[]
}

export const emptyAdmissionCandidateOutcome = (): AdmissionCandidateOutcome => ({
  admissionCandidates: [],
  evidence: [],
  rejectedFindings: [],
  admissionDecisions: [],
  artifactOnlyCandidateIds: [],
  judgeResults: [],
  refutationResults: [],
  providerIssues: []
})

export const mergeAdmissionCandidateOutcomes = (input: {
  readonly workflowEvidence: readonly EvidenceRecord[]
  readonly outcomes: readonly AdmissionCandidateOutcome[]
}): AdmissionCandidateOutcome => ({
  admissionCandidates: input.outcomes.flatMap(
    (outcome) => outcome.admissionCandidates
  ),
  evidence: [
    ...input.workflowEvidence,
    ...input.outcomes.flatMap((outcome) => outcome.evidence)
  ],
  rejectedFindings: input.outcomes.flatMap((outcome) => outcome.rejectedFindings),
  admissionDecisions: input.outcomes.flatMap(
    (outcome) => outcome.admissionDecisions
  ),
  artifactOnlyCandidateIds: input.outcomes.flatMap(
    (outcome) => outcome.artifactOnlyCandidateIds
  ),
  judgeResults: input.outcomes.flatMap((outcome) => outcome.judgeResults),
  refutationResults: input.outcomes.flatMap(
    (outcome) => outcome.refutationResults
  ),
  providerIssues: input.outcomes.flatMap((outcome) => outcome.providerIssues)
})
