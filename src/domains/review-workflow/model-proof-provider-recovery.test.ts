import { describe, expect, test } from 'vitest'
import { providerIssueForError } from './model-provider-issues.js'
import { proofInvestigationProviderRecovery } from './model-proof-provider-recovery.js'

describe('model proof provider recovery', () => {
  test('creates recovered packet-failure investigation outputs', () => {
    expect(
      proofInvestigationProviderRecovery({
        error: new Error('packet timed out'),
        stage: 'suspicion-investigation-packet',
        rationaleSummary:
          'Suspicion investigation packet exceeded the provider budget before proof could be established.',
        providerIssueForError
      })
    ).toEqual({
      output: {
        verdict: 'needs-more-evidence',
        rationaleSummary:
          'Suspicion investigation packet exceeded the provider budget before proof could be established.',
        evidenceIds: [],
        contextRequests: [],
        requestedContext: [],
        contradictionChecks: []
      },
      providerIssues: [
        {
          code: 'provider_timeout',
          stage: 'suspicion-investigation-packet',
          recovered: true,
          message: 'packet timed out'
        }
      ]
    })
  })

  test('creates recovered provider-call failure investigation outputs', () => {
    expect(
      proofInvestigationProviderRecovery({
        error: new Error('provider timed out'),
        stage: 'suspicion-investigation',
        rationaleSummary:
          'Suspicion investigation failed before a proof could be established.',
        providerIssueForError
      })
    ).toMatchObject({
      output: {
        verdict: 'needs-more-evidence',
        rationaleSummary:
          'Suspicion investigation failed before a proof could be established.',
        evidenceIds: []
      },
      providerIssues: [
        {
          code: 'provider_timeout',
          stage: 'suspicion-investigation',
          recovered: true,
          message: 'provider timed out'
        }
      ]
    })
  })
})
