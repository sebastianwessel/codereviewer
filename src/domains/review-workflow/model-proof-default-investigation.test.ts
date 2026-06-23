import { describe, expect, test } from 'vitest'
import {
  proofMissingInvestigationOutput,
  proofRunnerlessInvestigationOutput
} from './model-proof-default-investigation.js'

describe('model proof default investigation', () => {
  test('never self-proves runnerless investigations even when evidence is available', () => {
    // No investigation runner executed, so the cited evidence has not been
    // verified into a proof packet. Per VIS-001 the result must stay
    // inconclusive rather than self-asserting `proved`.
    expect(
      proofRunnerlessInvestigationOutput({
        evidenceIds: ['ev_task1', 'ev_context1']
      })
    ).toEqual({
      verdict: 'needs-more-evidence',
      rationaleSummary:
        'No investigation runner ran, so the cited evidence was not verified into a proof packet.',
      evidenceIds: ['ev_task1', 'ev_context1'],
      contextRequests: [],
      requestedContext: [],
      contradictionChecks: []
    })
  })

  test('keeps runnerless investigations weak when no evidence is available', () => {
    expect(
      proofRunnerlessInvestigationOutput({
        evidenceIds: []
      })
    ).toEqual({
      verdict: 'needs-more-evidence',
      rationaleSummary:
        'Model suspicion was not tied to enough exact evidence to form a proof packet.',
      evidenceIds: [],
      contextRequests: [],
      requestedContext: [],
      contradictionChecks: []
    })
  })

  test('returns the missing-output fallback investigation result', () => {
    expect(proofMissingInvestigationOutput()).toEqual({
      verdict: 'needs-more-evidence',
      rationaleSummary:
        'Suspicion investigation did not produce a proof or refutation result.',
      evidenceIds: [],
      contextRequests: [],
      requestedContext: [],
      contradictionChecks: []
    })
  })
})
