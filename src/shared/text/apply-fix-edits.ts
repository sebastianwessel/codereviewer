// The deterministic apply-check: CODE (never the model) re-applies a proposed
// `fixEdits` set to the current file bytes. An edit that does not apply cleanly —
// a line range out of bounds, or edits that overlap — makes the whole set not
// apply. This rejects hallucinated line numbers and stale-location edits without a
// model call, and it NEVER writes to the working tree: it only proves the edits
// are coherent against the file as it is now.
//
// Shared, not owned by one domain, because two of them ask the same question of
// the same bytes and must get the same answer. The fix lane asks it before an
// agent-produced edit set may enrich a finding's `fixProposal` (spec 12
// "Deterministic Apply-Check"). Reporting asks it again before a review comment
// may offer that edit set as a one-click apply — the fix lane is optional, and a
// suggestion block a human can apply in one click must be checked whether or not
// the lane ran.

import type { FixEdit } from '../contracts/findings/finding.schema.js'

// Splits into lines preserving the ability to rejoin; line ranges in a `FixEdit`
// are 1-based and inclusive over these lines.
const splitLines = (content: string): string[] => content.split(/\r\n|\r|\n/u)

export type ApplyCheckResult =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly reason: string }

/**
 * Applies `edits` (all targeting a single already-read file whose current bytes
 * are `content`) and reports whether every edit fits cleanly. Edits are applied
 * from the bottom of the file up so earlier edits do not shift later line
 * numbers. An empty edit set does not apply (there is nothing to check).
 */
export const applyFixEdits = (
  content: string,
  edits: readonly FixEdit[]
): ApplyCheckResult => {
  if (edits.length === 0) {
    return { ok: false, reason: 'no-edits' }
  }

  const lines = splitLines(content)
  const totalLines = lines.length

  for (const edit of edits) {
    if (
      edit.startLine < 1 ||
      edit.endLine < edit.startLine ||
      edit.endLine > totalLines
    ) {
      return { ok: false, reason: 'line-range-out-of-bounds' }
    }
  }

  // Reject overlapping ranges: two edits that touch the same line cannot be
  // applied deterministically.
  const ordered = [...edits].sort((a, b) => a.startLine - b.startLine)
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]
    const current = ordered[index]
    if (
      previous !== undefined &&
      current !== undefined &&
      current.startLine <= previous.endLine
    ) {
      return { ok: false, reason: 'overlapping-edits' }
    }
  }

  // Apply from the bottom up so line indices stay valid as ranges are replaced.
  const result = [...lines]
  for (const edit of [...ordered].reverse()) {
    result.splice(
      edit.startLine - 1,
      edit.endLine - edit.startLine + 1,
      ...splitLines(edit.replacement)
    )
  }

  return { ok: true, content: result.join('\n') }
}
