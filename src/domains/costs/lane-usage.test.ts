import { describe, expect, test } from 'vitest'
import { LaneUsageSchema, summarizeLaneUsage } from './lane-usage.js'

const prices = { inputPerMillion: 1, outputPerMillion: 2 }

describe('summarizeLaneUsage', () => {
  test('prices the usage and reports it in the schema shape', () => {
    const usage = summarizeLaneUsage({
      usage: { inputTokens: 1_000_000, outputTokens: 500_000 },
      providerId: 'openai',
      modelName: 'test-model',
      prices
    })

    expect(usage).toEqual({
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      costUsd: 2
    })
    expect(LaneUsageSchema.parse(usage)).toEqual(usage)
  })

  test('omits the optional token fields rather than zeroing them', () => {
    // A zeroed `cachedInputTokens` and a missing one mean different things: the
    // first says the provider reported no cache hit, the second says it reported
    // nothing at all.
    const usage = summarizeLaneUsage({
      usage: { inputTokens: 10, outputTokens: 4 },
      prices
    })

    expect(Object.hasOwn(usage, 'cachedInputTokens')).toBe(false)
    expect(Object.hasOwn(usage, 'reasoningTokens')).toBe(false)
  })

  test('passes cached and reasoning tokens through when the provider reported them', () => {
    expect(
      summarizeLaneUsage({
        usage: {
          inputTokens: 100,
          outputTokens: 10,
          cachedInputTokens: 40,
          reasoningTokens: 7
        },
        prices
      })
    ).toMatchObject({ cachedInputTokens: 40, reasoningTokens: 7 })
  })

  test('omits costUsd when the cost could not be determined', () => {
    // Missing pricing must stay visible as an absent cost rather than read as a
    // free run.
    const usage = summarizeLaneUsage({
      usage: { inputTokens: 10, outputTokens: 4 },
      prices: {}
    })

    expect(Object.hasOwn(usage, 'costUsd')).toBe(false)
    expect(LaneUsageSchema.parse(usage)).toEqual({
      inputTokens: 10,
      outputTokens: 4
    })
  })
})
