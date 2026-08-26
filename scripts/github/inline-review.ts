// Turns the engine's rendered GitHub review comments (spec 13) into the payload
// for one pull-request review.
//
// NO LINE IS INVENTED HERE. Spec 13's GitHub renderer already decided the
// anchor: `line` is the target range's last line with `side: RIGHT`, and a
// multi-line range adds `startLine`/`startSide`. Admission is the only stage
// that holds the reviewed diff ranges, and it is what decided the finding was
// anchorable at all (`reporterEligibility = inline`). This module maps field
// names and nothing else — a finding the engine did not anchor stays in the
// summary comment, where it can be read without a line.
//
// Re-runs are the second problem this solves. Every push produces a new head
// commit, and posting the same defect again on each one buries the pull request.
// Each comment therefore carries a hidden marker keyed by the finding's
// content-anchored FINGERPRINT — not its id, which is generated per run and
// cannot tell a re-reported defect from a new one — and a comment whose marker
// is already present on the pull request is not posted again.
import type { FindingDigest } from './report-digest.js'

const FINDING_MARKER_PREFIX = 'codereviewer:finding:'

// GitHub accepts a much larger comment body than the engine's 3 000-character
// draft cap, so this only guards against a malformed artifact.
const MAX_REVIEW_COMMENT_BODY = 60_000

export const findingCommentMarker = (identity: string): string =>
  `<!-- ${FINDING_MARKER_PREFIX}${identity} -->`

/**
 * Prepare a rendered body for posting.
 *
 * It is NOT Markdown-escaped here, and that is deliberate. Spec 13's neutral
 * layer already escaped the prose (`<` becomes `&lt;`, `>` becomes `&gt;`, so no
 * HTML comment can be formed in it) and deliberately left the suggestion
 * replacement raw, because a ` ```suggestion ` block is code GitHub will apply
 * to the file. Escaping it here would silently corrupt every one-click fix.
 *
 * The one thing that is neutralized is a finding-marker prefix appearing inside
 * the body — a suggestion replacement is raw source, so a repository could carry
 * a counterfeit marker and use it to suppress a future comment.
 */
const guardRenderedBody = (body: string): string =>
  body.slice(0, MAX_REVIEW_COMMENT_BODY).replaceAll(
    FINDING_MARKER_PREFIX,
    FINDING_MARKER_PREFIX.replaceAll(':', '-')
  )

/** Every finding marker present in a set of existing review-comment bodies. */
export const extractFindingMarkers = (
  bodies: readonly (string | null | undefined)[]
): ReadonlySet<string> => {
  const markers = new Set<string>()
  const pattern = new RegExp(
    `<!-- ${FINDING_MARKER_PREFIX}([A-Za-z0-9_:./-]+) -->`,
    'gu'
  )

  for (const body of bodies) {
    if (body === null || body === undefined) {
      continue
    }

    for (const match of body.matchAll(pattern)) {
      const identity = match[1]

      if (identity !== undefined) {
        markers.add(identity)
      }
    }
  }

  return markers
}

/** One entry of `review-comments.github.json`. */
export type RenderedGithubComment = {
  readonly path: string
  readonly body: string
  readonly findingId: string
  readonly line: number
  readonly side: 'RIGHT'
  readonly startLine?: number
  readonly startSide?: 'RIGHT'
}

export type InlineComment = {
  readonly path: string
  readonly body: string
  readonly line: number
  readonly side: 'RIGHT'
  readonly start_line?: number
  readonly start_side?: 'RIGHT'
}

export type InlineCommentPlan = {
  readonly comments: readonly InlineComment[]
  /** Comments not posted because the same finding is already commented on. */
  readonly alreadyPosted: number
  /** Comments dropped by `maxComments`. */
  readonly overCap: number
}

const isRenderedComment = (value: unknown): value is RenderedGithubComment =>
  typeof value === 'object' &&
  value !== null &&
  'path' in value &&
  typeof value.path === 'string' &&
  'body' in value &&
  typeof value.body === 'string' &&
  'findingId' in value &&
  typeof value.findingId === 'string' &&
  'line' in value &&
  typeof value.line === 'number' &&
  Number.isInteger(value.line) &&
  value.line >= 1

export const parseRenderedComments = (
  raw: string
): readonly RenderedGithubComment[] => {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  return Array.isArray(parsed) ? parsed.filter(isRenderedComment) : []
}

/**
 * The finding's stable identity for comment deduplication: its fingerprint when
 * the report carried one, and `path:line` otherwise. The fallback is weaker —
 * a shifted line re-posts — but it is only reachable for a report that omitted
 * fingerprints, which the engine's contract does not allow.
 */
const commentIdentity = (
  comment: RenderedGithubComment,
  fingerprints: ReadonlyMap<string, string>
): string =>
  fingerprints.get(comment.findingId) ?? `${comment.path}:${comment.line}`

export const fingerprintsByFindingId = (
  findings: readonly FindingDigest[]
): ReadonlyMap<string, string> =>
  new Map(
    findings
      .filter((finding) => finding.fingerprint !== undefined)
      .map((finding) => [finding.id, finding.fingerprint as string])
  )

export const buildInlineComments = (input: {
  readonly rendered: readonly RenderedGithubComment[]
  readonly fingerprints: ReadonlyMap<string, string>
  readonly existingMarkers: ReadonlySet<string>
  readonly maxComments: number
}): InlineCommentPlan => {
  const comments: InlineComment[] = []
  let alreadyPosted = 0
  let overCap = 0

  for (const rendered of input.rendered) {
    const identity = commentIdentity(rendered, input.fingerprints)

    if (input.existingMarkers.has(identity)) {
      alreadyPosted += 1
      continue
    }

    if (comments.length >= input.maxComments) {
      overCap += 1
      continue
    }

    const body = `${guardRenderedBody(rendered.body)}\n\n${findingCommentMarker(identity)}`
    const multiline =
      rendered.startLine !== undefined && rendered.startLine < rendered.line

    comments.push({
      path: rendered.path,
      body,
      line: rendered.line,
      side: 'RIGHT',
      ...(multiline
        ? { start_line: rendered.startLine as number, start_side: 'RIGHT' as const }
        : {})
    })
  }

  return { comments, alreadyPosted, overCap }
}
