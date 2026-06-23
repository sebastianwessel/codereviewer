import { describe, expect, test } from 'vitest'
import {
  type EvidenceRecord,
  type FindingJudgeResult
} from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { type ProviderIssue } from './model-provider-issues.js'
import { judgeVerdictOutcome } from './model-judge-verdict-outcome.js'

const candidate = (): CandidateFinding => ({
  id: 'cand_model1',
  taskId: 'task_judge',
  category: 'bug',
  severity: 'high',
  title: 'Changed branch can lose data',
  description: 'The model claims the changed branch can lose data.',
  location: {
    path: 'src/judge.ts',
    startLine: 12,
    side: 'new'
  },
  evidenceIds: ['ev_support1'],
  proposedBy: 'review-agent'
})

const judgeEvidence: EvidenceRecord = {
  id: 'ev_judge1',
  kind: 'judge',
  summary: 'The critic checked the proof.',
  source: 'review-agent',
  redactionApplied: true
}

const providerIssue: ProviderIssue = {
  code: 'provider_error',
  stage: 'judge-context-retrieval',
  recovered: true,
  message: 'Context retrieval failed.'
}

const judgeResult = (
  verdict: FindingJudgeResult['verdict']
): FindingJudgeResult => ({
  id: `judge_${verdict.replaceAll('-', '_')}`,
  candidateId: 'cand_model1',
  verdict,
  summary: `Judge returned ${verdict}.`,
  challengeQuestions: ['Does the proof hold?'],
  verificationChecks: [],
  contextRequests: [],
  requestedContext: [],
  evidenceIds: ['ev_judge1']
})

describe('model judge verdict outcome', () => {
  test('passes valid judge verdicts through', () => {
    const result = judgeResult('valid')

    expect(
      judgeVerdictOutcome({
        candidate: candidate(),
        judgeResult: result,
        evidence: [judgeEvidence],
        providerIssues: [providerIssue]
      })
    ).toEqual({
      status: 'passed',
      evidence: [judgeEvidence],
      rejectedFindings: [],
      admissionDecisions: [],
      judgeResults: [result],
      providerIssues: [providerIssue]
    })
  })

  test('rejects false-positive judge verdicts as refuted', () => {
    const result = judgeResult('false-positive')

    expect(
      judgeVerdictOutcome({
        candidate: candidate(),
        judgeResult: result,
        evidence: [judgeEvidence],
        providerIssues: [providerIssue]
      })
    ).toEqual({
      status: 'rejected',
      evidence: [judgeEvidence],
      rejectedFindings: [
        {
          candidateId: 'cand_model1',
          status: 'rejected',
          reason: 'refuted',
          message: 'Judge returned false-positive.',
          evidenceIds: ['ev_judge1']
        }
      ],
      admissionDecisions: [
        {
          candidateId: 'cand_model1',
          status: 'rejected',
          rejectedReason: 'refuted'
        }
      ],
      judgeResults: [result],
      providerIssues: [providerIssue]
    })
  })

  test('rejects needs-more-evidence judge verdicts as insufficient evidence', () => {
    const result = judgeResult('needs-more-evidence')

    expect(
      judgeVerdictOutcome({
        candidate: candidate(),
        judgeResult: result,
        evidence: [judgeEvidence],
        providerIssues: [providerIssue]
      })
    ).toEqual({
      status: 'rejected',
      evidence: [judgeEvidence],
      rejectedFindings: [
        {
          candidateId: 'cand_model1',
          status: 'needs-more-evidence',
          reason: 'insufficient-evidence',
          message: 'Judge returned needs-more-evidence.',
          evidenceIds: ['ev_judge1']
        }
      ],
      admissionDecisions: [
        {
          candidateId: 'cand_model1',
          status: 'needs-more-evidence',
          rejectedReason: 'insufficient-evidence'
        }
      ],
      judgeResults: [result],
      providerIssues: [providerIssue]
    })
  })
})
