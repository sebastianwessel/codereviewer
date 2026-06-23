import { describe, expect, test } from 'vitest'
import { proofTraceResultForInvestigation } from './model-proof-trace-result.js'

describe('model proof trace result', () => {
  test('maps effective investigation verdicts to trace results', () => {
    expect(
      proofTraceResultForInvestigation({
        effectiveInvestigationVerdict: 'proved',
        providerIssueCount: 0
      })
    ).toBe('proof')
    expect(
      proofTraceResultForInvestigation({
        effectiveInvestigationVerdict: 'refuted',
        providerIssueCount: 0
      })
    ).toBe('refuted')
    expect(
      proofTraceResultForInvestigation({
        effectiveInvestigationVerdict: 'needs-more-evidence',
        providerIssueCount: 0
      })
    ).toBe('needs-more-evidence')
  })

  test('uses provider-error when any provider issue was recovered', () => {
    expect(
      proofTraceResultForInvestigation({
        effectiveInvestigationVerdict: 'proved',
        providerIssueCount: 1
      })
    ).toBe('provider-error')
    expect(
      proofTraceResultForInvestigation({
        effectiveInvestigationVerdict: 'refuted',
        providerIssueCount: 2
      })
    ).toBe('provider-error')
  })
})
