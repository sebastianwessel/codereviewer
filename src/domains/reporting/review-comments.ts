// Platform-neutral review-comment drafts (spec 13). This layer owns every safety
// guard once — inline eligibility, new-side only, redaction, Markdown escaping,
// and suggestion eligibility — so the per-platform renderers stay pure and
// inherit the guards. The neutral draft carries a STRUCTURED suggestion (the
// replacement text + target range), never a pre-rendered fenced block.
import {
  ReviewCommentDraftSchema,
  type AdmittedFinding,
  type FixEdit,
  type ReviewCommentDraft,
  type ReviewCommentTargetRange,
  type ReviewReport
} from '../../shared/contracts/index.js'
import { redactText } from '../../shared/redaction/redactor.js'
import { safeText, validateReviewReport } from './reporting-utils.js'

// Shared body-length cap, enforced once here and inherited by every renderer so a
// suggestion block can never be truncated mid-fence.
export const maxCommentBodyLength = 3000

const targetRangeFor = (finding: AdmittedFinding): ReviewCommentTargetRange => ({
  startLine: finding.location.startLine,
  endLine: finding.location.endLine ?? finding.location.startLine
})

// Redacted, LF-normalized replacement used both for the structural fence guard
// and as the emitted suggestion replacement.
const normalizedReplacement = (edit: FixEdit): string =>
  redactText(edit.replacement).replace(/\r\n/gu, '\n')

const editMatchesTargetRange = (
  edit: FixEdit,
  finding: AdmittedFinding,
  targetRange: ReviewCommentTargetRange
): boolean =>
  edit.path === finding.location.path &&
  edit.startLine === targetRange.startLine &&
  edit.endLine === targetRange.endLine &&
  edit.endLine >= edit.startLine

// The structured suggestion is emitted only when a single admitted fix edit maps
// exactly to the comment range, the fix is manual-review, the redacted
// replacement carries no triple-backtick fence, and a canonically rendered
// suggestion still fits the body cap.
const suggestionFor = (
  finding: AdmittedFinding,
  targetRange: ReviewCommentTargetRange,
  body: string
): string | undefined => {
  const edits = finding.fixProposal?.edits ?? []

  if (
    finding.fixProposal?.safety !== 'manual-review' ||
    edits.length !== 1 ||
    !editMatchesTargetRange(edits[0]!, finding, targetRange)
  ) {
    return undefined
  }

  const replacement = normalizedReplacement(edits[0]!)

  // A ```suggestion block must use exactly a triple-backtick fence, so a
  // replacement that itself contains a code fence cannot be represented without
  // letting it break out of the block. Drop the suggestion in that case.
  if (replacement.includes('```')) {
    return undefined
  }

  // Body-cap fit is checked against a canonical (```suggestion) rendering. A
  // replacement that cannot fit degrades to a prose-only draft.
  const canonical = `${body}\n\n${['```suggestion', replacement, '```'].join('\n')}`

  return canonical.length <= maxCommentBodyLength ? replacement : undefined
}

// Redacted, Markdown-escaped prose body: severity, category, title, description,
// finding id, and the fix summary when present. Never carries raw source.
const bodyFor = (finding: AdmittedFinding): string => {
  const lines = [
    `**${safeText(finding.severity.toUpperCase())} ${safeText(finding.category)}:** ${safeText(finding.title)}`,
    '',
    safeText(finding.description),
    '',
    `Finding: ${safeText(finding.id)}`
  ]

  if (finding.fixProposal !== undefined) {
    lines.push('', `Suggested fix: ${safeText(finding.fixProposal.summary)}`)
  }

  return lines.join('\n').slice(0, maxCommentBodyLength)
}

const draftFor = (
  finding: AdmittedFinding
): ReviewCommentDraft | undefined => {
  if (
    finding.reporterEligibility !== 'inline' ||
    finding.location.side !== 'new'
  ) {
    return undefined
  }

  const targetRange = targetRangeFor(finding)
  const body = bodyFor(finding)
  const replacement = suggestionFor(finding, targetRange, body)

  return ReviewCommentDraftSchema.parse({
    path: finding.location.path,
    targetRange,
    body,
    ...(replacement === undefined ? {} : { suggestion: { replacement } }),
    findingId: finding.id,
    severity: finding.severity,
    category: finding.category
  })
}

export const buildReviewCommentDrafts = (
  input: unknown
): readonly ReviewCommentDraft[] => {
  const report: ReviewReport = validateReviewReport(input)

  return report.admittedFindings
    .map(draftFor)
    .filter((draft): draft is ReviewCommentDraft => draft !== undefined)
}
