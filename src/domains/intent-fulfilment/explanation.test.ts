// The explanation is prose over an already-frozen mapping, and the only part of the
// report a reader can take as a complete account without checking anything. What it
// must never do is END EARLY WITHOUT SAYING SO: an account whose last clause was
// "…but nothing evidences the audit-log requirement" reads as finished once that
// clause is gone.

import { describe, expect, test } from 'vitest'
import { normalizeFulfilmentExplanation } from './explanation.js'
import { IntentFulfilmentReportSchema } from './intent-fulfilment-report.js'

describe('normalizeFulfilmentExplanation', () => {
  test('marks prose it had to cut, and stays inside the contract cap', () => {
    const explanation = normalizeFulfilmentExplanation({
      explanation: `${'The change rejects old tokens. '.repeat(80)}Nothing evidences the audit log.`
    })

    expect(explanation).toHaveLength(2_000)
    expect(explanation?.endsWith('…')).toBe(true)
    // The mark is spent out of the cap rather than added to it: the report schema
    // caps `explanation` at 2000, and a disclosure that fails validation costs the
    // whole explanation instead of disclosing anything.
    expect(() =>
      IntentFulfilmentReportSchema.shape.explanation.parse(explanation)
    ).not.toThrow()
  })

  test('leaves prose that fits as the model wrote it', () => {
    expect(
      normalizeFulfilmentExplanation({
        explanation: '  One obligation is covered; the audit log is not.  '
      })
    ).toBe('One obligation is covered; the audit log is not.')
  })

  test.each([
    ['a malformed answer', 'explanation'],
    ['an answer with no explanation field', {}],
    ['an empty explanation', { explanation: '   ' }]
  ])('resolves %s to no explanation rather than throwing', (_name, value) => {
    expect(normalizeFulfilmentExplanation(value)).toBeUndefined()
  })
})
