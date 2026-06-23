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
          outputPerMillion: 2
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
        prices: { inputPerMillion: 1, outputPerMillion: 2 },
        usage: { inputTokens: 1_000_000, outputTokens: 500_000 }
      })
    ).toEqual({ warnings: [], costUsd: 2, inputTokens: 1_000_000, outputTokens: 500_000 })
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
    ).toEqual({ warnings: [], costUsd: 1.25, inputTokens: 1_000_000, outputTokens: 500_000 })
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
    ).toEqual({ warnings: [], costUsd: 5.25, inputTokens: 1_000_000, outputTokens: 1_000_000 })
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
    ).toEqual({ warnings: [], costUsd: 15.75, inputTokens: 1_000_000, outputTokens: 1_000_000 })
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
