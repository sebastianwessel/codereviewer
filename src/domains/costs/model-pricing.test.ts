import { describe, expect, test } from 'vitest'
import { builtInPricesFor } from './model-pricing.js'

describe('model pricing snapshot lookup', () => {
  test('returns OpenAI model pricing from the bundled snapshot', () => {
    expect(
      builtInPricesFor({
        providerId: 'openai',
        modelName: 'gpt-5-mini'
      })
    ).toEqual({
      inputPerMillion: 0.25,
      outputPerMillion: 2,
      currency: 'USD'
    })
  })

  test('matches snapshot model aliases by longest prefix', () => {
    expect(
      builtInPricesFor({
        providerId: 'openai',
        modelName: 'gpt-5.4-mini-2026-03-17'
      })
    ).toEqual({
      inputPerMillion: 0.75,
      outputPerMillion: 4.5,
      currency: 'USD'
    })
  })

  test('returns OpenAI pricing for public Codex model aliases missing from the upstream snapshot', () => {
    expect(
      builtInPricesFor({
        providerId: 'openai',
        modelName: 'gpt-5.3-codex'
      })
    ).toEqual({
      inputPerMillion: 1.75,
      outputPerMillion: 14,
      currency: 'USD'
    })
  })

  test('does not apply OpenAI public pricing to OpenAI-compatible providers', () => {
    expect(
      builtInPricesFor({
        providerId: 'openai-compatible',
        modelName: 'gpt-5-mini'
      })
    ).toEqual({})
  })
})
