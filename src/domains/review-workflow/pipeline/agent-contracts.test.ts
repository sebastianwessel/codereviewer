import { describe, expect, test } from 'vitest'
import {
  ModelContextScoutResultSchema,
  contextScoutRequests
} from './agent-contracts.js'

describe('contextScoutRequests', () => {
  test('returns nothing for an absent or empty request list', () => {
    expect(contextScoutRequests(ModelContextScoutResultSchema.parse({}))).toEqual(
      []
    )
    expect(
      contextScoutRequests(
        ModelContextScoutResultSchema.parse({ requests: [] })
      )
    ).toEqual([])
  })

  test('normalizes the field aliases models actually emit', () => {
    expect(
      contextScoutRequests({
        requests: [
          { symbol: 'applyDiscount', file: 'src/pricing.ts', why: 'caps the rate' },
          {
            symbol_name: '  parseAmount  ',
            declared_in: 'src/money.ts',
            rationale: 'rounding contract'
          },
          { identifier: 'Rate', filePath: 'src/rate.ts', justification: 'shape' }
        ]
      })
    ).toEqual([
      { name: 'applyDiscount', path: 'src/pricing.ts', reason: 'caps the rate' },
      { name: 'parseAmount', path: 'src/money.ts', reason: 'rounding contract' },
      { name: 'Rate', path: 'src/rate.ts', reason: 'shape' }
    ])
  })

  test('keeps a request whose path or reason is unusable', () => {
    // The path is only a resolution hint and the reason is only for humans, so
    // neither may cost the reviewer the symbol itself.
    expect(
      contextScoutRequests({
        requests: [
          { name: 'chargeCard', path: '../outside/secrets.ts' },
          { name: 'refund', path: '/etc/passwd', reason: 42 },
          { name: 'settle' }
        ]
      })
    ).toEqual([{ name: 'chargeCard' }, { name: 'refund' }, { name: 'settle' }])
  })

  test('de-duplicates on the (name, path) pair and keeps the first, best-ranked entry', () => {
    expect(
      contextScoutRequests({
        requests: [
          { name: 'applyDiscount', path: 'src/pricing.ts', reason: 'first' },
          { name: 'applyDiscount', path: 'src/pricing.ts', reason: 'repeat' },
          // The same name in a different file is a DIFFERENT symbol.
          { name: 'applyDiscount', path: 'src/legacy/pricing.ts' },
          { name: 'applyDiscount' }
        ]
      })
    ).toEqual([
      { name: 'applyDiscount', path: 'src/pricing.ts', reason: 'first' },
      { name: 'applyDiscount', path: 'src/legacy/pricing.ts' },
      { name: 'applyDiscount' }
    ])
  })

  test('drops junk entries without losing the valid ones around them', () => {
    expect(
      contextScoutRequests({
        requests: [
          null,
          'applyDiscount',
          ['applyDiscount'],
          {},
          { name: '' },
          { name: '   ' },
          { name: 7 },
          { reason: 'no symbol named' },
          { name: 'settleInvoice', path: 'src/billing.ts' }
        ]
      })
    ).toEqual([{ name: 'settleInvoice', path: 'src/billing.ts' }])
  })
})
