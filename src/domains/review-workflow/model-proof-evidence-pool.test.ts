import { describe, expect, test } from 'vitest'
import { type EvidenceRecord } from '../../shared/contracts/index.js'
import { proofEvidencePoolFor } from './model-proof-evidence-pool.js'

const evidence = (id: string): EvidenceRecord => ({
  id,
  kind: 'diff',
  summary: `Evidence ${id}`,
  source: 'review-agent',
  redactionApplied: true
})

describe('model proof evidence pool', () => {
  test('dedupes final evidence records and builds available and fallback IDs', () => {
    const existing = evidence('ev_existing1')
    const followUp = evidence('ev_followup1')

    expect(
      proofEvidencePoolFor({
        initialEvidenceRecords: [existing],
        contextEvidence: [existing, followUp],
        seedEvidenceIds: ['ev_seed1']
      })
    ).toEqual({
      evidenceRecords: [existing, followUp],
      availableEvidenceIds: ['ev_existing1', 'ev_followup1', 'ev_seed1'],
      fallbackEvidenceIds: ['ev_existing1', 'ev_followup1', 'ev_seed1']
    })
  })
})
