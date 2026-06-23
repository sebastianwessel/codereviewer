import { describe, expect, test } from 'vitest'
import { proofSuspicionStatusForInvestigation } from './model-proof-suspicion-status.js'

describe('model proof suspicion status', () => {
  test('maps effective investigation verdicts to suspicion statuses', () => {
    expect(
      proofSuspicionStatusForInvestigation({
        effectiveInvestigationVerdict: 'proved'
      })
    ).toBe('proved')
    expect(
      proofSuspicionStatusForInvestigation({
        effectiveInvestigationVerdict: 'refuted'
      })
    ).toBe('refuted')
    expect(
      proofSuspicionStatusForInvestigation({
        effectiveInvestigationVerdict: 'needs-more-evidence'
      })
    ).toBe('needs-more-evidence')
  })
})
