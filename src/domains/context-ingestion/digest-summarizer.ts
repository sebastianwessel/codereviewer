import type {
  ChangeIntentBrief,
  ContextFragment,
  ContextSummarizer
} from './contracts.js'
import { truncateToUtf8Bytes } from './text.js'

const sectionFor = (fragment: ContextFragment): string => {
  const heading = fragment.title ?? fragment.origin
  return `## ${heading}\n${fragment.body.trim()}`
}

/**
 * Deterministic fallback distiller: ordered, per-origin bounded truncation with
 * a total byte cap. No provider call, fully reproducible. Used when no provider
 * is configured, when `digest` is selected, and when a model summarization fails.
 * Fragments are emitted in input order; earlier fragments are kept whole and the
 * first fragment that overflows the cap is truncated, after which emission stops.
 */
const separatorBytes = Buffer.byteLength('\n\n', 'utf8')

export const createDigestSummarizer = (): ContextSummarizer => ({
  mode: 'digest',
  summarize: async (fragments, input) => {
    const sections: string[] = []
    const origins: string[] = []
    let usedBytes = 0
    let truncated = false

    for (const fragment of fragments) {
      const budget =
        input.maxBytes - usedBytes - (sections.length === 0 ? 0 : separatorBytes)

      if (budget <= 0) {
        truncated = true
        break
      }

      const section = sectionFor(fragment)
      const fitted = truncateToUtf8Bytes(section, budget)

      if (fitted.length === 0) {
        truncated = true
        break
      }

      sections.push(fitted)
      origins.push(fragment.origin)
      usedBytes +=
        (sections.length === 1 ? 0 : separatorBytes) +
        Buffer.byteLength(fitted, 'utf8')

      if (fitted.length < section.length) {
        truncated = true
        break
      }
    }

    const brief: ChangeIntentBrief = {
      text: sections.join('\n\n'),
      origins,
      truncated,
      mode: 'digest'
    }

    return brief
  }
})
