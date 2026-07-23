// Per-platform review-comment renderers (spec 13). Renderers are pure and
// deterministic. Redaction, Markdown escaping, the fence-breakout guard, and the
// body-length cap are enforced once in the neutral layer (`review-comments.ts`)
// and inherited here; each renderer only turns the structured suggestion into the
// platform's native syntax and re-checks the body cap so a fence is never
// truncated.
import type {
  FindingCategory,
  PlatformTarget,
  ReviewCommentDraft,
  Severity
} from '../../shared/contracts/index.js'
import { maxCommentBodyLength } from './review-comments.js'

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

// GitLab / Bitbucket comments anchor to the last line of the target range.
export type GitlabRenderedComment = RenderedCommentBase & {
  readonly line: number
}

export type BitbucketRenderedComment = RenderedCommentBase & {
  readonly line: number
}

// Generic comment keeps the full range and a plain fenced block (no apply).
export type GenericRenderedComment = RenderedCommentBase & {
  readonly startLine: number
  readonly endLine: number
}

export type RenderedReviewComment =
  | GithubRenderedComment
  | GitlabRenderedComment
  | BitbucketRenderedComment
  | GenericRenderedComment

// Append a rendered suggestion block only when the combined body still fits the
// cap, so truncation can never cut through a code fence.
const bodyWithBlock = (
  draft: ReviewCommentDraft,
  block: string | undefined
): string => {
  if (block === undefined) {
    return draft.body
  }

  const combined = `${draft.body}\n\n${block}`

  return combined.length <= maxCommentBodyLength ? combined : draft.body
}

const fencedBlock = (
  header: string,
  replacement: string
): string => [header, replacement, '```'].join('\n')

const renderGithub = (draft: ReviewCommentDraft): GithubRenderedComment => {
  const block =
    draft.suggestion === undefined
      ? undefined
      : fencedBlock('```suggestion', draft.suggestion.replacement)
  const multiline = draft.targetRange.endLine > draft.targetRange.startLine

  return {
    path: draft.path,
    line: draft.targetRange.endLine,
    side: 'RIGHT',
    ...(multiline
      ? { startLine: draft.targetRange.startLine, startSide: 'RIGHT' as const }
      : {}),
    body: bodyWithBlock(draft, block),
    findingId: draft.findingId,
    severity: draft.severity,
    category: draft.category
  }
}

const renderGitlab = (draft: ReviewCommentDraft): GitlabRenderedComment => {
  // GitLab suggestion syntax is ```suggestion:-x+y anchored on a single line: `x`
  // lines above and `y` lines below the commented line are replaced together with
  // it. We anchor on the range's last line and extend upward, so `x` is the span
  // above and `y` is always 0.
  const above = draft.targetRange.endLine - draft.targetRange.startLine
  const block =
    draft.suggestion === undefined
      ? undefined
      : fencedBlock(`\`\`\`suggestion:-${above}+0`, draft.suggestion.replacement)

  return {
    path: draft.path,
    line: draft.targetRange.endLine,
    body: bodyWithBlock(draft, block),
    findingId: draft.findingId,
    severity: draft.severity,
    category: draft.category
  }
}

const renderBitbucket = (
  draft: ReviewCommentDraft
): BitbucketRenderedComment => {
  // Bitbucket has no one-click apply, so the suggestion degrades to a readable
  // plain fenced code block on the range's last line.
  const block =
    draft.suggestion === undefined
      ? undefined
      : fencedBlock('```', draft.suggestion.replacement)

  return {
    path: draft.path,
    line: draft.targetRange.endLine,
    body: bodyWithBlock(draft, block),
    findingId: draft.findingId,
    severity: draft.severity,
    category: draft.category
  }
}

const renderGeneric = (draft: ReviewCommentDraft): GenericRenderedComment => {
  const block =
    draft.suggestion === undefined
      ? undefined
      : fencedBlock('```', draft.suggestion.replacement)

  return {
    path: draft.path,
    startLine: draft.targetRange.startLine,
    endLine: draft.targetRange.endLine,
    body: bodyWithBlock(draft, block),
    findingId: draft.findingId,
    severity: draft.severity,
    category: draft.category
  }
}

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
