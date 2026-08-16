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
    // Set only where THIS cap does the cutting, never on the branch below that
    // merely inherits a provider's per-file cut. See `ChangeIntentBrief` for why the
    // two causes are reported apart.
    let cutBySummaryCap = false

    for (const fragment of fragments) {
      const budget =
        input.maxBytes - usedBytes - (sections.length === 0 ? 0 : separatorBytes)

      if (budget <= 0) {
        truncated = true
        cutBySummaryCap = true
        break
      }

      const section = sectionFor(fragment)
      const fitted = truncateToUtf8Bytes(section, budget)

      if (fitted.length === 0) {
        truncated = true
        cutBySummaryCap = true
        break
      }

      sections.push(fitted)
      origins.push(fragment.origin)

      if (fragment.truncated === true) {
        // The section fits the digest's budget, but only because the provider
        // already cut this body at its per-file cap. Judging truncation by
        // whether the text fits here reports a brief built from half a ticket as
        // complete — the cut text is exactly the text that fits.
        truncated = true
      }

      usedBytes +=
        (sections.length === 1 ? 0 : separatorBytes) +
        Buffer.byteLength(fitted, 'utf8')

      if (fitted.length < section.length) {
        truncated = true
        cutBySummaryCap = true
        break
      }
    }

    const brief: ChangeIntentBrief = {
      text: sections.join('\n\n'),
      origins,
      truncated,
      ...(cutBySummaryCap ? { cutBySummaryCap } : {}),
      mode: 'digest'
    }

    return brief
  }
})
