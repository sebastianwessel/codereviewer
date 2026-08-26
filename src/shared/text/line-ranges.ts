/**
 * Do two inclusive line ranges share at least one line?
 *
 * One definition, because there were three: admission used it to decide whether a
 * candidate sits in the reviewed diff, analyzer ingestion to attribute an alert to
 * a changed line, and eval scoring to decide whether an expectation is in-diff.
 * Algebraically identical, written three ways, none calling the others — so an
 * off-by-one or a change of mind about whether touching endpoints count would have
 * landed in one and not the others, and each of those three answers a question
 * about whether a finding is in scope.
 *
 * Inclusive on both ends: ranges that touch at a single line DO overlap, because a
 * one-line range is `startLine === endLine` and must intersect itself.
 */
export const lineRangesOverlap = (
  left: { readonly startLine: number; readonly endLine: number },
  right: { readonly startLine: number; readonly endLine: number }
): boolean => left.startLine <= right.endLine && right.startLine <= left.endLine
