// The contract's own coverage rule: every status the vocabulary admits must be a
// status the obligation schema can parse.
//
// A status added to `ObligationStatusSchema` and not to the union is not a
// compile error at the call sites that produce it — the producer types check
// against the enum — it is a run that builds a report and then fails to validate
// it, at the end, after the model calls have been paid for. The union is now
// looked up from the enum so that cannot be written, and this file is the proof
// that the lookup covers the enum rather than merely compiling.

import { describe, expect, test } from 'vitest'
import {
  ObligationSchema,
  ObligationStatusSchema
} from './intent-fulfilment-report.js'

const base = {
  id: 'obl_1',
  source: { origin: 'pull-request', line: 3, text: 'Reject empty names.' },
  statement: 'Reject empty names at the API boundary.'
}

const evidence = [
  { path: 'src/app.ts', line: 4, side: 'added', text: 'if (name === "")' }
]

describe('the obligation contract covers its own vocabulary', () => {
  test('every status the enum admits parses as an obligation', () => {
    const rejected = ObligationStatusSchema.options.filter(
      (status) =>
        !ObligationSchema.safeParse({
          ...base,
          status,
          ...(status === 'evidenced' ? { evidence } : {})
        }).success
    )

    expect(rejected).toEqual([])
    // A vocabulary that lost its members would satisfy the assertion above
    // vacuously, so the count is checked too.
    expect(ObligationStatusSchema.options.length).toBeGreaterThan(3)
  })

  // The asymmetry the union exists for: `evidenced` is the only status carrying
  // evidence, and it must carry some. Deriving the union's members from the enum
  // must not flatten that into one object with an optional field.
  test('an evidenced obligation without a cited line is not an obligation', () => {
    expect(
      ObligationSchema.safeParse({ ...base, status: 'evidenced' }).success
    ).toBe(false)
    expect(
      ObligationSchema.safeParse({ ...base, status: 'evidenced', evidence: [] })
        .success
    ).toBe(false)
  })

  // No other status has anywhere to put a line, which is what makes the absence
  // of evidence readable as "there was none to cite" rather than as an omission.
  test('a status with nothing to cite refuses evidence outright', () => {
    expect(
      ObligationSchema.safeParse({
        ...base,
        status: 'not-contradicted',
        evidence
      }).success
    ).toBe(false)
  })
})
