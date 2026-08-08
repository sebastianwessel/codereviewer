import { truncateForContract } from '../../src/shared/text/truncate.js'

// Text guards shared by every surface of the GitHub integration.
//
// Two classes of untrusted text pass through this integration, and both end up
// inside a Markdown comment we author:
//
//   - the pull-request title and body, written by whoever opened the pull
//     request;
//   - finding titles, descriptions, obligation statements and divergence prose,
//     written by a model that has read attacker-influenced repository content.
//
// The comment this integration posts is identified on later runs by an
// HTML-comment marker, so the one thing untrusted text must never be able to do
// is emit `<!--` or `-->`. A finding title carrying our marker would let
// arbitrary text decide which comment a future run edits, and an unterminated
// `<!--` would hide the rest of the comment. Both are removed by escaping every
// `<`, which cannot form an HTML comment or an HTML tag at all.

// GitHub rejects an issue comment body above 65 536 characters. This is the
// shared bound so the renderer and its tests cannot disagree about the number.
export const MAX_ISSUE_COMMENT_BODY = 65_000

// Control characters other than tab, newline and carriage return. They render as
// nothing and have no legitimate place in a comment body or a metadata scalar.
const controlCharacters = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu

/**
 * Make untrusted text safe to place in a Markdown comment body: strip control
 * characters, escape `<` so no HTML comment or tag can be formed, and bound the
 * length.
 *
 * Deliberately NOT a full Markdown escape. This text is prose a human has to
 * read and act on, so a stray `*` is cosmetic; `<` is the only character with a
 * security consequence here, and `&lt;` renders back to `<` anyway.
 */
export const sanitizeText = (value: string, maxLength: number): string => {
  const cleaned = value.replace(controlCharacters, '').replaceAll('<', '&lt;')

  // Truncation is delegated rather than repeated: this file used to hardcode both
  // the mark and its length, so a change to TRUNCATION_MARK would have left the
  // pull-request comment reading differently from every other surface. The shared
  // helper also handles a cap too small to hold the mark, which this did not.
  return truncateForContract(cleaned, maxLength)
}

/**
 * `sanitizeText` plus newline collapsing, for a value that must occupy exactly
 * one line: a heading or a table cell. `|` is escaped so a value cannot add
 * columns to a Markdown table.
 */
export const sanitizeLine = (value: string, maxLength: number): string =>
  sanitizeText(value.replace(/\s+/gu, ' ').trim(), maxLength).replaceAll(
    '|',
    '\\|'
  )

/**
 * Frontmatter scalar for a change-intent inbox file (spec 11).
 *
 * The inbox parser reads `key: value` lines until the closing `---`, so a value
 * containing a newline could inject a metadata key and one containing `---`
 * could close the block early, moving attacker text out of the body and into
 * provenance metadata. Both are removed here rather than trusted not to occur:
 * GitHub happens to forbid newlines in a pull-request title today, which is not
 * a property this integration should depend on.
 *
 * `<` is NOT escaped here. This value goes to the review engine, which applies
 * its own redaction and its own untrusted-content framing; HTML escaping would
 * only corrupt the author's words on the way in.
 */
export const sanitizeFrontmatterValue = (
  value: string,
  maxLength: number
): string =>
  value
    .replace(controlCharacters, '')
    .replace(/\s+/gu, ' ')
    .replace(/-{3,}/gu, '--')
    .trim()
    .slice(0, maxLength)
