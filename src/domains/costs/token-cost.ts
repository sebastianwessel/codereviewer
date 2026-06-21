import type { CostConfig } from '../../shared/contracts/index.js'

export type TokenCostSource = 'provider' | 'configured' | 'unavailable'

export type TokenCostInput = {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly prices: Partial<CostConfig>
  readonly providerCostUsd?: number
}

export type TokenCostSummary = {
  readonly inputTokens: number
  readonly outputTokens: number
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

  const totalTokens = input.inputTokens + input.outputTokens

  if (input.providerCostUsd !== undefined) {
    return {
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      totalTokens,
      costUsd: roundUsd(input.providerCostUsd),
      costSource: 'provider'
    }
  }

  if (
    input.prices.inputPerMillion !== undefined &&
    input.prices.outputPerMillion !== undefined
  ) {
    return {
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      totalTokens,
      costUsd: roundUsd(
        (input.inputTokens / 1_000_000) * input.prices.inputPerMillion +
          (input.outputTokens / 1_000_000) * input.prices.outputPerMillion
      ),
      costSource: 'configured'
    }
  }

  return {
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    totalTokens,
    costUsd: null,
    costSource: 'unavailable'
  }
}

export type RunTokenUsage = {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly providerCostUsd?: number
}

export type RunCostSummary = {
  readonly warnings: readonly string[]
  readonly costUsd?: number
  readonly inputTokens?: number
  readonly outputTokens?: number
}

// Summarize cost for a run. Deterministic (no-provider) runs have no model cost.
// Provider runs without surfaced token usage, or without provider cost and
// configured prices, emit `cost-unavailable` so missing cost data is visible
// rather than silently reported as zero.
export const summarizeRunCost = (input: {
  readonly providerConfigured: boolean
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
    prices: input.prices,
    ...(input.usage.providerCostUsd === undefined
      ? {}
      : { providerCostUsd: input.usage.providerCostUsd })
  })

  if (cost.costUsd === null) {
    return {
      warnings: ['cost-unavailable'],
      inputTokens: cost.inputTokens,
      outputTokens: cost.outputTokens
    }
  }

  return {
    warnings: [],
    costUsd: cost.costUsd,
    inputTokens: cost.inputTokens,
    outputTokens: cost.outputTokens
  }
}

