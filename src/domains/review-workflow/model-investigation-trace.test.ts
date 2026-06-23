import { describe, expect, test } from 'vitest'
import type { EvidenceRecord } from '../../shared/contracts/index.js'
import { investigationTraceForContextArtifacts } from './model-investigation-trace.js'
import type { ContextRequestArtifacts } from './model-context-artifacts.js'

const readEvidence: EvidenceRecord = {
  id: 'ev_trace',
  kind: 'tool-read',
  summary: 'Read the changed file and confirmed the guard is reachable.',
  location: { path: 'src/a.ts', startLine: 4, side: 'file' },
  source: 'context-retrieval',
  rawContentRef: 'ctx_aaaaaaaa',
  redactionApplied: true
}

const searchEvidence: EvidenceRecord = {
  id: 'ev_search',
  kind: 'tool-search',
  summary: 'Searched for sibling callers.',
  source: 'context-retrieval',
  rawContentRef: 'ctx_bbbbbbbb',
  redactionApplied: true
}

const contextArtifacts: ContextRequestArtifacts = {
  evidence: [readEvidence, searchEvidence],
  reviewContext: [
    {
      kind: 'file',
      path: 'src/a.ts',
      content: 'redacted',
      ledgerEntryId: 'ctx_aaaaaaaa'
    },
    {
      kind: 'support-signal-output',
      content: 'redacted',
      ledgerEntryId: 'ctx_bbbbbbbb'
    },
    {
      kind: 'file',
      path: 'src/a.ts',
      content: 'duplicate',
      ledgerEntryId: 'ctx_aaaaaaaa'
    }
  ]
}

describe('model investigation trace', () => {
  test('creates trace records from retrieved context artifacts and retrieval budget', () => {
    const trace = investigationTraceForContextArtifacts({
      suspicionId: 'susp_trace',
      contextArtifacts,
      retrievalBudget: {
        maxReads: 5,
        usedReads: 0,
        maxSearches: 4,
        usedSearches: 0,
        maxBytesPerRead: 2000,
        maxMatches: 20
      },
      usedRounds: 2,
      maxRounds: 3,
      result: 'proof'
    })

    expect(trace).toEqual({
      suspicionId: 'susp_trace',
      toolCalls: [
        {
          tool: 'tool-read',
          status: 'completed',
          ledgerEntryId: 'ctx_aaaaaaaa',
          summary: readEvidence.summary
        },
        {
          tool: 'tool-search',
          status: 'completed',
          ledgerEntryId: 'ctx_bbbbbbbb',
          summary: searchEvidence.summary
        }
      ],
      contextLedgerEntryIds: ['ctx_aaaaaaaa', 'ctx_bbbbbbbb'],
      budget: {
        maxReads: 5,
        usedReads: 1,
        maxSearches: 4,
        usedSearches: 1,
        maxRounds: 3,
        usedRounds: 2
      },
      result: 'proof'
    })
  })
})
