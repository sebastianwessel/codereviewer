import { describe, expect, test } from 'vitest'
import {
  calculateTokenCost,
  combineRunTokenUsage,
  summarizeRunCost
} from './token-cost.js'

describe('combineRunTokenUsage', () => {
  test('returns the other side when one is undefined', () => {
    const usage = { inputTokens: 5, outputTokens: 2 }
    expect(combineRunTokenUsage(usage, undefined)).toBe(usage)
    expect(combineRunTokenUsage(undefined, usage)).toBe(usage)
    expect(combineRunTokenUsage(undefined, undefined)).toBeUndefined()
  })

  test('sums token fields, keeping cached as a subset', () => {
    expect(
      combineRunTokenUsage(
        { inputTokens: 100, outputTokens: 20, cachedInputTokens: 10 },
        { inputTokens: 40, outputTokens: 8, reasoningTokens: 3 }
      )
    ).toEqual({
      inputTokens: 140,
      outputTokens: 28,
      cachedInputTokens: 10,
      reasoningTokens: 3
    })
  })
})

describe('token cost tracking', () => {
  test('calculates configured token costs', () => {
    expect(
      calculateTokenCost({
        inputTokens: 1000,
        outputTokens: 250,
        prices: {
          inputPerMillion: 0.5,
          outputPerMillion: 2
        }
      })
    ).toEqual({
      inputTokens: 1000,
      outputTokens: 250,
      cachedInputTokens: 0,
      totalTokens: 1250,
      costUsd: 0.001,
      costSource: 'configured'
    })
  })

  test('discounts cached input tokens at the cached rate when configured', () => {
    // 1000 input of which 400 cached. Non-cached 600 @ 1.0 + cached 400 @ 0.25
    // + output 250 @ 2.0 = 0.0006 + 0.0001 + 0.0005 = 0.0012.
    expect(
      calculateTokenCost({
        inputTokens: 1000,
        cachedInputTokens: 400,
        outputTokens: 250,
        prices: {
          inputPerMillion: 1,
          cachedInputPerMillion: 0.25,
          outputPerMillion: 2
        }
      })
    ).toEqual({
      inputTokens: 1000,
      outputTokens: 250,
      cachedInputTokens: 400,
      totalTokens: 1250,
      costUsd: 0.0012,
      costSource: 'configured'
    })
  })

  test('prices cached input at the full input rate when no cached rate is known', () => {
    // No cachedInputPerMillion: cached tokens fall back to the full input price,
    // so cost matches the non-cached case (1000 @ 1.0 + 250 @ 2.0 = 0.0015).
    expect(
      calculateTokenCost({
        inputTokens: 1000,
        cachedInputTokens: 400,
        outputTokens: 250,
        prices: {
          inputPerMillion: 1,
          outputPerMillion: 2
        }
      })
    ).toEqual({
      inputTokens: 1000,
      outputTokens: 250,
      cachedInputTokens: 400,
      totalTokens: 1250,
      costUsd: 0.0015,
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
      cachedInputTokens: 0,
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

  test('rejects cached input tokens exceeding input tokens', () => {
    expect(() =>
      calculateTokenCost({
        inputTokens: 10,
        cachedInputTokens: 11,
        outputTokens: 0,
        prices: {}
      })
    ).toThrow(RangeError)
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
        prices: { inputPerMillion: 1, outputPerMillion: 2 },
        usage: { inputTokens: 1_000_000, outputTokens: 500_000 }
      })
    ).toEqual({
      warnings: [],
      costUsd: 2,
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      cachedInputTokens: 0
    })
  })

  test('discounts cached input tokens when a cached price is configured', () => {
    // 1M input of which 400k cached. 600k @ 1.0 + 400k @ 0.25 + 500k @ 2.0
    // = 0.6 + 0.1 + 1.0 = 1.7.
    expect(
      summarizeRunCost({
        providerConfigured: true,
        prices: { inputPerMillion: 1, cachedInputPerMillion: 0.25, outputPerMillion: 2 },
        usage: {
          inputTokens: 1_000_000,
          cachedInputTokens: 400_000,
          outputTokens: 500_000
        }
      })
    ).toEqual({
      warnings: [],
      costUsd: 1.7,
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      cachedInputTokens: 400_000
    })
  })

  test('computes cost from built-in OpenAI model prices when explicit prices are absent', () => {
    expect(
      summarizeRunCost({
        providerConfigured: true,
        providerId: 'openai',
        modelName: 'gpt-5-mini',
        prices: {},
        usage: { inputTokens: 1_000_000, outputTokens: 500_000 }
      })
    ).toEqual({
      warnings: [],
      costUsd: 1.25,
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      cachedInputTokens: 0
    })
  })

  test('computes cost for built-in OpenAI snapshot aliases', () => {
    expect(
      summarizeRunCost({
        providerConfigured: true,
        providerId: 'openai',
        modelName: 'gpt-5.4-mini-2026-03-17',
        prices: {},
        usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 }
      })
    ).toEqual({
      warnings: [],
      costUsd: 5.25,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cachedInputTokens: 0
    })
  })

  test('computes cost for supplemental OpenAI Codex model prices', () => {
    expect(
      summarizeRunCost({
        providerConfigured: true,
        providerId: 'openai',
        modelName: 'gpt-5.3-codex',
        prices: {},
        usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 }
      })
    ).toEqual({
      warnings: [],
      costUsd: 15.75,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cachedInputTokens: 0
    })
  })

  test('warns but keeps token counts when prices are unavailable', () => {
    expect(
      summarizeRunCost({
        providerConfigured: true,
        prices: {},
        usage: { inputTokens: 10, outputTokens: 5 }
      })
    ).toEqual({
      warnings: ['cost-unavailable'],
      inputTokens: 10,
      outputTokens: 5,
      cachedInputTokens: 0
    })
  })
})
