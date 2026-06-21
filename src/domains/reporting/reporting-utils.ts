import { sha256 } from '../../shared/hash/hash.js'
import {
  ReportArtifactSchema,
  ReviewReportSchema,
  type AdmittedFinding,
  type ReportArtifact,
  type ReportFormat,
  type ReviewReport,
  type Severity
} from '../../shared/contracts/index.js'
import { redactText } from '../../shared/redaction/redactor.js'

const severityOrder: Readonly<Record<Severity, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4
}

export { sha256 }

export const validateReviewReport = (report: unknown): ReviewReport =>
  ReviewReportSchema.parse(report)

export const sortAdmittedFindings = (
  findings: readonly AdmittedFinding[]
): readonly AdmittedFinding[] =>
  [...findings].sort((left, right) => {
    const severity = severityOrder[left.severity] - severityOrder[right.severity]

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
