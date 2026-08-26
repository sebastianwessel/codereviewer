import { describe, expect, test } from 'vitest'
import {
  REJECTED_FINDING_MESSAGE_MAX,
  RefutationResultSchema,
  RejectedFindingSchema
} from '../../../../shared/contracts/index.js'
import { stringFieldBound } from '../../../../shared/text/truncate.js'
import { FindingRefutationResultSchema } from '../agent-contracts.js'
import { activeRefutationResultForCandidate } from './result.js'
import { refutedCandidateOutcome } from './verdict-outcome.js'

// Where the refutation rationale's caps are guarded.
//
// These three guards each need one side from `shared/contracts` (or
// `shared/text`) and one side from this domain: the schema states the cap, the
// construction site here has to respect it. They used to live beside the shared
// half, which made `src/shared/**` import `domains/review-workflow/**` — the one
// direction spec 01 forbids outright ("`shared` must not import from
// `domains`"). The dependency only runs one way from here, so this is the side
// that can hold them.
//
// Widening `review-workflow`'s barrel to let the shared tests reach in was the
// alternative and is the wrong direction: that barrel publishes five names, and
// `src/index.ts` names all five on the package's public surface.

// Regression guard for the cap drift where model-authored rejection summaries
// (capped at 1200 upstream) flowed into `RejectedFinding.message` (capped at 500)
// without truncation, failing schema validation and aborting the run as a
// spurious provider error. The contract enforces the cap (so it stays
// representable in the generated JSON Schema) and every construction site must
// truncate model text to `REJECTED_FINDING_MESSAGE_MAX` before parsing.
describe('contract text cap drift guard', () => {
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
      kind: 'model-rationale' as const,
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

describe('contract bounds sized to the refutation rationale', () => {
  // The rule the values follow, asserted as a rule rather than as seven numbers.
  //
  // A destination smaller than its only producer does not guard against a runaway
  // model — it guarantees a cut on ordinary output. Every field the refuter's
  // 1200-character rationale flows into is therefore at least 1200. Two were not:
  // `RefutationResult.summary` at 1000 and `RejectedFinding.message` at 500,
  // which discarded 16% and 58% of the argument respectively.
  test('nothing the refutation rationale flows into is smaller than the rationale', () => {
    const rationaleBound = stringFieldBound(
      FindingRefutationResultSchema.shape.rationaleSummary
    )

    expect(stringFieldBound(RefutationResultSchema.shape.summary)).toBeGreaterThanOrEqual(
      rationaleBound
    )
    expect(
      stringFieldBound(RejectedFindingSchema.shape.message)
    ).toBeGreaterThanOrEqual(rationaleBound)
  })

  // The counterweight, so "size it to the producer" does not become "make every
  // cap enormous". A check summary is NOT fed the rationale — it states which
  // check ran, while the rationale sits one line above it in full — so it stays
  // small on purpose. Raising it would print the same argument twice.
  test('a field that is not fed the rationale stays small', () => {
    expect(
      stringFieldBound(RefutationResultSchema.shape.checks.element.shape.summary)
    ).toBe(500)
  })
})
