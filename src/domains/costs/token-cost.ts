import type { CostConfig } from '../../shared/contracts/index.js'
import { builtInPricesFor } from './model-pricing.js'

export type TokenCostSource = 'provider' | 'configured' | 'unavailable'

export type TokenCostInput = {
  readonly inputTokens: number
  readonly outputTokens: number
  // Cached input tokens are a SUBSET of inputTokens (already counted in the
  // input aggregate). They are re-priced at the cached rate when one is known.
  readonly cachedInputTokens?: number
  readonly prices: Partial<CostConfig>
  readonly providerCostUsd?: number
}

export type TokenCostSummary = {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cachedInputTokens: number
  readonly totalTokens: number
  readonly costUsd: number | null
  readonly costSource: TokenCostSource
}

const assertNonNegativeInteger = (value: number, fieldName: string): void => {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${fieldName} must be an integer greater than or equal to 0.`)
  }
}

const roundUsd = (value: number): number => Math.round(value * 1_000_000) / 1_000_000

export const calculateTokenCost = (
  input: TokenCostInput
): TokenCostSummary => {
  assertNonNegativeInteger(input.inputTokens, 'inputTokens')
  assertNonNegativeInteger(input.outputTokens, 'outputTokens')

  const cachedInputTokens = input.cachedInputTokens ?? 0
  assertNonNegativeInteger(cachedInputTokens, 'cachedInputTokens')
  if (cachedInputTokens > input.inputTokens) {
    throw new RangeError(
      'cachedInputTokens must not exceed inputTokens (cached input is a subset of input).'
    )
  }

  const totalTokens = input.inputTokens + input.outputTokens

  if (input.providerCostUsd !== undefined) {
    return {
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      cachedInputTokens,
      totalTokens,
      costUsd: roundUsd(input.providerCostUsd),
      costSource: 'provider'
    }
  }

  if (
    input.prices.inputPerMillion !== undefined &&
    input.prices.outputPerMillion !== undefined
  ) {
    // Cached input tokens are re-priced at the cached rate ONLY when one is
    // known; otherwise they fall back to the full input price (no fabricated
    // discount). The remaining (non-cached) input is always priced at the full
    // input rate.
    const cachedInputPerMillion =
      input.prices.cachedInputPerMillion ?? input.prices.inputPerMillion

    return {
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      cachedInputTokens,
      totalTokens,
      costUsd: roundUsd(
        ((input.inputTokens - cachedInputTokens) / 1_000_000) *
          input.prices.inputPerMillion +
          (cachedInputTokens / 1_000_000) * cachedInputPerMillion +
          (input.outputTokens / 1_000_000) * input.prices.outputPerMillion
      ),
      costSource: 'configured'
    }
  }

  return {
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cachedInputTokens,
    totalTokens,
    costUsd: null,
    costSource: 'unavailable'
  }
}

export type RunTokenUsage = {
  readonly inputTokens: number
  readonly outputTokens: number
  // Cached input tokens are a SUBSET of inputTokens, not an addition to it.
  readonly cachedInputTokens?: number
  readonly reasoningTokens?: number
  readonly providerCostUsd?: number
}

// Sum two token-usage records into one. Used to fold a dedicated model call
// (e.g. the change-intent summarizer) into the run's provider usage so its
// tokens are counted in run cost. `cachedInputTokens` is a subset of
// `inputTokens`, so it sums the same way.
export const combineRunTokenUsage = (
  a: RunTokenUsage | undefined,
  b: RunTokenUsage | undefined
): RunTokenUsage | undefined => {
  if (a === undefined) {
    return b
  }

  if (b === undefined) {
    return a
  }

  const cached = (a.cachedInputTokens ?? 0) + (b.cachedInputTokens ?? 0)
  const reasoning = (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0)
  const providerCost =
    a.providerCostUsd === undefined && b.providerCostUsd === undefined
      ? undefined
      : (a.providerCostUsd ?? 0) + (b.providerCostUsd ?? 0)

  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    ...(cached === 0 ? {} : { cachedInputTokens: cached }),
    ...(reasoning === 0 ? {} : { reasoningTokens: reasoning }),
    ...(providerCost === undefined ? {} : { providerCostUsd: providerCost })
  }
}

export type RunCostSummary = {
  readonly warnings: readonly string[]
  readonly costUsd?: number
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly cachedInputTokens?: number
}

// Summarize cost for a run. Deterministic (no-provider) runs have no model cost.
// Provider runs without surfaced token usage, or without provider cost and
// configured prices, emit `cost-unavailable` so missing cost data is visible
// rather than silently reported as zero.
export const summarizeRunCost = (input: {
  readonly providerConfigured: boolean
  readonly providerId?: string
  readonly modelName?: string
  readonly prices: Partial<CostConfig>
  readonly usage?: RunTokenUsage
}): RunCostSummary => {
  if (!input.providerConfigured) {
    return { warnings: [] }
  }

  if (input.usage === undefined) {
    return { warnings: ['cost-unavailable'] }
  }

  const cost = calculateTokenCost({
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    ...(input.usage.cachedInputTokens === undefined
      ? {}
      : { cachedInputTokens: input.usage.cachedInputTokens }),
    prices: {
      ...builtInPricesFor(input),
      ...input.prices
    },
    ...(input.usage.providerCostUsd === undefined
      ? {}
      : { providerCostUsd: input.usage.providerCostUsd })
  })

  if (cost.costUsd === null) {
    return {
      warnings: ['cost-unavailable'],
      inputTokens: cost.inputTokens,
      outputTokens: cost.outputTokens,
      cachedInputTokens: cost.cachedInputTokens
    }
  }

  return {
    warnings: [],
    costUsd: cost.costUsd,
    inputTokens: cost.inputTokens,
    outputTokens: cost.outputTokens,
    cachedInputTokens: cost.cachedInputTokens
  }
}
