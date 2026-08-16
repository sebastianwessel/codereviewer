// Spec 30's fingerprint-only boundary, in code.
//
// A reply on a review comment can nominate the finding that comment carries for a
// second, independent look. Re-adjudication itself needs nothing here at all: it
// is the same `review` stage every push already runs, byte-identical, run again
// from `pipeline.ts`. What this module owns is the two things spec 30 actually
// requires:
//
//   (a) recognising that a reply happened and what it points at — the id of the
//       comment being replied to, and NOTHING else about the reply. `body`,
//       `user`, and every other field GitHub sends on the reply are deliberately
//       UNDECLARED in the schema below — not filtered, not redacted, simply never
//       parsed — so nothing downstream of this module can read the reply's text
//       even by accident, let alone forward it into a packet;
//   (b) comparing the fingerprint(s) the PARENT comment names — the engine's own
//       earlier finding comment, read by id, never the reply — against this run's
//       own findings, once that run has completed.
//
// `extractFindingMarkers` is reused from `inline-review.ts` rather than
// reimplemented: it is already the parser that reads a finding's fingerprint out
// of a comment body for deduplication, and spec 30 requires reusing it rather than
// writing a second one.
import { z } from 'zod'
import { isArtifactOnlyFinding } from '../../src/shared/contracts/index.js'
import { extractFindingMarkers } from './inline-review.js'
import type { FindingDigest } from './report-digest.js'

const REVIEW_COMMENT_REPLY_EVENT = 'pull_request_review_comment'

// Reduced to the one field spec 30 allows across the boundary. `z.object` (not
// `z.strictObject`) is deliberate here, matching `pull-request-context.ts`: an
// external payload is parsed for the fields this module reads, and every other
// field GitHub sends is dropped by the parse rather than rejected by it.
const ReviewCommentReplyEventSchema = z.object({
  action: z.string(),
  comment: z.object({
    // Present only when the new comment is itself a reply. Absent on a fresh,
    // top-level review comment — which nominates nothing, by construction.
    in_reply_to_id: z.number().int().min(1).nullish()
  })
})

export type ReviewConversationTrigger = {
  /** The id of the review comment the reply targets. Never the reply's own id. */
  readonly parentCommentId: number
}

/**
 * Reads a reply's target out of a GitHub Actions event, or `undefined` when this
 * event is not one spec 30 acts on: any event that is not
 * `pull_request_review_comment`, any action other than `created` — the only one
 * the workflow subscribes to, checked again here in case that ever changes
 * without this module changing with it — and any review comment that is not
 * itself a reply.
 */
export const parseReviewConversationTrigger = (input: {
  readonly eventName: string
  readonly eventPayload: string
}): ReviewConversationTrigger | undefined => {
  if (input.eventName !== REVIEW_COMMENT_REPLY_EVENT) {
    return undefined
  }

  let payload: unknown

  try {
    payload = JSON.parse(input.eventPayload)
  } catch {
    return undefined
  }

  const parsed = ReviewCommentReplyEventSchema.safeParse(payload)

  if (!parsed.success || parsed.data.action !== 'created') {
    return undefined
  }

  const parentCommentId = parsed.data.comment.in_reply_to_id

  return parentCommentId === undefined || parentCommentId === null
    ? undefined
    : { parentCommentId }
}

/**
 * Every finding fingerprint the parent comment names.
 *
 * Reuses the SAME parser that already deduplicates inline comments rather than a
 * second one, and reads only the parent's body — the engine's own earlier
 * comment, located by id. The reply's body is never a parameter of this function
 * and cannot be, because nothing upstream of it ever parsed one.
 */
export const resolveNominatedFingerprints = (
  parentCommentBody: string | null | undefined
): ReadonlySet<string> => extractFindingMarkers([parentCommentBody])

export type ReviewConversationStatus = 'held' | 'no-longer-reported' | 'undecided'

export type ReviewConversationOutcome = {
  readonly fingerprint: string
  readonly status: ReviewConversationStatus
  /** Present for `held` and `undecided` — this run's own matching finding. */
  readonly finding?: FindingDigest
}

/**
 * What this run's own findings say about each nominated fingerprint.
 *
 * This is exactly the comparison `noLongerReportedCount` already makes for every
 * earlier-commented finding, narrowed to the ones a reply named, with the
 * three-way distinction spec 30 requirement 3 asks for: `held` (reported again,
 * and not merely as an open question), `undecided` (reported again, but
 * refutation still could neither prove nor disprove it — `reporterEligibility:
 * artifact-only`), or `no-longer-reported` (its fingerprint matches nothing this
 * run found). The last status is deliberately never "withdrawn": this comparison
 * cannot tell a genuine withdrawal from a finding this run simply did not
 * reproduce, and saying so is the whole point of the wording.
 */
export const resolveReviewConversationOutcomes = (input: {
  readonly nominatedFingerprints: ReadonlySet<string>
  readonly findings: readonly FindingDigest[]
}): readonly ReviewConversationOutcome[] => {
  const byFingerprint = new Map(
    input.findings
      .filter(
        (finding): finding is FindingDigest & { fingerprint: string } =>
          finding.fingerprint !== undefined
      )
      .map((finding) => [finding.fingerprint, finding])
  )

  return [...input.nominatedFingerprints].sort().map((fingerprint) => {
    const finding = byFingerprint.get(fingerprint)

    if (finding === undefined) {
      return { fingerprint, status: 'no-longer-reported' as const }
    }

    return {
      fingerprint,
      // The engine's own predicate: `undecided` must mean exactly what the
      // report artifacts and the summary comment mean by an open question, or a
      // reply would be answered with a status no other surface agrees with.
      status: isArtifactOnlyFinding(finding)
        ? ('undecided' as const)
        : ('held' as const),
      finding
    }
  })
}
