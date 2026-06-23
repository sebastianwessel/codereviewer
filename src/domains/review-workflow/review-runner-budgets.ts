import type { CodeReviewerConfig } from '../../shared/contracts/index.js'
import type { ContextRetrievalBudget } from '../context-retrieval/index.js'

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

const defaultAiReviewBudgetsByDepth = {
  fast: {
    maxSuspicionsPerTask: 3,
    maxInvestigationsPerRun: 20,
    maxToolReadsPerInvestigation: 10,
    maxToolSearchesPerInvestigation: 5,
    maxInvestigationRounds: 2
  },
  balanced: {
    maxSuspicionsPerTask: 6,
    maxInvestigationsPerRun: 60,
    maxToolReadsPerInvestigation: 20,
    maxToolSearchesPerInvestigation: 10,
    maxInvestigationRounds: 3
  },
  thorough: {
    maxSuspicionsPerTask: 10,
    maxInvestigationsPerRun: 120,
    maxToolReadsPerInvestigation: 40,
    maxToolSearchesPerInvestigation: 20,
    maxInvestigationRounds: 4
  }
} as const

export type AiReviewRuntimeBudget = {
  readonly maxSuspicionsPerTask: number
  readonly maxInvestigationsPerRun: number
  readonly maxInvestigationRounds: number
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
  const defaults = defaultAiReviewBudgetsByDepth[config.review.depth]
  const maxInvestigationsPerRun =
    config.aiReview.maxInvestigationsPerRun ?? defaults.maxInvestigationsPerRun
  const maxToolReadsPerInvestigation =
    config.aiReview.maxToolReadsPerInvestigation ??
    defaults.maxToolReadsPerInvestigation
  const maxToolSearchesPerInvestigation =
    config.aiReview.maxToolSearchesPerInvestigation ??
    defaults.maxToolSearchesPerInvestigation
  const maxInvestigationRounds =
    config.aiReview.maxInvestigationRounds ?? defaults.maxInvestigationRounds
  const depthContextCap = providerTaskContextMaxBytesByDepth[config.review.depth]
  const maxBytesPerRead = Math.max(
    1,
    Math.min(
      config.review.contextMaxBytes ?? depthContextCap,
      depthContextCap
    )
  )

  return {
    maxSuspicionsPerTask:
      config.aiReview.maxSuspicionsPerTask ?? defaults.maxSuspicionsPerTask,
    maxInvestigationsPerRun,
    maxInvestigationRounds,
    contextRetrievalBudget: {
      maxReads: maxInvestigationsPerRun * maxToolReadsPerInvestigation,
      usedReads: 0,
      maxSearches: maxInvestigationsPerRun * maxToolSearchesPerInvestigation,
      usedSearches: 0,
      maxBytesPerRead,
      maxMatches: Math.max(1, maxToolSearchesPerInvestigation * maxInvestigationRounds)
    }
  }
}

export const sourceChunkBudgetFor = (config: CodeReviewerConfig): number => {
  const contextBudget = contextBudgetFor(config)
  const providerBudget = taskInputBudgetFor(config)
  const packetBudget = providerBudget ?? contextBudget

  return Math.max(1024, Math.floor(Math.min(contextBudget, packetBudget) * 0.45))
}
