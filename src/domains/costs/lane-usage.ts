import { z } from 'zod'
import type { CostConfig } from '../../shared/contracts/index.js'
import { summarizeRunCost, type RunTokenUsage } from './token-cost.js'

// The model spend an advisory lane reports for its own provider calls.
//
// Each lane (verification, intent-fulfilment) resolves its own provider and
// finalizes its own cost, because the general-review run cost is already
// finalized before any of them runs. They report that spend in the SAME shape on
// purpose: separately maintained copies of this object had already drifted apart
// once in comment wording, and a lane whose usage block disagreed with the others
// would be silently mispriced rather than fail.
export const LaneUsageSchema = z.strictObject({
  // Which model produced this lane's output. Recorded because every number a
  // lane publishes -- its cost, and the measured accuracy rates its report
  // quotes -- is a property of a specific model, not of the engine. A lane run
  // against a different provider or a newer model version is not covered by a
  // rate measured on this one, and without the identity on the artifact there is
  // no way to tell afterwards which case a saved report was.
  //
  // Absent only when no provider was resolved (a lane that made no model call).
  providerId: z.string().min(1).optional(),
  modelName: z.string().min(1).optional(),
  inputTokens: z.int().min(0),
  outputTokens: z.int().min(0),
  // A SUBSET of `inputTokens`, already counted there.
  cachedInputTokens: z.int().min(0).optional(),
  reasoningTokens: z.int().min(0).optional(),
  costUsd: z.number().min(0).optional()
})

export type LaneUsage = z.infer<typeof LaneUsageSchema>

/**
 * Price a lane's accumulated token usage and render it in the reported shape.
 *
 * `costUsd` is omitted rather than zeroed when the cost could not be determined,
 * so missing pricing stays visible instead of reading as a free run. The caller
 * decides whether a lane that made no model call reports `undefined` or a zeroed
 * record — that differs per lane and is not this helper's decision.
 */
export const summarizeLaneUsage = (input: {
  readonly usage: RunTokenUsage
  readonly providerId?: string
  readonly modelName?: string
  readonly prices: Partial<CostConfig>
}): LaneUsage => {
  const cost = summarizeRunCost({
    providerConfigured: true,
    ...(input.providerId === undefined ? {} : { providerId: input.providerId }),
    ...(input.modelName === undefined ? {} : { modelName: input.modelName }),
    prices: input.prices,
    usage: input.usage
  })

  return {
    // Carried through from the same inputs the price was computed from, so the
    // identity on the record and the identity the cost was derived from cannot
    // disagree.
    ...(input.providerId === undefined ? {} : { providerId: input.providerId }),
    ...(input.modelName === undefined ? {} : { modelName: input.modelName }),
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    ...(input.usage.cachedInputTokens === undefined
      ? {}
      : { cachedInputTokens: input.usage.cachedInputTokens }),
    ...(input.usage.reasoningTokens === undefined
      ? {}
      : { reasoningTokens: input.usage.reasoningTokens }),
    ...(cost.costUsd === undefined ? {} : { costUsd: cost.costUsd })
  }
}
