import { describe, expect, test } from 'vitest'
import {
  REJECTED_FINDING_MESSAGE_MAX,
  RejectedFindingSchema
} from './finding.schema.js'
import { aggregateReviewOutcomeForResults } from '../../../domains/review-workflow/model-aggregate-outcome.js'

// Regression guard for the cap drift where model-authored rejection summaries
// (capped at 1200 upstream) flowed into `RejectedFinding.message` (capped at 500)
// without truncation, failing schema validation and aborting the run as a
// spurious provider error. The contract enforces the cap (so it stays
// representable in the generated JSON Schema) and every construction site must
// truncate model text to `REJECTED_FINDING_MESSAGE_MAX` before parsing.
describe('contract text cap drift guard', () => {
  test('RejectedFinding.message enforces the message cap', () => {
    expect(
      RejectedFindingSchema.safeParse({
        candidateId: 'cand_0a1b2c3d4e5f6071',
        status: 'rejected',
        reason: 'refuted',
        message: 'x'.repeat(REJECTED_FINDING_MESSAGE_MAX + 1)
      }).success
    ).toBe(false)
  })

  test('aggregate-critic rejections truncate over-long model summaries', () => {
    // An aggregate decision summary longer than the cap must not abort the run:
    // the construction site truncates it so the RejectedFinding parses.
    const outcome = aggregateReviewOutcomeForResults({
      aggregateResults: [
        {
          id: 'agg_0a1b2c3d4e5f6071',
          scope: 'run',
          verdict: 'mixed',
          summary: 'Batch review summary.',
          candidateIds: ['cand_0a1b2c3d4e5f6071'],
          evidenceIds: ['ev_0a1b2c3d4e5f6071'],
          decisions: [
            {
              candidateId: 'cand_0a1b2c3d4e5f6071',
              verdict: 'false-positive',
              summary: 'y'.repeat(2000),
              evidenceIds: ['ev_0a1b2c3d4e5f6071'],
              relatedCandidateIds: []
            }
          ],
          similarIssueChecks: []
        }
      ],
      providerIssues: []
    })

    expect(outcome.rejectedFindings).toHaveLength(1)
    expect(
      outcome.rejectedFindings[0]!.message.length
    ).toBeLessThanOrEqual(REJECTED_FINDING_MESSAGE_MAX)
  })
})
