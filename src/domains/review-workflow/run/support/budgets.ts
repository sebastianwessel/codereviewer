import type { CodeReviewerConfig } from '../../../../shared/contracts/index.js'
import type { ContextRetrievalBudget } from '../../../context-retrieval/index.js'

const defaultContextBudgetsByDepth = {
  fast: {
    maxFiles: 50,
    maxBytes: 100000
  },
  balanced: {
    maxFiles: 200,
    maxBytes: 200000
  },
  thorough: {
    maxFiles: 500,
    maxBytes: 500000
  }
} as const

// Per-depth provider context caps: depth makes a meaningful difference so that
// thorough reviews send substantially more source per task than fast ones.
const providerTaskContextMaxBytesByDepth = {
  fast: 60_000,
  balanced: 120_000,
  thorough: 240_000
} as const

// Hard ceiling on how many bytes a single model-input packet may contain
// (context + metadata overhead). Kept above the largest per-depth context cap
// so it never becomes the binding constraint at thorough depth.
const defaultProviderTaskInputMaxBytes = 360_000

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

export const contextBudgetFor = (config: CodeReviewerConfig): number =>
  config.review.contextMaxBytes ??
  (config.provider === undefined
    ? defaultContextBudgetsByDepth[config.review.depth].maxBytes
    : Math.min(
        defaultContextBudgetsByDepth[config.review.depth].maxBytes,
        providerTaskContextMaxBytesByDepth[config.review.depth]
      ))

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

export const sourceChunkBudgetFor = (config: CodeReviewerConfig): number => {
  const contextBudget = contextBudgetFor(config)
  const providerBudget = taskInputBudgetFor(config)
  const packetBudget = providerBudget ?? contextBudget

  return Math.max(1024, Math.floor(Math.min(contextBudget, packetBudget) * 0.45))
}
