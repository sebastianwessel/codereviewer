import { describe, expect, test } from 'vitest'
import {
  REJECTED_FINDING_MESSAGE_MAX,
  RejectedFindingSchema
} from './finding.schema.js'
import { activeRefutationResultForCandidate } from '../../../domains/review-workflow/model-admission-refutation-result.js'
import { refutedCandidateOutcome } from '../../../domains/review-workflow/model-admission-refutation-verdict-outcome.js'

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

  test('refuted-candidate rejections truncate over-long model summaries', () => {
    // A refutation rationale longer than the cap must not abort the run: the
    // construction site truncates it so the RejectedFinding parses.
    const candidate = {
      id: 'cand_0a1b2c3d4e5f6071',
      taskId: 'task_0a1b2c3d4e5f6071',
      category: 'bug' as const,
      severity: 'high' as const,
      title: 'Refuted candidate',
      description: 'A candidate that the refuter contradicts.',
      location: {
        path: 'src/app.ts',
        startLine: 4,
        side: 'new' as const
      },
      evidenceIds: ['ev_0a1b2c3d4e5f6071'],
      proposedBy: 'review-agent'
    }
    const refutation = {
      verdict: 'refuted' as const,
      rationaleSummary: 'y'.repeat(1200)
    }
    const refutationEvidence = {
      id: 'ev_refutation0a1b2c3d',
      kind: 'refutation' as const,
      summary: 'Refutation evidence.',
      source: 'refutation',
      redactionApplied: true
    }
    const outcome = refutedCandidateOutcome({
      candidate,
      refutation,
      refutationEvidence,
      refutationResult: activeRefutationResultForCandidate({
        candidate,
        refutation,
        refutationEvidence
      })
    })

    expect(outcome.rejectedFindings).toHaveLength(1)
    expect(
      outcome.rejectedFindings[0]!.message.length
    ).toBeLessThanOrEqual(REJECTED_FINDING_MESSAGE_MAX)
  })
})
