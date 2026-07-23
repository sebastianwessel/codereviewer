// Per-platform review-comment renderers (spec 13). Renderers are pure and
// deterministic. Redaction, Markdown escaping, the fence-breakout guard, and the
// body-length cap are enforced once in the neutral layer (`review-comments.ts`)
// and inherited here; each renderer only turns the structured suggestion into the
// platform's native syntax and re-checks the body cap so a fence is never
// truncated.
import {
  REVIEW_COMMENT_BODY_MAX,
  type FindingCategory,
  type PlatformTarget,
  type ReviewCommentDraft,
  type Severity
} from '../../shared/contracts/index.js'
import { CODE_FENCE, renderFencedBlock } from './review-comments.js'

type RenderedCommentBase = {
  readonly path: string
  readonly body: string
  readonly findingId: string
  readonly severity: Severity
  readonly category: FindingCategory
}

// GitHub review comment: `side: RIGHT` with absolute line / startLine anchors and
// a native ```suggestion block.
export type GithubRenderedComment = RenderedCommentBase & {
  readonly line: number
  readonly side: 'RIGHT'
  readonly startLine?: number
  readonly startSide?: 'RIGHT'
}

// GitLab and Bitbucket comments anchor to the last line of the target range and
// differ only in the fence syntax their suggestion block uses.
export type LineAnchoredRenderedComment = RenderedCommentBase & {
  readonly line: number
}

// Generic comment keeps the full range and a plain fenced block (no apply).
export type RangeAnchoredRenderedComment = RenderedCommentBase & {
  readonly startLine: number
  readonly endLine: number
}

export type RenderedReviewComment =
  | GithubRenderedComment
  | LineAnchoredRenderedComment
  | RangeAnchoredRenderedComment

// Append a rendered suggestion block only when the combined body still fits the
// cap, so truncation can never cut through a code fence.
const bodyWithBlock = (
  draft: ReviewCommentDraft,
  openingFence: string
): string => {
  if (draft.suggestion === undefined) {
    return draft.body
  }

  const combined = `${draft.body}\n\n${renderFencedBlock(openingFence, draft.suggestion.replacement)}`

  return combined.length <= REVIEW_COMMENT_BODY_MAX ? combined : draft.body
}

// Fields every platform carries verbatim from the neutral draft.
const commentBase = (
  draft: ReviewCommentDraft,
  openingFence: string
): RenderedCommentBase => ({
  path: draft.path,
  body: bodyWithBlock(draft, openingFence),
  findingId: draft.findingId,
  severity: draft.severity,
  category: draft.category
})

const renderGithub = (draft: ReviewCommentDraft): GithubRenderedComment => {
  const multiline = draft.targetRange.endLine > draft.targetRange.startLine

  return {
    ...commentBase(draft, `${CODE_FENCE}suggestion`),
    line: draft.targetRange.endLine,
    side: 'RIGHT',
    ...(multiline
      ? { startLine: draft.targetRange.startLine, startSide: 'RIGHT' as const }
      : {})
  }
}

const renderGitlab = (draft: ReviewCommentDraft): LineAnchoredRenderedComment => {
  // GitLab suggestion syntax is ```suggestion:-x+y anchored on a single line: `x`
  // lines above and `y` lines below the commented line are replaced together with
  // it. We anchor on the range's last line and extend upward, so `x` is the span
  // above and `y` is always 0.
  const above = draft.targetRange.endLine - draft.targetRange.startLine

  return {
    ...commentBase(draft, `${CODE_FENCE}suggestion:-${above}+0`),
    line: draft.targetRange.endLine
  }
}

// Bitbucket has no one-click apply, so the suggestion degrades to a readable
// plain fenced code block on the range's last line.
const renderBitbucket = (
  draft: ReviewCommentDraft
): LineAnchoredRenderedComment => ({
  ...commentBase(draft, CODE_FENCE),
  line: draft.targetRange.endLine
})

const renderGeneric = (
  draft: ReviewCommentDraft
): RangeAnchoredRenderedComment => ({
  ...commentBase(draft, CODE_FENCE),
  startLine: draft.targetRange.startLine,
  endLine: draft.targetRange.endLine
})

const renderers: Readonly<
  Record<PlatformTarget, (draft: ReviewCommentDraft) => RenderedReviewComment>
> = {
  github: renderGithub,
  gitlab: renderGitlab,
  bitbucket: renderBitbucket,
  generic: renderGeneric
}

export const renderReviewComments = (
  drafts: readonly ReviewCommentDraft[],
  platform: PlatformTarget
): readonly RenderedReviewComment[] => drafts.map(renderers[platform])
