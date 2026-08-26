import type {
  ChangeIntentBrief,
  ContextFragment,
  ContextSummarizer
} from './contracts.js'
import { packFragments } from './fragment-packer.js'

const sectionFor = (fragment: ContextFragment): string => {
  const heading = fragment.title ?? fragment.origin
  return `## ${heading}\n${fragment.body.trim()}`
}

/**
 * Deterministic fallback distiller: ordered, per-origin bounded truncation with
 * a total byte cap. No provider call, fully reproducible. Used when no provider
 * is configured, when `digest` is selected, and when a model summarization fails.
 * Fragment packing — order, whole-then-cut, and the two truncation causes — is
 * `packFragments`'; this summarizer contributes only the section heading and the
 * budget, which here is the output cap itself because the packed text IS the brief.
 */
export const createDigestSummarizer = (): ContextSummarizer => ({
  mode: 'digest',
  summarize: async (fragments, input) => {
    const packed = packFragments({
      fragments,
      budgetBytes: input.maxBytes,
      renderSection: sectionFor
    })

    const brief: ChangeIntentBrief = {
      text: packed.text,
      origins: packed.origins,
      truncated: packed.truncated,
      ...(packed.cutBySummaryCap ? { cutBySummaryCap: true } : {}),
      mode: 'digest'
    }

    return brief
  }
})
