import { z } from 'zod'
import {
  FindingCategorySchema,
  RepositoryRelativePathSchema,
  SeveritySchema,
  type AdmittedFinding,
  type FixEdit,
  type ReviewReport
} from '../../shared/contracts/index.js'
import { redactText } from '../../shared/redaction/redactor.js'
import { safeText, validateReviewReport } from './reporting-utils.js'

const maxCommentBodyLength = 3000

export const GithubReviewCommentDraftSchema = z.strictObject({
  path: RepositoryRelativePathSchema,
  line: z.int().min(1),
  side: z.literal('RIGHT'),
  startLine: z.int().min(1).optional(),
  startSide: z.literal('RIGHT').optional(),
  body: z.string().min(1).max(3000),
  findingId: z.string().min(1),
  severity: SeveritySchema,
  category: FindingCategorySchema
})

export type GithubReviewCommentDraft = z.infer<
  typeof GithubReviewCommentDraftSchema
>

const stableStringify = (value: unknown): string =>
  `${JSON.stringify(value, null, 2)}\n`

const commentRangeFor = (
  finding: AdmittedFinding
): { readonly line: number; readonly startLine?: number } => {
  const line = finding.location.endLine ?? finding.location.startLine

  return finding.location.endLine !== undefined &&
    finding.location.endLine > finding.location.startLine
    ? { line, startLine: finding.location.startLine }
    : { line }
}

const editMatchesCommentRange = (
  edit: FixEdit,
  finding: AdmittedFinding
): boolean => {
  const range = commentRangeFor(finding)
  const startLine = range.startLine ?? range.line

  return (
    edit.path === finding.location.path &&
    edit.startLine === startLine &&
    edit.endLine === range.line &&
    edit.endLine >= edit.startLine
  )
}

const suggestionFor = (finding: AdmittedFinding): string | undefined => {
  const edits = finding.fixProposal?.edits ?? []

  if (
    finding.fixProposal?.safety !== 'manual-review' ||
    edits.length !== 1 ||
    !editMatchesCommentRange(edits[0]!, finding)
  ) {
    return undefined
  }

  const replacement = redactText(edits[0]!.replacement).replace(/\r\n/gu, '\n')

  // A GitHub ```suggestion block must use exactly a triple-backtick fence, so a
  // replacement that itself contains a code fence cannot be represented without
  // letting it break out of the block. Omit the suggestion in that case.
  if (replacement.includes('```')) {
    return undefined
  }

  return ['```suggestion', replacement, '```'].join('\n')
}

const bodyFor = (finding: AdmittedFinding): string => {
  // User/model-controlled text is Markdown-escaped (not just redacted) because
  // GitHub renders the comment body as Markdown (spec 07 report-injection).
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

  const base = lines.join('\n')
  const suggestion = suggestionFor(finding)

  // Append the suggestion block only when it fits, so truncation can never cut
  // through a code fence and leave it unterminated.
  if (suggestion !== undefined) {
    const withSuggestion = `${base}\n\n${suggestion}`

    if (withSuggestion.length <= maxCommentBodyLength) {
      return withSuggestion
    }
  }

  return base.slice(0, maxCommentBodyLength)
}

const commentFor = (
  finding: AdmittedFinding
): GithubReviewCommentDraft | undefined => {
  if (
    finding.reporterEligibility !== 'inline' ||
    finding.location.side !== 'new'
  ) {
    return undefined
  }

  const range = commentRangeFor(finding)

  return GithubReviewCommentDraftSchema.parse({
    path: finding.location.path,
    line: range.line,
    side: 'RIGHT',
    ...(range.startLine === undefined
      ? {}
      : { startLine: range.startLine, startSide: 'RIGHT' }),
    body: bodyFor(finding),
    findingId: finding.id,
    severity: finding.severity,
    category: finding.category
  })
}

export const buildGithubReviewComments = (
  input: unknown
): readonly GithubReviewCommentDraft[] => {
  const report: ReviewReport = validateReviewReport(input)

  return report.admittedFindings
    .map(commentFor)
    .filter((comment): comment is GithubReviewCommentDraft => comment !== undefined)
}

export const renderGithubReviewComments = (input: unknown): string =>
  stableStringify(buildGithubReviewComments(input))
