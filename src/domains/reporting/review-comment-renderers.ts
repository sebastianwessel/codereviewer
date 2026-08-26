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
import {
  CODE_FENCE,
  clampEscaped,
  renderFencedBlock
} from './review-comments.js'

type RenderedCommentBase = {
  readonly path: string
  readonly body: string
  readonly findingId: string
  readonly severity: Severity
  readonly category: FindingCategory
}

// GitHub review comment: `side: RIGHT` with absolute line / startLine anchors and
// a native ```suggestion block.
type GithubRenderedComment = RenderedCommentBase & {
  readonly line: number
  readonly side: 'RIGHT'
  readonly startLine?: number
  readonly startSide?: 'RIGHT'
}

// GitLab and Bitbucket comments anchor to the last line of the target range and
// differ only in the fence syntax their suggestion block uses.
type LineAnchoredRenderedComment = RenderedCommentBase & {
  readonly line: number
}

// Generic comment keeps the full range and a plain fenced block (no apply).
type RangeAnchoredRenderedComment = RenderedCommentBase & {
  readonly startLine: number
  readonly endLine: number
}

export type RenderedReviewComment =
  | GithubRenderedComment
  | LineAnchoredRenderedComment
  | RangeAnchoredRenderedComment

// What the body says instead of the block it could not carry. The body already
// says "Suggested fix: <summary>", so dropping the block without this sentence
// tells the reader a fix exists while hiding that a concrete, apply-ready one was
// computed for these exact lines and then withheld — the reader has no reason to
// go looking for it. The neutral artifact is named because it is where the
// structured replacement actually is.
const SUGGESTION_WITHHELD_NOTICE =
  'A ready-to-apply replacement was computed for this fix but does not fit this platform\'s comment size limit; it is recorded in full in `review-comments.json`.'

// Append a rendered suggestion block only when the combined body still fits the
// cap, so truncation can never cut through a code fence.
//
// The cap can bind here even though the neutral layer already checked it: it sizes
// the body against the canonical ` ```suggestion ` fence, while GitLab's fence
// carries an offset suffix (` ```suggestion:-2+0 `), so a draft that fits for
// GitHub can overflow by those few characters on GitLab. When that happens the
// loss is DISCLOSED rather than dropped.
//
// Room for the notice is made by trimming the prose, not by dropping the notice:
// the untrimmed body is written verbatim to `review-comments.json` (the artifact
// the notice names) and the finding id survives as a field on this record, so a
// visibly marked trim costs a reader nothing they cannot recover, while a silently
// missing sentence costs them the fix itself.
const bodyWithBlock = (
  draft: ReviewCommentDraft,
  openingFence: string
): string => {
  if (draft.suggestion === undefined) {
    return draft.body
  }

  const combined = `${draft.body}\n\n${renderFencedBlock(openingFence, draft.suggestion.replacement)}`

  if (combined.length <= REVIEW_COMMENT_BODY_MAX) {
    return combined
  }

  const prose = clampEscaped(
    draft.body,
    REVIEW_COMMENT_BODY_MAX - SUGGESTION_WITHHELD_NOTICE.length - 2
  )

  return `${prose}\n\n${SUGGESTION_WITHHELD_NOTICE}`
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
