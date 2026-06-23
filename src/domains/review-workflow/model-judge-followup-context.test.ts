import { describe, expect, test } from 'vitest'
import { type EvidenceRecord } from '../../shared/contracts/index.js'
import { type ReviewContextDocument } from './model-agent-contracts.js'
import { judgeFollowUpContextStateWithArtifacts } from './model-judge-followup-context.js'

const evidence = (id: string): EvidenceRecord => ({
  id,
  kind: 'judge',
  summary: `Evidence ${id}`,
  source: 'review-agent',
  redactionApplied: true
})

const reviewContext = (
  ledgerEntryId: string,
  content: string
): ReviewContextDocument => ({
  kind: 'file',
  path: 'src/judge.ts',
  content,
  ledgerEntryId
})

describe('model judge follow-up context', () => {
  test('adds new evidence while deduping requested IDs and review context', () => {
    const existingEvidence = evidence('ev_existing1')
    const priorFollowUpEvidence = evidence('ev_prior1')
    const newEvidence = evidence('ev_new1')
    const existingContext = reviewContext('ctx_aaaaaaaa', 'existing context')
    const newContext = reviewContext('ctx_bbbbbbbb', 'new context')

    expect(
      judgeFollowUpContextStateWithArtifacts({
        state: {
          workingEvidence: [existingEvidence, priorFollowUpEvidence],
          additionalEvidence: [priorFollowUpEvidence],
          additionalEvidenceIds: ['ev_prior1'],
          additionalReviewContext: [existingContext]
        },
        contextArtifacts: {
          evidence: [existingEvidence, priorFollowUpEvidence, newEvidence],
          reviewContext: [existingContext, newContext]
        }
      })
    ).toEqual({
      workingEvidence: [existingEvidence, priorFollowUpEvidence, newEvidence],
      additionalEvidence: [priorFollowUpEvidence, newEvidence],
      additionalEvidenceIds: ['ev_prior1', 'ev_existing1', 'ev_new1'],
      additionalReviewContext: [existingContext, newContext]
    })
  })
})
