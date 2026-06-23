import { describe, expect, test } from 'vitest'
import { RejectedFindingSchema } from './finding.schema.js'

// Regression guard for the cap drift where model-authored rejection summaries
// (capped at 1200 upstream) flowed into `RejectedFinding.message` (capped at 500)
// without truncation, failing schema validation and aborting the run as a
// spurious provider error. The contract field must truncate defensively.
describe('contract text cap drift guard', () => {
  test('RejectedFinding.message accepts and truncates over-long model text', () => {
    const result = RejectedFindingSchema.safeParse({
      candidateId: 'cand_0a1b2c3d4e5f6071',
      status: 'rejected',
      reason: 'refuted',
      message: 'x'.repeat(2000)
    })

    expect(result.success).toBe(true)
    expect(result.success && result.data.message.length).toBeLessThanOrEqual(500)
  })

  test('RejectedFinding.message keeps short messages intact', () => {
    const result = RejectedFindingSchema.safeParse({
      candidateId: 'cand_0a1b2c3d4e5f6071',
      status: 'needs-more-evidence',
      reason: 'insufficient-evidence',
      message: 'Refutation could not decide the verdict from the provided context.'
    })

    expect(result.success).toBe(true)
    expect(result.success && result.data.message).toBe(
      'Refutation could not decide the verdict from the provided context.'
    )
  })
})
