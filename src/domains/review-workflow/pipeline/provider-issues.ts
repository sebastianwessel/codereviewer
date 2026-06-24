import {
  ReviewReportSchema,
  type ReviewReport
} from '../../../shared/contracts/index.js'
import { normalizeError } from '../../../shared/errors/error-normalizer.js'

export type ProviderIssue = ReviewReport['providerIssues'][number]

export type ProviderIssueForError = (input: {
  readonly error: unknown
  readonly stage: string
  readonly recovered: boolean
}) => ProviderIssue

export const providerIssueForError: ProviderIssueForError = (input) => {
  const normalized = normalizeError(input.error, {
    source: 'provider',
    operation: input.stage
  })

  return ReviewReportSchema.shape.providerIssues.element.parse({
    code: normalized.code,
    stage: input.stage,
    recovered: input.recovered,
    message: normalized.message.slice(0, 500)
  })
}
