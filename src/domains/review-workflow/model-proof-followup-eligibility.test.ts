import { describe, expect, test } from 'vitest'
import { proofShouldRequestFollowUpContext } from './model-proof-followup-eligibility.js'

const baseInput = {
  verdict: 'needs-more-evidence' as const,
  hasContextRetriever: true,
  usedInvestigationRounds: 1,
  maxInvestigationRounds: 3,
  contextRequestCount: 1,
  requestedContextCount: 0
}

describe('model proof follow-up eligibility', () => {
  test('allows follow-up context when investigation needs more evidence and has budgeted requests', () => {
    expect(proofShouldRequestFollowUpContext(baseInput)).toBe(true)
    expect(
      proofShouldRequestFollowUpContext({
        ...baseInput,
        contextRequestCount: 0,
        requestedContextCount: 1
      })
    ).toBe(true)
  })

  test('blocks follow-up context when verdict, retriever, rounds, or requests are missing', () => {
    expect(
      proofShouldRequestFollowUpContext({
        ...baseInput,
        verdict: 'proved'
      })
    ).toBe(false)
    expect(
      proofShouldRequestFollowUpContext({
        ...baseInput,
        hasContextRetriever: false
      })
    ).toBe(false)
    expect(
      proofShouldRequestFollowUpContext({
        ...baseInput,
        usedInvestigationRounds: 3
      })
    ).toBe(false)
    expect(
      proofShouldRequestFollowUpContext({
        ...baseInput,
        contextRequestCount: 0,
        requestedContextCount: 0
      })
    ).toBe(false)
  })
})
