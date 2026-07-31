import { z } from 'zod'
import { RepositoryRelativePathSchema, SeveritySchema } from '../config/config.schema.js'
import { ContractIdSchema, FindingCategorySchema } from '../findings/finding.schema.js'

// New-side line range a review comment anchors to.
export const ReviewCommentTargetRangeSchema = z
  .strictObject({
    startLine: z.int().min(1),
    endLine: z.int().min(1)
  })
  .refine((range) => range.endLine >= range.startLine, {
    path: ['endLine'],
    message: 'endLine must be greater than or equal to startLine.'
  })

// Structured suggested replacement for `targetRange`. This is deliberately NOT a
// pre-rendered fenced block: platform renderers turn it into native suggestion
// syntax. The replacement is already redacted and fence-free by construction.
export const ReviewCommentSuggestionSchema = z.strictObject({
  replacement: z.string().min(1).max(4000)
})

// Maximum rendered comment body length. The contract enforces the cap (so it
// stays representable in the generated JSON Schema) and the neutral draft layer
// and every platform renderer check against this same constant, so a suggestion
// block can never be truncated mid-fence.
export const REVIEW_COMMENT_BODY_MAX = 3000

// Platform-neutral inline review-comment draft rendered from an admitted finding.
// The `body` is redacted and Markdown-escaped; the optional `suggestion` carries
// the structured replacement for `targetRange`.
export const ReviewCommentDraftSchema = z.strictObject({
  path: RepositoryRelativePathSchema,
  targetRange: ReviewCommentTargetRangeSchema,
  body: z.string().min(1).max(REVIEW_COMMENT_BODY_MAX),
  suggestion: ReviewCommentSuggestionSchema.optional(),
  findingId: ContractIdSchema,
  severity: SeveritySchema,
  category: FindingCategorySchema
})

export type ReviewCommentTargetRange = z.infer<
  typeof ReviewCommentTargetRangeSchema
>
export type ReviewCommentSuggestion = z.infer<
  typeof ReviewCommentSuggestionSchema
>
export type ReviewCommentDraft = z.infer<typeof ReviewCommentDraftSchema>
