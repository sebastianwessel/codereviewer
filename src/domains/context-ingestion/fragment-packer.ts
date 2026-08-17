import type { ContextFragment } from './contracts.js'
import { truncateToUtf8Bytes } from './text.js'

/**
 * What the packer emitted, and what it had to leave behind. The three flags are
 * the whole reason this is not just a `join`: see `ChangeIntentBrief` for why
 * `truncated` (the union of every cause) and `cutBySummaryCap` (this cap, and only
 * this cap) are reported apart.
 */
export type PackedFragments = {
  readonly text: string
  /** Only the fragments that actually made it into `text`. */
  readonly origins: readonly string[]
  readonly truncated: boolean
  readonly cutBySummaryCap: boolean
}

export type PackFragmentsInput = {
  readonly fragments: readonly ContextFragment[]
  /**
   * The byte budget for the joined result. Derived differently by each caller —
   * the digest packs into the OUTPUT cap it is about to emit, the model
   * summarizer packs into a multiple of it as INPUT for a call whose output the
   * cap then bounds — but a cut is attributable to `contextSources.summary.maxBytes`
   * either way, which is what makes one packer correct for both.
   */
  readonly budgetBytes: number
  /** How one fragment becomes a section. The callers' headings differ. */
  readonly renderSection: (fragment: ContextFragment) => string
}

const separatorBytes = Buffer.byteLength('\n\n', 'utf8')

/**
 * Packs whole fragments in input order until the byte budget is exhausted:
 * earlier fragments are kept whole, the first that overflows is truncated, and
 * emission stops there.
 *
 * ONE packer, because there were two written statement for statement — the digest
 * summarizer's and the model summarizer's, the latter carrying a comment saying it
 * was built "the way `digest-summarizer.ts` already does it" and then doing it
 * again. Both loops encode the same four-part contract (order, whole-then-cut,
 * origins name only what survived, and the two truncation causes stay apart), and
 * every one of those parts was fixed as a defect at least once. A second copy is a
 * second place for the next such fix to miss.
 */
export const packFragments = (input: PackFragmentsInput): PackedFragments => {
  const sections: string[] = []
  const origins: string[] = []
  let usedBytes = 0
  let truncated = false
  // Set only where THIS budget does the cutting, never on the branch below that
  // merely inherits a provider's per-file cut.
  let cutBySummaryCap = false

  for (const fragment of input.fragments) {
    const remaining =
      input.budgetBytes - usedBytes - (sections.length === 0 ? 0 : separatorBytes)

    if (remaining <= 0) {
      truncated = true
      cutBySummaryCap = true
      break
    }

    const section = input.renderSection(fragment)
    const fitted = truncateToUtf8Bytes(section, remaining)

    if (fitted.length === 0) {
      truncated = true
      cutBySummaryCap = true
      break
    }

    sections.push(fitted)
    origins.push(fragment.origin)

    if (fragment.truncated === true) {
      // The section fits this budget, but only because the provider already cut
      // this body at its per-file cap. Judging truncation by whether the text fits
      // here reports a brief built from half a ticket as complete — the cut text is
      // exactly the text that fits.
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

  return { text: sections.join('\n\n'), origins, truncated, cutBySummaryCap }
}
