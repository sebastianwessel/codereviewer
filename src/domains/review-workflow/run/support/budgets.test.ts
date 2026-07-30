import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../../../../shared/contracts/index.js'
import {
  aiReviewBudgetFor,
  taskInputBudgetFor
} from './budgets.js'

const provider = {
  id: 'openai' as const,
  model: 'review-model'
}

describe('review runner budgets', () => {
  test('leaves the packet unbounded without a provider', () => {
    // No provider means no packet ceiling at all: nothing local decides how large a
    // review task may be.
    expect(
      taskInputBudgetFor(CodeReviewerConfigSchema.parse({}))
    ).toBeUndefined()
  })

  test('the packet ceiling is a runaway guard, far beyond any model context', () => {
    // Spec 26: the PROVIDER decides whether a packet is too large. This ceiling must
    // therefore sit far above any real context window, or it would refuse before the
    // provider was ever asked and a guessed local value would be the authority again.
    // ~1M tokens is on the order of 4MB of text; this is several times that.
    const defaultProvider = CodeReviewerConfigSchema.parse({
      provider,
      review: { depth: 'thorough' }
    })

    expect(taskInputBudgetFor(defaultProvider)).toBe(8_000_000)
    expect(taskInputBudgetFor(defaultProvider)).toBeGreaterThan(4_000_000)
  })

  test('an explicit contextMaxBytes still binds, because it is a deliberate choice', () => {
    const explicit = CodeReviewerConfigSchema.parse({
      provider,
      review: { contextMaxBytes: 30000 }
    })

    expect(taskInputBudgetFor(explicit)).toBe(30000)
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
        maxMatches: 50,
        maxDepth: 4
      }
    })
    expect(balancedBudget).toEqual({
      contextRetrievalBudget: {
        maxReads: 1200,
        usedReads: 0,
        maxSearches: 600,
        usedSearches: 0,
        maxBytesPerRead: 120000,
        maxMatches: 150,
        maxDepth: 8
      }
    })
    expect(thoroughBudget).toEqual({
      contextRetrievalBudget: {
        maxReads: 4800,
        usedReads: 0,
        maxSearches: 2400,
        usedSearches: 0,
        maxBytesPerRead: 240000,
        maxMatches: 320,
        maxDepth: 12
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
        maxMatches: 150,
        maxDepth: 8
      }
    })
    expect(fastBudget).not.toHaveProperty('maxSuspicionsPerTask')
    expect(fastBudget).not.toHaveProperty('maxInvestigationsPerRun')
    expect(fastBudget).not.toHaveProperty('maxInvestigationRounds')
  })
})
