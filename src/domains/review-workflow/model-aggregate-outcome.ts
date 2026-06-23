import {
  REJECTED_FINDING_MESSAGE_MAX,
  RejectedFindingSchema,
  type FindingAggregateResult,
  type RejectedFinding
} from '../../shared/contracts/index.js'
import { type AdmissionDecisionRecord } from '../shared-context/index.js'
import { truncateForContract } from '../../shared/text/truncate.js'
import { type ProviderIssue } from './model-provider-issues.js'

export type AggregateReviewOutcome = {
  readonly aggregateResults: readonly FindingAggregateResult[]
  readonly rejectedFindings: readonly RejectedFinding[]
  readonly admissionDecisions: readonly AdmissionDecisionRecord[]
  readonly rejectedCandidateIds: ReadonlySet<string>
  readonly coveredCandidateIds: ReadonlySet<string>
  readonly providerIssues: readonly ProviderIssue[]
}

export const emptyAggregateReviewOutcome = (
  providerIssues: readonly ProviderIssue[] = []
): AggregateReviewOutcome => ({
  aggregateResults: [],
  rejectedFindings: [],
  admissionDecisions: [],
  rejectedCandidateIds: new Set<string>(),
  coveredCandidateIds: new Set<string>(),
  providerIssues
})

const rejectedFindingForAggregateDecision = (
  decision: FindingAggregateResult['decisions'][number]
): RejectedFinding =>
  RejectedFindingSchema.parse({
    candidateId: decision.candidateId,
    status:
      decision.verdict === 'false-positive'
        ? 'rejected'
        : 'needs-more-evidence',
    reason:
      decision.verdict === 'false-positive'
        ? 'refuted'
        : 'insufficient-evidence',
    message: truncateForContract(
      decision.summary,
      REJECTED_FINDING_MESSAGE_MAX
    ),
    evidenceIds: decision.evidenceIds
  })

const admissionDecisionForAggregateDecision = (
  decision: FindingAggregateResult['decisions'][number]
): AdmissionDecisionRecord => ({
  candidateId: decision.candidateId,
  status:
    decision.verdict === 'false-positive'
      ? 'rejected'
      : 'needs-more-evidence',
  rejectedReason:
    decision.verdict === 'false-positive'
      ? 'refuted'
      : 'insufficient-evidence'
})

export const aggregateReviewOutcomeForResults = (
  input: {
    readonly aggregateResults: readonly FindingAggregateResult[]
    readonly providerIssues: readonly ProviderIssue[]
  }
): AggregateReviewOutcome => {
  const rejectedDecisions = input.aggregateResults.flatMap((result) =>
    result.decisions.filter((decision) => decision.verdict !== 'valid')
  )

  return {
    aggregateResults: input.aggregateResults,
    rejectedFindings: rejectedDecisions.map(rejectedFindingForAggregateDecision),
    admissionDecisions: rejectedDecisions.map(
      admissionDecisionForAggregateDecision
    ),
    rejectedCandidateIds: new Set(
      rejectedDecisions.map((decision) => decision.candidateId)
    ),
    // Only candidates the aggregate critic terminally resolved (rejected) count
    // as "covered" and may skip the per-candidate judge. An aggregate `valid`
    // verdict is a batch-level sanity check, not a substitute for the strict
    // per-candidate judge, so valid candidates still flow to the judge when
    // `judgeFindings` is enabled (prevents rubber-stamping; raises precision).
    coveredCandidateIds: new Set(
      rejectedDecisions.map((decision) => decision.candidateId)
    ),
    providerIssues: input.providerIssues
  }
}
