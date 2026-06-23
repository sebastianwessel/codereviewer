import { describe, expect, test } from 'vitest'
import {
  type ContextRequest,
  type EvidenceRecord
} from '../../shared/contracts/index.js'
import { type ContextRequestArtifacts } from './model-context-artifacts.js'
import { type FindingInvestigationResult } from './model-agent-contracts.js'
import { proofSuspicionSeedForCandidate } from './model-proof-suspicion-seed.js'
import { proofFollowUpStateWithResult } from './model-proof-followup-state.js'
import { type CandidateFinding } from '../admission/index.js'

const candidate: CandidateFinding = {
  id: 'cand_prooffollowup',
  taskId: 'task_prooffollowup',
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

const contextRequest = (
  path: string,
  query: string
): ContextRequest => ({
  tool: 'grep',
  path,
  query,
  reason: `Inspect ${query}.`
})

const evidence = (id: string): EvidenceRecord => ({
  id,
  kind: 'diff',
  summary: `Evidence ${id}`,
  source: 'review-agent',
  redactionApplied: true
})

const artifacts = (...records: EvidenceRecord[]): ContextRequestArtifacts => ({
  evidence: records,
  reviewContext: records.map((record, index) => ({
    kind: 'file',
    path: 'src/task.ts',
    content: `Context ${record.id}`,
    ledgerEntryId: `ctx_${'a'.repeat(7)}${index}`
  }))
})

const investigationOutput: FindingInvestigationResult = {
  verdict: 'needs-more-evidence',
  rationaleSummary: 'Need another caller path.',
  evidenceIds: [],
  contradictionChecks: [],
  contextRequests: [contextRequest('src/caller.ts', 'callChangedBranch')],
  requestedContext: ['Inspect src/task.ts near line 9.', 'Trace the caller.']
}

describe('model proof follow-up state', () => {
  test('appends context requests, dedupes requested context, and merges artifacts', () => {
    const initialRequest = contextRequest('src/task.ts', 'changedBranch')
    const seed = proofSuspicionSeedForCandidate({
      candidate,
      contextRequests: [initialRequest],
      requestedContext: ['Inspect src/task.ts near line 9.']
    })
    const existingEvidence = evidence('ev_existing1')
    const newEvidence = evidence('ev_new1')

    const result = proofFollowUpStateWithResult({
      state: {
        suspicionSeed: seed,
        contextArtifacts: artifacts(existingEvidence)
      },
      investigationOutput,
      followUpArtifacts: artifacts(existingEvidence, newEvidence)
    })

    expect(result.suspicionSeed).toEqual({
      suspicionId: seed.suspicionId,
      contextRequests: [initialRequest, ...investigationOutput.contextRequests],
      requestedContext: ['Inspect src/task.ts near line 9.', 'Trace the caller.']
    })
    expect(result.contextArtifacts.evidence).toEqual([
      existingEvidence,
      newEvidence
    ])
    expect(result.contextArtifacts.reviewContext.map((context) => context.content))
      .toEqual(['Context ev_existing1', 'Context ev_new1'])
  })
})
