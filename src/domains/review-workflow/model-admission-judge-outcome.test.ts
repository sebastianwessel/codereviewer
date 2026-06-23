import { describe, expect, test } from 'vitest'
import { type CandidateFinding } from '../admission/index.js'
import {
  type EvidenceRecord,
  type FindingJudgeResult,
  type RejectedFinding
} from '../../shared/contracts/index.js'
import { type FindingRefutationResult } from './model-agent-contracts.js'
import { type JudgeReviewOutcome } from './model-judge-review.js'
import { admissionOutcomeForJudgeReview } from './model-admission-judge-outcome.js'

const candidate = (): CandidateFinding => ({
  id: 'cand_model1',
  taskId: 'task_admission',
  category: 'bug',
  severity: 'high',
  title: 'Changed branch can lose data',
  description: 'The model claims the changed branch can lose data.',
  location: {
    path: 'src/admission.ts',
    startLine: 12,
    side: 'new'
  },
  evidenceIds: ['ev_support1'],
  proposedBy: 'review-agent'
})

const refutation: FindingRefutationResult = {
  verdict: 'proved',
  rationaleSummary: 'The proof survived refutation.'
}

const refutationEvidence: EvidenceRecord = {
  id: 'ev_refutation1',
  kind: 'refutation',
  summary: 'The proof survived refutation.',
  source: 'review-agent',
  redactionApplied: true
}

const judgeEvidence: EvidenceRecord = {
  id: 'ev_judge1',
  kind: 'judge',
  summary: 'The critic checked the proof.',
  source: 'review-agent',
  redactionApplied: true
}

const judgeResult: FindingJudgeResult = {
  id: 'judge_valid1',
  candidateId: 'cand_model1',
  verdict: 'valid',
  summary: 'The proof remains valid.',
  challengeQuestions: ['Does the proof hold?'],
  verificationChecks: [],
  contextRequests: [],
  requestedContext: [],
  evidenceIds: ['ev_judge1']
}

describe('model admission judge outcome', () => {
  test('propagates non-passed judge outcomes', () => {
    const rejectedFinding: RejectedFinding = {
      candidateId: 'cand_model1',
      status: 'needs-more-evidence',
      reason: 'provider-error',
      message: 'Judge check failed.',
      evidenceIds: ['ev_refutation1']
    }
    const judgeOutcome: JudgeReviewOutcome = {
      status: 'provider-error',
      evidence: [judgeEvidence],
      rejectedFindings: [rejectedFinding],
      admissionDecisions: [
        {
          candidateId: 'cand_model1',
          status: 'needs-more-evidence',
          rejectedReason: 'provider-error'
        }
      ],
      judgeResults: [],
      providerIssues: [
        {
          code: 'provider_error',
          stage: 'judge-finding',
          recovered: true,
          message: 'Provider failed.'
        }
      ]
    }

    expect(
      admissionOutcomeForJudgeReview({
        candidate: candidate(),
        refutation,
        refutationEvidence,
        artifactOnlyCandidateIds: [],
        judgeOutcome
      })
    ).toEqual({
      admissionCandidates: [],
      evidence: [refutationEvidence, judgeEvidence],
      rejectedFindings: [rejectedFinding],
      admissionDecisions: judgeOutcome.admissionDecisions,
      artifactOnlyCandidateIds: [],
      judgeResults: [],
      refutationResults: [],
      providerIssues: judgeOutcome.providerIssues
    })
  })

  test('creates proved candidate outcomes for passed judge reviews', () => {
    const judgeOutcome: JudgeReviewOutcome = {
      status: 'passed',
      evidence: [judgeEvidence],
      rejectedFindings: [],
      admissionDecisions: [],
      judgeResults: [judgeResult],
      providerIssues: []
    }

    const outcome = admissionOutcomeForJudgeReview({
      candidate: candidate(),
      refutation,
      refutationEvidence,
      artifactOnlyCandidateIds: [],
      judgeOutcome
    })

    expect(outcome).toMatchObject({
      evidence: [refutationEvidence, judgeEvidence],
      artifactOnlyCandidateIds: [],
      judgeResults: [judgeResult],
      providerIssues: []
    })
    expect(outcome.admissionCandidates).toHaveLength(1)
    expect(outcome.admissionCandidates[0]?.id).toBe('cand_model1')
  })
})
