import { describe, expect, test } from 'vitest'
import { proofEvidenceSelectionFor } from './model-proof-evidence-selection.js'

describe('model proof evidence selection', () => {
  test('keeps investigation evidence IDs that exist in available evidence', () => {
    expect(
      proofEvidenceSelectionFor({
        investigationVerdict: 'proved',
        investigationEvidenceIds: ['ev_available1', 'ev_missing1'],
        availableEvidenceIds: ['ev_available1', 'ev_available2'],
        fallbackEvidenceIds: ['ev_fallback1']
      })
    ).toEqual({
      proofEvidenceIds: ['ev_available1'],
      effectiveInvestigationVerdict: 'proved'
    })
  })

  test('falls back to scoped evidence when investigation citations are unavailable', () => {
    expect(
      proofEvidenceSelectionFor({
        investigationVerdict: 'proved',
        investigationEvidenceIds: ['ev_missing1'],
        availableEvidenceIds: ['ev_available1'],
        fallbackEvidenceIds: ['ev_fallback1', 'ev_fallback2']
      })
    ).toEqual({
      proofEvidenceIds: ['ev_fallback1', 'ev_fallback2'],
      effectiveInvestigationVerdict: 'proved'
    })
  })

  test('demotes proved investigations with no proof evidence', () => {
    expect(
      proofEvidenceSelectionFor({
        investigationVerdict: 'proved',
        investigationEvidenceIds: [],
        availableEvidenceIds: [],
        fallbackEvidenceIds: []
      })
    ).toEqual({
      proofEvidenceIds: [],
      effectiveInvestigationVerdict: 'needs-more-evidence'
    })
  })

  test('preserves non-proved investigation verdicts', () => {
    expect(
      proofEvidenceSelectionFor({
        investigationVerdict: 'refuted',
        investigationEvidenceIds: [],
        availableEvidenceIds: ['ev_available1'],
        fallbackEvidenceIds: ['ev_fallback1']
      })
    ).toEqual({
      proofEvidenceIds: ['ev_fallback1'],
      effectiveInvestigationVerdict: 'refuted'
    })
  })
})
