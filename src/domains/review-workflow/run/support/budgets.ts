import type { CodeReviewerConfig } from '../../../../shared/contracts/index.js'
import type { ContextRetrievalBudget } from '../../../context-retrieval/index.js'

// Per-depth caps for BOUNDED CROSS-FILE READS (spec 16), the only thing these still
// size. They no longer bound the review packet: spec 26 removed proactive splitting,
// so how much source a task sends is decided by the provider, not by depth.
const providerTaskContextMaxBytesByDepth = {
  fast: 60_000,
  balanced: 120_000,
  thorough: 240_000
} as const

// A RUNAWAY GUARD on a single model-input packet, not a context ration.
//
// Spec 26 makes the PROVIDER the only authority on how large a packet may be: the
// change is sent whole and split only if the provider refuses it. A local ceiling
// sized anywhere near a real context window would break that outright — it would
// refuse before the provider was ever asked, and a guessed local value would be the
// authority again, which is the exact failure spec 26 exists to remove.
//
// So this is deliberately set far beyond any current model: roughly 1M tokens is on
// the order of 4MB of text, and this is about 2M tokens' worth. Nothing a real change
// produces comes near it. What it still does is stop a pathological input from being
// serialized into memory, and it REFUSES rather than truncating when it binds — the
// property spec 26 requires it to keep.
//
// It sits just under the contract's own `maxTaskInputBytes` bound (10MB), which is
// the outer limit an explicit configuration may request.
const defaultProviderTaskInputMaxBytes = 8_000_000

// Per-depth context-retrieval caps. Holistic discovery does not run an
// investigation loop, but the workflow still exposes a bounded context retriever;
// these caps keep that retrieval bounded per depth.
const defaultContextRetrievalCapsByDepth = {
  fast: { maxReads: 200, maxSearches: 100, maxMatches: 50, maxDepth: 4 },
  balanced: { maxReads: 1200, maxSearches: 600, maxMatches: 150, maxDepth: 8 },
  thorough: { maxReads: 4800, maxSearches: 2400, maxMatches: 320, maxDepth: 12 }
} as const

export type AiReviewRuntimeBudget = {
  readonly contextRetrievalBudget: ContextRetrievalBudget
}

export const taskInputBudgetFor = (
  config: CodeReviewerConfig
): number | undefined =>
  config.provider === undefined
    ? undefined
    : Math.min(
        config.review.contextMaxBytes ?? defaultProviderTaskInputMaxBytes,
        defaultProviderTaskInputMaxBytes
      )

export const aiReviewBudgetFor = (
  config: CodeReviewerConfig
): AiReviewRuntimeBudget => {
  const caps = defaultContextRetrievalCapsByDepth[config.review.depth]
  const depthContextCap = providerTaskContextMaxBytesByDepth[config.review.depth]
  const maxBytesPerRead = Math.max(
    1,
    Math.min(
      config.review.contextMaxBytes ?? depthContextCap,
      depthContextCap
    )
  )

  return {
    contextRetrievalBudget: {
      maxReads: caps.maxReads,
      usedReads: 0,
      maxSearches: caps.maxSearches,
      usedSearches: 0,
      maxBytesPerRead,
      maxMatches: caps.maxMatches,
      maxDepth: caps.maxDepth
    }
  }
}

