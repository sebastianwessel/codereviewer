import { describe, expect, test } from 'vitest'
import {
  REJECTED_FINDING_MESSAGE_MAX,
  RejectedFindingSchema
} from './finding.schema.js'

// Regression guard for the cap drift where model-authored rejection summaries
// (capped at 1200 upstream) flowed into `RejectedFinding.message` (capped at 500)
// without truncation, failing schema validation and aborting the run as a
// spurious provider error. The contract enforces the cap (so it stays
// representable in the generated JSON Schema) and every construction site must
// truncate model text to `REJECTED_FINDING_MESSAGE_MAX` before parsing.
//
// The other half of that guard — that the refutation construction sites actually
// truncate — lives with the code it guards, in
// `domains/review-workflow/pipeline/refutation/refutation-text-cap-drift.test.ts`,
// because asserting it here would make `shared` import from `domains`.
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
})
