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
import {
  MEASURED_ON_MODEL,
  MEASURED_ON_PROVIDER
} from './measured-reliability.js'

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

/**
 * The spend and token lines a Markdown surface prints for one run, rendered once.
 *
 * WHY IT IS SHARED. The review report and the intent-fulfilment report each wrote
 * these three figures out independently and disagreed on the only case that
 * matters: a cost that could not be determined. One said so in words, the other
 * dropped the line, so the same unmeasured figure read two ways depending on which
 * document a reader opened.
 *
 * A FIGURE THAT WAS NOT MEASURED IS NEVER RENDERED AS A NUMBER. An absent cost is
 * stated as unavailable, because a run whose price could not be computed must not
 * be readable as a free one, and an absent token count omits its line rather than
 * printing a zero nobody counted. `cachedInputTokens` is a SUBSET of `inputTokens`,
 * never an addition, and is shown beside it because a warm cache changes spend
 * severalfold with no change to the output.
 *
 * The caller supplies its own heading and any run identity around these lines: what
 * the numbers are is one rule, where they sit is each document's own.
 */
export const renderUsageLines = (
  usage: {
    readonly costUsd?: number | undefined
    readonly inputTokens?: number | undefined
    readonly cachedInputTokens?: number | undefined
    readonly outputTokens?: number | undefined
  }
): readonly string[] => {
  const lines: string[] = [
    usage.costUsd === undefined
      ? '- Cost: unavailable (token counts or model prices were missing)'
      : `- Cost: $${usage.costUsd.toFixed(4)}`
  ]

  if (usage.inputTokens !== undefined) {
    const cached =
      usage.cachedInputTokens === undefined
        ? ''
        : ` (${usage.cachedInputTokens.toLocaleString('en-US')} cached)`

    lines.push(
      `- Input tokens: ${usage.inputTokens.toLocaleString('en-US')}${cached}`
    )
  }

  if (usage.outputTokens !== undefined) {
    lines.push(`- Output tokens: ${usage.outputTokens.toLocaleString('en-US')}`)
  }

  return lines
}

// What a surface says when a finding carries no refutation verdict. It is NOT
// the sentence used for an unresolved finding: "nothing was recorded" and "the
// refuter could not decide" are different facts about the same field, and a
// reader who cannot tell them apart cannot weigh either.
//
// Shared because two surfaces now print it — `report.md` and the inline review
// comment — and the whole point of the wording is that it does not overclaim.
// Two copies is two places for one of them to drift into "unverified".
export const NO_REFUTATION_VERDICT =
  'no verdict was recorded against this finding, so what it survived cannot be shown here.'

/**
 * The sentence that ties a published rate to the model it was measured on, and
 * to the model this run actually used.
 *
 * A rate is a property of a model, not of the engine: the same prompts against
 * a different provider, or a newer version of the same model, are not the thing
 * that was measured. So the comparison is made for the reader rather than left
 * to them — a run on another model is told, in the same breath as the rate, that
 * the rate is not a measurement of it.
 *
 * An unknown model is reported as unknown. It must not fall back to "matches",
 * which would be absence read as agreement.
 */
export const renderMeasuredOn = (
  run: {
    readonly provider?: string | undefined
    readonly model?: string | undefined
  }
): string => {
  const measured = `${MEASURED_ON_PROVIDER}/${MEASURED_ON_MODEL}`

  if (run.model === undefined) {
    return `Measured on ${inlineCode(measured)}. This run did not record which model produced it, so whether those rates describe it cannot be determined here.`
  }

  const used = `${run.provider ?? 'unknown provider'}/${run.model}`

  if (used === measured) {
    return `Measured on ${inlineCode(measured)}, which is the model this run used.`
  }

  return `Measured on ${inlineCode(measured)}. **This run used ${inlineCode(used)}**, so the rates above were not measured on it and may not describe it — a different model changes what is found and what is proved, not just what it costs.`
}

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
