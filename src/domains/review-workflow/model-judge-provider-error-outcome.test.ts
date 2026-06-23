import { describe, expect, test } from 'vitest'
import { type EvidenceRecord } from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { judgeProviderErrorOutcome } from './model-judge-provider-error-outcome.js'
import { providerIssueForError } from './model-provider-issues.js'

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

const refutationEvidence: EvidenceRecord = {
  id: 'ev_refutation1',
  kind: 'refutation',
  summary: 'The proof survived refutation.',
  source: 'review-agent',
  redactionApplied: true
}

describe('model judge provider-error outcome', () => {
  test('creates recovered provider-error judge outcomes', () => {
    expect(
      judgeProviderErrorOutcome({
        candidate: candidate(),
        refutationEvidence,
        error: new Error('provider timed out'),
        stage: 'judge-finding',
        messagePrefix: 'Judge check failed',
        providerIssueForError
      })
    ).toEqual({
      status: 'provider-error',
      evidence: [],
      rejectedFindings: [
        {
          candidateId: 'cand_model1',
          status: 'needs-more-evidence',
          reason: 'provider-error',
          message: 'Judge check failed: provider_timeout',
          evidenceIds: ['ev_refutation1']
        }
      ],
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
          code: 'provider_timeout',
          stage: 'judge-finding',
          recovered: true,
          message: 'provider timed out'
        }
      ]
    })
  })
})
