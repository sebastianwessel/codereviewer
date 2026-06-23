import { describe, expect, test } from 'vitest'
import { type CandidateFinding } from '../admission/index.js'
import {
  refutationProviderErrorOutcome,
  rejectedFindingForRefutationError
} from './model-admission-provider-error-outcome.js'

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

describe('model admission provider-error outcome', () => {
  test('creates refutation provider-error rejected findings', () => {
    expect(
      rejectedFindingForRefutationError({
        candidate: candidate(),
        error: new Error('provider timed out')
      })
    ).toEqual({
      candidateId: 'cand_model1',
      status: 'needs-more-evidence',
      reason: 'provider-error',
      message: 'Refutation check failed: internal_timeout',
      evidenceIds: ['ev_support1']
    })
  })

  test('creates recovered provider-error admission outcomes', () => {
    expect(
      refutationProviderErrorOutcome({
        candidate: candidate(),
        error: new Error('provider timed out'),
        stage: 'refutation-check'
      })
    ).toEqual({
      admissionCandidates: [],
      evidence: [],
      rejectedFindings: [
        {
          candidateId: 'cand_model1',
          status: 'needs-more-evidence',
          reason: 'provider-error',
          message: 'Refutation check failed: internal_timeout',
          evidenceIds: ['ev_support1']
        }
      ],
      admissionDecisions: [
        {
          candidateId: 'cand_model1',
          status: 'needs-more-evidence',
          rejectedReason: 'provider-error'
        }
      ],
      artifactOnlyCandidateIds: [],
      judgeResults: [],
      refutationResults: [],
      providerIssues: [
        {
          code: 'provider_timeout',
          stage: 'refutation-check',
          recovered: true,
          message: 'provider timed out'
        }
      ]
    })
  })
})
