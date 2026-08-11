import {
  normalizeError,
  type StructuredError
} from '../../shared/errors/error-normalizer.js'
import type {
  PlatformTarget,
  ReportArtifact,
  ReportFormat,
  ReviewReport
} from '../../shared/contracts/index.js'
import { redactText } from '../../shared/redaction/redactor.js'
import type { JsonValue } from '../../shared/json/json-value.js'
import { createReportArtifact, validateReviewReport } from './reporting-utils.js'
import {
  buildReviewCommentDrafts,
  type ReviewCommentFileReader
} from './review-comments.js'
import { renderReviewComments } from './review-comment-renderers.js'
import { renderMarkdownReport } from './markdown-reporter.js'
import { renderSarifReport, type SarifRenderOptions } from './sarif-reporter.js'

export type ReportArtifactWriter = (
  path: string,
  content: string
) => Promise<void>

export type WrittenReportArtifact = {
  readonly artifact: ReportArtifact
  readonly content: string
}

// Pretty-prints for a human-readable artifact. Deliberately NOT canonical: it
// preserves insertion order and does not sort keys, so its output must never be
// used as a digest input. The canonical, key-sorting serializer digests are
// taken over is `stableJsonDigest` in `shared/json/`.
const prettyJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

const redactJsonValue = (value: unknown): JsonValue | undefined => {
  if (value === undefined) {
    return undefined
  }

  if (typeof value === 'string') {
    return redactText(value)
  }

  if (Array.isArray(value)) {
    return value
      .map(redactJsonValue)
      .filter((item): item is JsonValue => item !== undefined)
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        redactJsonValue(nestedValue)
      ])
    ) as { readonly [key: string]: JsonValue | undefined }
  }

  return typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
    ? value
    : undefined
}

export const renderJsonReport = (report: unknown): string =>
  prettyJson(redactJsonValue(validateReviewReport(report)) ?? null)

export const writeReportingArtifacts = async (
  input: {
    readonly report: ReviewReport
    readonly writer: ReportArtifactWriter
    readonly formats?: readonly ReportFormat[]
    readonly sarif?: SarifRenderOptions
    // Presence enables review-comment rendering; `platform` is already resolved
    // (never `auto`) by the caller's detection.
    //
    // `readCurrentFile` is required rather than optional so that no caller can
    // reach the suggestion apply-check by accident. Supplying `undefined` means
    // "these bytes are not available here", and the drafts fail closed on it.
    readonly reviewComments?: {
      readonly platform: PlatformTarget
      readonly readCurrentFile: ReviewCommentFileReader | undefined
    }
    // Spec 13 "Observability And Errors": the drafting step reports how many drafts
    // and how many suggestions it produced. The counts exist only here, where the
    // drafts are built, and building them twice to count them elsewhere would let
    // the reported number drift from the written artifact.
    readonly onReviewComments?: (metrics: {
      readonly draftCount: number
      readonly suggestionCount: number
    }) => void
  }
): Promise<readonly WrittenReportArtifact[]> => {
  const report = validateReviewReport(input.report)
  const formats = new Set<ReportFormat>(input.formats ?? ['json', 'markdown', 'sarif'])
  const sarifOptions = input.sarif ?? {
    category: 'codereviewer',
    maxResults: 5000,
    target: 'generic'
  }
  const nonJsonArtifacts: WrittenReportArtifact[] = []

  if (formats.has('markdown')) {
    const markdown = renderMarkdownReport(report)
    nonJsonArtifacts.push({
      artifact: createReportArtifact('markdown', 'report.md', markdown),
      content: markdown
    })
  }

  if (formats.has('sarif')) {
    const sarif = renderSarifReport(report, sarifOptions)
    nonJsonArtifacts.push({
      artifact: createReportArtifact('sarif', 'report.sarif', sarif),
      content: sarif
    })
  }

  if (input.reviewComments !== undefined) {
    const drafts = await buildReviewCommentDrafts(report, {
      readCurrentFile: input.reviewComments.readCurrentFile
    })
    input.onReviewComments?.({
      draftCount: drafts.length,
      suggestionCount: drafts.filter((draft) => draft.suggestion !== undefined)
        .length
    })
    const neutral = prettyJson(drafts)
    // Neutral drafts are the source of truth; the JSON artifact `format` field is
    // the closed `ReportFormat` enum, so review-comment files record as `json`.
    nonJsonArtifacts.push({
      artifact: createReportArtifact('json', 'review-comments.json', neutral),
      content: neutral
    })

    const { platform } = input.reviewComments
    const rendered = prettyJson(renderReviewComments(drafts, platform))
    nonJsonArtifacts.push({
      artifact: createReportArtifact(
        'json',
        `review-comments.${platform}.json`,
        rendered
      ),
      content: rendered
    })
  }

  const reportWithArtifacts = validateReviewReport({
    ...report,
    artifacts: nonJsonArtifacts.map((artifact) => artifact.artifact)
  })
  const jsonContent = renderJsonReport(reportWithArtifacts)
  const artifacts: WrittenReportArtifact[] = [
    {
      artifact: createReportArtifact('json', 'report.json', jsonContent),
      content: jsonContent
    },
    ...nonJsonArtifacts
  ]

  try {
    for (const artifact of artifacts) {
      await input.writer(artifact.artifact.path, artifact.content)
    }

    return artifacts
  } catch (error) {
    const normalized = normalizeError(error, {
      source: 'report',
      operation: 'write_reporting_artifacts'
    })

    throw {
      ...normalized,
      code: 'report_error'
    } satisfies StructuredError
  }
}
