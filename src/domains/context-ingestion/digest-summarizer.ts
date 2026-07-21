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
export const createDigestSummarizer = (): ContextSummarizer => ({
  mode: 'digest',
  summarize: async (fragments, input) => {
    const sections: string[] = []
    const origins: string[] = []
    let usedBytes = 0
    let truncated = false

    for (const fragment of fragments) {
      const separator = sections.length === 0 ? '' : '\n\n'
      const section = sectionFor(fragment)
      const separatorBytes = Buffer.byteLength(separator, 'utf8')
      const sectionBytes = Buffer.byteLength(section, 'utf8')

      if (usedBytes + separatorBytes + sectionBytes > input.maxBytes) {
        const remaining = input.maxBytes - usedBytes - separatorBytes
        const partial = truncateToUtf8Bytes(section, remaining)

        // Only keep a partial section if it carries content past the heading.
        if (partial.includes('\n') && partial.split('\n').slice(1).join('\n').trim().length > 0) {
          sections.push(partial)
          origins.push(fragment.origin)
        }

        truncated = true
        break
      }

      sections.push(section)
      origins.push(fragment.origin)
      usedBytes += separatorBytes + sectionBytes
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
