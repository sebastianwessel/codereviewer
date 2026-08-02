import { sha256 } from '../../shared/hash/hash.js'
import {
  compareSeverityDescending,
  ReportArtifactSchema,
  ReviewReportSchema,
  type AdmittedFinding,
  type ReportArtifact,
  type ReportFormat,
  type ReviewReport
} from '../../shared/contracts/index.js'
import { redactText } from '../../shared/redaction/redactor.js'

export const validateReviewReport = (report: unknown): ReviewReport =>
  ReviewReportSchema.parse(report)

export const sortAdmittedFindings = (
  findings: readonly AdmittedFinding[]
): readonly AdmittedFinding[] =>
  [...findings].sort((left, right) => {
    const severity = compareSeverityDescending(left.severity, right.severity)

    if (severity !== 0) {
      return severity
    }

    return (
      left.location.path.localeCompare(right.location.path) ||
      left.location.startLine - right.location.startLine ||
      left.title.localeCompare(right.title)
    )
  })

export const safeText = (value: string): string => {
  const redacted = redactText(value)

  return redacted
    .replace(/\r?\n/gu, ' ')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '\\|')
    .replace(/[\\[\]()*!#]/gu, '\\$&')
    .replace(/```/gu, '`\\`\\`')
}

// Redacted plain text for non-Markdown sinks (e.g. SARIF `message.text`). SARIF
// consumers render messages literally, so Markdown escaping would corrupt them;
// we only redact secrets, strip control characters, and collapse whitespace.
export const safeRedactedText = (value: string): string =>
  redactText(value)
    .replace(/[\x00-\x1f\x7f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()

// A path, an identifier or a line of source is full of characters Markdown would
// otherwise eat (`*`, `_`, `[`, backticks). Escaping each one, as prose rendering
// does, leaves a reader reading backslashes instead of code, so code goes in a
// code span instead. The delimiter grows past the longest backtick run in the
// text, which is CommonMark's own answer to a code span containing backticks, so
// no input can break out of the span.
//
// Lives here rather than in one renderer because all three Markdown surfaces
// (`review`, `impact check`, `intent check`) render untrusted code the same way,
// and three copies of a security-relevant escaping rule is three places for it to
// drift.
export const inlineCode = (value: string): string => {
  const text = safeRedactedText(value)

  if (text.length === 0) {
    return '(blank)'
  }

  const longestBacktickRun = [...text.matchAll(/`+/gu)].reduce(
    (longest, match) => Math.max(longest, match[0].length),
    0
  )
  const delimiter = '`'.repeat(longestBacktickRun + 1)
  // A span whose content starts or ends with a backtick needs one space of
  // padding, which CommonMark strips again when rendering.
  const padding = text.startsWith('`') || text.endsWith('`') ? ' ' : ''

  return `${delimiter}${padding}${text}${padding}${delimiter}`
}

export const pluralize = (
  count: number,
  singular: string,
  plural: string
): string => `${count} ${count === 1 ? singular : plural}`

export const createReportArtifact = (
  format: ReportFormat,
  path: string,
  content: string
): ReportArtifact =>
  ReportArtifactSchema.parse({
    format,
    path,
    sha256: sha256(content),
    containsSensitiveContent: false
  })
