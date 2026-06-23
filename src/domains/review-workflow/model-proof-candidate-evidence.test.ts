import { describe, expect, test } from 'vitest'
import { type EvidenceRecord } from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import { proofCandidateEvidenceFor } from './model-proof-candidate-evidence.js'

const evidence = (id: string): EvidenceRecord => ({
  id,
  kind: 'diff',
  summary: `Evidence ${id}`,
  source: 'review-agent',
  redactionApplied: true
})

const candidate: CandidateFinding = {
  id: 'cand_proofevidence',
  taskId: 'task_proofevidence',
  category: 'bug',
  severity: 'high',
  title: 'Changed branch drops state',
  description: 'The changed branch drops state before returning.',
  location: {
    path: 'src/task.ts',
    startLine: 9,
    side: 'new'
  },
  evidenceIds: ['ev_missing1', 'ev_second1', 'ev_first1'],
  proposedBy: 'review-agent'
}

describe('model proof candidate evidence', () => {
  test('selects seed IDs by candidate citation order and cited evidence by task evidence order', () => {
    const first = evidence('ev_first1')
    const second = evidence('ev_second1')
    const unrelated = evidence('ev_unrelated1')

    expect(
      proofCandidateEvidenceFor({
        taskEvidence: [first, unrelated, second],
        candidate
      })
    ).toEqual({
      seedEvidenceIds: ['ev_second1', 'ev_first1'],
      citedEvidence: [first, second]
    })
  })
})
