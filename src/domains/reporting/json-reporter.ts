import {
  normalizeError,
  type StructuredError
} from '../../shared/errors/error-normalizer.js'
import type {
  ReportArtifact,
  ReportFormat,
  ReviewReport
} from '../../shared/contracts/index.js'
import { redactText } from '../../shared/redaction/redactor.js'
import { createReportArtifact, validateReviewReport } from './reporting-utils.js'
import { renderGithubReviewComments } from './github-review-comments.js'
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

export type WriteReportingArtifactsOptions = {
  readonly formats?: readonly ReportFormat[]
  readonly sarif?: SarifRenderOptions
}

const stableStringify = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue | undefined }

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
  stableStringify(redactJsonValue(validateReviewReport(report)) ?? null)

export const writeReportingArtifacts = async (
  input: {
    readonly report: ReviewReport
    readonly writer: ReportArtifactWriter
    readonly formats?: readonly ReportFormat[]
    readonly sarif?: SarifRenderOptions
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

  if (formats.has('github-review-comments')) {
    const githubReviewComments = renderGithubReviewComments(report)
    nonJsonArtifacts.push({
      artifact: createReportArtifact(
        'github-review-comments',
        'github-review-comments.json',
        githubReviewComments
      ),
      content: githubReviewComments
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
