import { describe, expect, test } from 'vitest'
import { type FindingAggregateResult } from '../../shared/contracts/index.js'
import { aggregateReviewOutcomeForResults } from './model-aggregate-outcome.js'

const aggregateResult = (): FindingAggregateResult => ({
  id: 'agg_outcome',
  scope: 'run',
  verdict: 'mixed',
  summary: 'The aggregate critic found mixed results.',
  candidateIds: ['cand_valid', 'cand_falsepositive', 'cand_weak'],
  evidenceIds: ['ev_aggregate'],
  decisions: [
    {
      candidateId: 'cand_valid',
      verdict: 'valid',
      summary: 'This candidate is valid.',
      evidenceIds: ['ev_valid'],
      relatedCandidateIds: []
    },
    {
      candidateId: 'cand_falsepositive',
      verdict: 'false-positive',
      summary: 'This candidate is refuted by a stronger aggregate proof.',
      evidenceIds: ['ev_falsepositive'],
      relatedCandidateIds: ['cand_valid']
    },
    {
      candidateId: 'cand_weak',
      verdict: 'needs-more-evidence',
      summary: 'This candidate still needs more evidence.',
      evidenceIds: ['ev_weak'],
      relatedCandidateIds: ['cand_valid']
    }
  ],
  similarIssueChecks: []
})

describe('model aggregate outcome', () => {
  test('covers only terminally rejected candidates so valid ones still reach the judge', () => {
    const providerIssue = {
      code: 'provider_timeout',
      stage: 'aggregate-proof-review',
      recovered: true,
      message: 'aggregate timeout'
    }
    const outcome = aggregateReviewOutcomeForResults({
      aggregateResults: [aggregateResult()],
      providerIssues: [providerIssue]
    })

    // A `valid` aggregate verdict no longer "covers" a candidate: it must still
    // flow to the strict per-candidate judge, so only the rejected candidates
    // are covered (skippable by the judge).
    expect([...outcome.coveredCandidateIds]).toEqual([
      'cand_falsepositive',
      'cand_weak'
    ])
    expect([...outcome.rejectedCandidateIds]).toEqual([
      'cand_falsepositive',
      'cand_weak'
    ])
    expect(outcome.rejectedFindings).toEqual([
      expect.objectContaining({
        candidateId: 'cand_falsepositive',
        status: 'rejected',
        reason: 'refuted',
        evidenceIds: ['ev_falsepositive']
      }),
      expect.objectContaining({
        candidateId: 'cand_weak',
        status: 'needs-more-evidence',
        reason: 'insufficient-evidence',
        evidenceIds: ['ev_weak']
      })
    ])
    expect(outcome.admissionDecisions).toEqual([
      {
        candidateId: 'cand_falsepositive',
        status: 'rejected',
        rejectedReason: 'refuted'
      },
      {
        candidateId: 'cand_weak',
        status: 'needs-more-evidence',
        rejectedReason: 'insufficient-evidence'
      }
    ])
    expect(outcome.providerIssues).toEqual([providerIssue])
  })

  test('returns empty sets and pass-through provider issues without aggregate results', () => {
    const outcome = aggregateReviewOutcomeForResults({
      aggregateResults: [],
      providerIssues: []
    })

    expect(outcome.aggregateResults).toEqual([])
    expect(outcome.rejectedFindings).toEqual([])
    expect(outcome.admissionDecisions).toEqual([])
    expect([...outcome.rejectedCandidateIds]).toEqual([])
    expect([...outcome.coveredCandidateIds]).toEqual([])
    expect(outcome.providerIssues).toEqual([])
  })
})
