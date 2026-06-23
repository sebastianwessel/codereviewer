import { describe, expect, test } from 'vitest'
import { type ContextRequest } from '../../shared/contracts/index.js'
import { type CandidateFinding } from '../admission/index.js'
import {
  proofSuspicionForEvidence,
  proofSuspicionSeedForCandidate
} from './model-proof-suspicion-seed.js'

const candidate: CandidateFinding = {
  id: 'cand_suspicionseed',
  taskId: 'task_suspicionseed',
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

const contextRequest: ContextRequest = {
  tool: 'read',
  path: 'src/task.ts',
  reason: 'Inspect the reviewed branch.'
}

describe('model proof suspicion seed', () => {
  test('creates stable suspicion IDs and default requested context', () => {
    const seed = proofSuspicionSeedForCandidate({
      candidate,
      contextRequests: [],
      requestedContext: []
    })

    expect(seed.suspicionId).toMatch(/^susp_[a-f0-9]{16}$/u)
    expect(seed.requestedContext).toEqual([
      'Inspect src/task.ts near line 9.',
      'Check reachable guards, alternate paths, tests, and configuration before promotion.'
    ])
    expect(
      proofSuspicionSeedForCandidate({
        candidate,
        contextRequests: [],
        requestedContext: []
      }).suspicionId
    ).toBe(seed.suspicionId)
  })

  test('preserves supplied context requests and requested context', () => {
    const seed = proofSuspicionSeedForCandidate({
      candidate,
      contextRequests: [contextRequest],
      requestedContext: ['Inspect the caller before promotion.']
    })

    expect(seed.contextRequests).toEqual([contextRequest])
    expect(seed.requestedContext).toEqual([
      'Inspect the caller before promotion.'
    ])
  })

  test('builds schema-valid model suspicions for evidence and status', () => {
    const seed = proofSuspicionSeedForCandidate({
      candidate,
      contextRequests: [contextRequest],
      requestedContext: ['Inspect the caller before promotion.']
    })

    expect(
      proofSuspicionForEvidence({
        candidate,
        seed,
        evidenceIds: ['ev_task1'],
        status: 'proved'
      })
    ).toEqual({
      id: seed.suspicionId,
      taskId: 'task_suspicionseed',
      category: 'bug',
      severityHint: 'high',
      title: 'Changed branch drops state',
      hypothesis: 'The changed branch drops state before returning.',
      primaryLocation: candidate.location,
      contextRequests: [contextRequest],
      requestedContext: ['Inspect the caller before promotion.'],
      evidenceIds: ['ev_task1'],
      proposedBy: 'review-agent',
      status: 'proved'
    })
  })
})
