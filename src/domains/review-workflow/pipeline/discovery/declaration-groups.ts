// Spec 27, Sub-File Partitioning: cut ONE reviewed file into declaration groups so
// its body can be spread over several discovery calls.
//
// `maxFilesPerDiscoveryCall` multiplies calls by splitting the SET OF FILES, so on a
// change that touches one file there is one partition and one call — and the only
// mechanism this project has measured as working cannot engage at all. On the
// security corpus that is most of the corpus.
//
// The mechanism, and the trap: partitioning works because a call is SHOWN LESS
// (per-file attention decays as shown^-0.30). It does not work because the call is
// told to focus — a sub-file split that still showed the whole file would change
// only the label, which is the un-anchored pass, measured at +0.83pp for +136% cost
// and removed. So a group carries a NARROWED file body, never the whole file with a
// note attached.
//
// The split points are declaration anchors from the AST, never a byte count, so the
// content-dependent guess spec 26 removed is not reintroduced.
//
// This is OFF BY DEFAULT AND UNMEASURED. The predicted harm is stated in the spec
// and is a trade, not a gain: 16 of 17 cross-function and 13 of 15 cross-file
// expectations sit in cases this knob would split, and a defect whose halves land in
// non-adjacent groups is lost.

import { declarationAnchorLines } from '../../../deterministic-signals/index.js'
import { type ReviewContextDocument } from '../agent-contracts.js'

export type DeclarationSplitOptions = {
  // Declarations one discovery call may be shown (spec 27:
  // `aiReview.maxDeclarationsPerDiscoveryCall`).
  readonly maxDeclarationsPerCall: number
  // Hard ceiling on groups per file (`aiReview.maxDeclarationGroupsPerFile`).
  // Without it the split is unbounded in cost: one corpus file carries 200 anchors,
  // which at 4 per group is 50 calls for a single case. When the cap binds, groups
  // are ENLARGED rather than dropped — the whole file stays covered.
  readonly maxGroupsPerFile: number
}

// Index ranges over the anchor list, inclusive at both ends.
type AnchorRange = readonly [number, number]

/**
 * Group anchors into contiguous runs, overlapping by exactly one declaration.
 *
 * The overlap is the spec's bounded concession: a defect that spans two adjacent
 * declarations is otherwise invisible to every call, and adjacent declarations are
 * where same-file cross-function defects mostly live. It is one declaration and no
 * more, so it is not a restoration of whole-file context.
 *
 * Because consecutive groups share one anchor, `size` anchors per group advance the
 * cursor by `size - 1`, and G groups cover `G * (size - 1) + 1` anchors. That
 * identity is what lets the cap be honoured by enlarging groups instead of
 * discarding the tail of the file.
 */
const groupAnchors = (
  anchorCount: number,
  options: DeclarationSplitOptions
): readonly AnchorRange[] => {
  const groupCountFor = (size: number): number =>
    size <= 1 ? anchorCount : Math.ceil((anchorCount - 1) / (size - 1))

  const requested = Math.max(1, options.maxDeclarationsPerCall)
  const cap = Math.max(1, options.maxGroupsPerFile)
  const size =
    groupCountFor(requested) > cap
      ? Math.ceil((anchorCount - 1) / cap) + 1
      : requested
  const step = Math.max(1, size - 1)
  const ranges: AnchorRange[] = []

  for (let start = 0; start < anchorCount; start += step) {
    const end = Math.min(start + size - 1, anchorCount - 1)

    ranges.push([start, end])

    if (end === anchorCount - 1) {
      break
    }
  }

  return ranges
}

/**
 * Split one reviewed file document into declaration-group documents.
 *
 * Returns the document unchanged, as a single group, whenever splitting would not
 * apply: no path, no content, fewer than two anchors, or a group arithmetic that
 * yields one group. An extractor failure and an unsupported language both surface
 * as an empty anchor list, so both fall back to the whole file — never to a byte
 * slice (spec 27 requirement).
 *
 * Each group's document carries the ABSOLUTE line range it occupies in the source
 * file, in the `startLine`/`endLine` representation reviewed file documents already
 * use; there is no new document kind. The first group starts at the document's own
 * first line, so a file's imports and header are never lost, and the last group runs
 * to its last line. A group ends on the line before the NEXT declaration, so a
 * declaration's body travels with its signature.
 */
export const splitDocumentByDeclarations = (
  document: ReviewContextDocument,
  options: DeclarationSplitOptions
): readonly ReviewContextDocument[] => {
  if (document.path === undefined || document.content.length === 0) {
    return [document]
  }

  const anchors = declarationAnchorLines(document.path, document.content)

  if (anchors.length < 2) {
    return [document]
  }

  const ranges = groupAnchors(anchors.length, options)

  if (ranges.length < 2) {
    return [document]
  }

  const lines = document.content.split('\n')
  // The document may itself already be a chunk (a spec 26 reactive half), so every
  // line number is rebased onto its origin rather than assumed to start at 1.
  const offset = (document.startLine ?? 1) - 1

  return ranges.map(([startIndex, endIndex], groupIndex) => {
    const followingAnchor = anchors[endIndex + 1]
    const firstLine = groupIndex === 0 ? 1 : (anchors[startIndex] as number)
    const lastLine =
      followingAnchor === undefined ? lines.length : followingAnchor - 1

    return {
      ...document,
      content: lines.slice(firstLine - 1, lastLine).join('\n'),
      startLine: firstLine + offset,
      endLine: lastLine + offset
    }
  })
}
