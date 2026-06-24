import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../../shared/contracts/index.js'
import {
  aiReviewBudgetFor,
  contextBudgetFor,
  sourceChunkBudgetFor,
  taskInputBudgetFor
} from './review-runner-budgets.js'

const provider = {
  id: 'openai' as const,
  model: 'review-model'
}

describe('review runner budgets', () => {
  test('uses depth defaults when no provider is configured', () => {
    const fast = CodeReviewerConfigSchema.parse({ review: { depth: 'fast' } })
    const balanced = CodeReviewerConfigSchema.parse({})
    const thorough = CodeReviewerConfigSchema.parse({
      review: { depth: 'thorough' }
    })

    expect(contextBudgetFor(fast)).toBe(100000)
    expect(contextBudgetFor(balanced)).toBe(200000)
    expect(contextBudgetFor(thorough)).toBe(500000)
    expect(taskInputBudgetFor(balanced)).toBeUndefined()
  })

  test('caps provider context and task input budgets while honoring explicit limits', () => {
    const defaultProvider = CodeReviewerConfigSchema.parse({
      provider,
      review: { depth: 'thorough' }
    })
    const smallerExplicit = CodeReviewerConfigSchema.parse({
      provider,
      review: { contextMaxBytes: 30000 }
    })
    const largerExplicit = CodeReviewerConfigSchema.parse({
      provider,
      review: { contextMaxBytes: 120000 }
    })

    // thorough depth cap is now 240 000; depth-default context budget is 500 000
    // so the provider cap (240 000) is the binding constraint
    expect(contextBudgetFor(defaultProvider)).toBe(240000)
    expect(taskInputBudgetFor(defaultProvider)).toBe(360000)
    expect(contextBudgetFor(smallerExplicit)).toBe(30000)
    expect(taskInputBudgetFor(smallerExplicit)).toBe(30000)
    expect(contextBudgetFor(largerExplicit)).toBe(120000)
    // explicit contextMaxBytes caps task input too: min(120 000, 360 000) = 120 000
    expect(taskInputBudgetFor(largerExplicit)).toBe(120000)
  })

  test('scales provider context budget by depth', () => {
    const fastProvider = CodeReviewerConfigSchema.parse({
      provider,
      review: { depth: 'fast' }
    })
    const balancedProvider = CodeReviewerConfigSchema.parse({
      provider,
      review: { depth: 'balanced' }
    })
    const thoroughProvider = CodeReviewerConfigSchema.parse({
      provider,
      review: { depth: 'thorough' }
    })

    // fast: min(100 000 default, 60 000 provider cap) = 60 000
    expect(contextBudgetFor(fastProvider)).toBe(60000)
    // balanced: min(200 000 default, 120 000 provider cap) = 120 000
    expect(contextBudgetFor(balancedProvider)).toBe(120000)
    // thorough: min(500 000 default, 240 000 provider cap) = 240 000
    expect(contextBudgetFor(thoroughProvider)).toBe(240000)
  })

  test('derives source chunk budget from the smaller runtime packet budget', () => {
    const withoutProvider = CodeReviewerConfigSchema.parse({
      review: { contextMaxBytes: 10000 }
    })
    const withProvider = CodeReviewerConfigSchema.parse({
      provider,
      review: { contextMaxBytes: 120000 }
    })

    // withoutProvider: no provider, packet = context = 10 000 → floor(10 000 * 0.45) = 4 500
    expect(sourceChunkBudgetFor(withoutProvider)).toBe(4500)
    // withProvider: context = 120 000 (explicit), packet = min(120 000, 360 000) = 120 000
    // chunk = floor(min(120 000, 120 000) * 0.45) = 54 000
    expect(sourceChunkBudgetFor(withProvider)).toBe(54000)
  })

  test('derives AI review retrieval budget from per-depth caps', () => {
    const fastBudget = aiReviewBudgetFor(
      CodeReviewerConfigSchema.parse({ review: { depth: 'fast' } })
    )
    const balancedBudget = aiReviewBudgetFor(
      CodeReviewerConfigSchema.parse({ review: { depth: 'balanced' } })
    )
    const thoroughBudget = aiReviewBudgetFor(
      CodeReviewerConfigSchema.parse({ review: { depth: 'thorough' } })
    )
    const explicitContextBudget = aiReviewBudgetFor(
      CodeReviewerConfigSchema.parse({
        review: { contextMaxBytes: 10000 }
      })
    )

    expect(fastBudget).toEqual({
      contextRetrievalBudget: {
        maxReads: 200,
        usedReads: 0,
        maxSearches: 100,
        usedSearches: 0,
        maxBytesPerRead: 60000,
        maxMatches: 50
      }
    })
    expect(balancedBudget).toEqual({
      contextRetrievalBudget: {
        maxReads: 1200,
        usedReads: 0,
        maxSearches: 600,
        usedSearches: 0,
        maxBytesPerRead: 120000,
        maxMatches: 150
      }
    })
    expect(thoroughBudget).toEqual({
      contextRetrievalBudget: {
        maxReads: 4800,
        usedReads: 0,
        maxSearches: 2400,
        usedSearches: 0,
        maxBytesPerRead: 240000,
        maxMatches: 320
      }
    })
    // explicit contextMaxBytes caps maxBytesPerRead at balanced depth (default)
    expect(explicitContextBudget).toEqual({
      contextRetrievalBudget: {
        maxReads: 1200,
        usedReads: 0,
        maxSearches: 600,
        usedSearches: 0,
        maxBytesPerRead: 10000,
        maxMatches: 150
      }
    })
    expect(fastBudget).not.toHaveProperty('maxSuspicionsPerTask')
    expect(fastBudget).not.toHaveProperty('maxInvestigationsPerRun')
    expect(fastBudget).not.toHaveProperty('maxInvestigationRounds')
  })
})
