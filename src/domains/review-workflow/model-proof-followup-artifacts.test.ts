import { describe, expect, test } from 'vitest'
import { type ContextRequestArtifacts } from './model-context-artifacts.js'
import { proofFollowUpArtifactsAreUsable } from './model-proof-followup-artifacts.js'

const artifacts = (
  evidenceCount: number,
  reviewContextCount: number
): ContextRequestArtifacts => ({
  evidence: Array.from({ length: evidenceCount }, (_, index) => ({
    id: `ev_followup${index}`,
    kind: 'tool-read' as const,
    summary: `Evidence ${index}`,
    source: 'proof-loop',
    redactionApplied: false
  })),
  reviewContext: Array.from({ length: reviewContextCount }, (_, index) => ({
    kind: 'file' as const,
    path: `src/file-${index}.ts`,
    content: `content ${index}`,
    ledgerEntryId: `ledger_followup${index}`
  }))
})

describe('model proof follow-up artifacts', () => {
  test('rejects missing or empty follow-up artifacts', () => {
    expect(proofFollowUpArtifactsAreUsable(undefined)).toBe(false)
    expect(proofFollowUpArtifactsAreUsable(artifacts(0, 0))).toBe(false)
  })

  test('accepts follow-up artifacts with evidence or review context', () => {
    expect(proofFollowUpArtifactsAreUsable(artifacts(1, 0))).toBe(true)
    expect(proofFollowUpArtifactsAreUsable(artifacts(0, 1))).toBe(true)
  })
})
