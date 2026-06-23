import { describe, expect, test } from 'vitest'
import { type CandidateFinding } from '../admission/index.js'
import { proofNonProvedPromotionDecision } from './model-proof-non-proved-promotion.js'

const candidate: CandidateFinding = {
  id: 'cand_nonproved',
  taskId: 'task_nonproved',
  category: 'bug',
  severity: 'high',
  title: 'Changed branch drops state',
  description: 'The changed branch drops state before returning.',
  location: {
    path: 'src/task.ts',
    startLine: 9,
    side: 'new'
  },
  evidenceIds: ['ev_task1'],
  proposedBy: 'review-agent'
}

describe('model proof non-proved promotion', () => {
  test('rejects refuted investigations regardless of weak policy', () => {
    expect(
      proofNonProvedPromotionDecision({
        candidate,
        effectiveInvestigationVerdict: 'refuted',
        rationaleSummary: 'The proof was contradicted.',
        modelWeakOrRefuted: 'artifact-only'
      })
    ).toEqual({
      candidateId: 'cand_nonproved',
      status: 'rejected',
      reason: 'The proof was contradicted.',
      policy: 'promotion-policy-v1'
    })
  })

  test('uses weak policy and truncates reason for needs-more-evidence investigations', () => {
    const longReason = 'x'.repeat(700)

    expect(
      proofNonProvedPromotionDecision({
        candidate,
        effectiveInvestigationVerdict: 'needs-more-evidence',
        rationaleSummary: longReason,
        modelWeakOrRefuted: 'artifact-only'
      })
    ).toEqual({
      candidateId: 'cand_nonproved',
      status: 'artifact-only',
      reason: 'x'.repeat(500),
      policy: 'promotion-policy-v1'
    })
  })
})
