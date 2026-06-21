import { describe, expect, test } from 'vitest'
import { calculateTokenCost, summarizeRunCost } from './token-cost.js'

describe('token cost tracking', () => {
  test('calculates configured token costs', () => {
    expect(
      calculateTokenCost({
        inputTokens: 1000,
        outputTokens: 250,
        prices: {
          inputPerMillion: 0.5,
          outputPerMillion: 2,
          currency: 'USD'
        }
      })
    ).toEqual({
      inputTokens: 1000,
      outputTokens: 250,
      totalTokens: 1250,
      costUsd: 0.001,
      costSource: 'configured'
    })
  })

  test('reports unavailable cost while preserving token counts', () => {
    expect(
      calculateTokenCost({
        inputTokens: 12,
        outputTokens: 8,
        prices: {}
      })
    ).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      costUsd: null,
      costSource: 'unavailable'
    })
  })

  test('rejects invalid token counts', () => {
    expect(() =>
      calculateTokenCost({
        inputTokens: -1,
        outputTokens: 0,
        prices: {}
      })
    ).toThrow(TypeError)
  })
})

describe('run cost summary', () => {
  test('records no cost or warning for deterministic runs without a provider', () => {
    expect(summarizeRunCost({ providerConfigured: false, prices: {} })).toEqual({
      warnings: []
    })
  })

  test('warns when a provider run has no surfaced token usage', () => {
    expect(
      summarizeRunCost({ providerConfigured: true, prices: {} })
    ).toEqual({ warnings: ['cost-unavailable'] })
  })

  test('computes cost from usage and configured prices', () => {
    expect(
      summarizeRunCost({
        providerConfigured: true,
        prices: { inputPerMillion: 1, outputPerMillion: 2, currency: 'USD' },
        usage: { inputTokens: 1_000_000, outputTokens: 500_000 }
      })
    ).toEqual({ warnings: [], costUsd: 2, inputTokens: 1_000_000, outputTokens: 500_000 })
  })

  test('warns but keeps token counts when prices are unavailable', () => {
    expect(
      summarizeRunCost({
        providerConfigured: true,
        prices: {},
        usage: { inputTokens: 10, outputTokens: 5 }
      })
    ).toEqual({ warnings: ['cost-unavailable'], inputTokens: 10, outputTokens: 5 })
  })
})

