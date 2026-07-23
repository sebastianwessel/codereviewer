import { describe, expect, test } from 'vitest'
import { ReviewCommentDraftSchema } from '../../shared/contracts/index.js'
import { createReportFixture } from './reporting-fixture.js'
import { buildReviewCommentDrafts } from './review-comments.js'

describe('neutral review-comment drafts', () => {
  test('builds an inline new-side draft with a structured single-edit suggestion', () => {
    const report = createReportFixture()
    const finding = report.admittedFindings[0]!
    const drafts = buildReviewCommentDrafts({
      ...report,
      admittedFindings: [
        {
          ...finding,
          location: {
            path: 'src/app.ts',
            startLine: 12,
            endLine: 13,
            side: 'new'
          },
          fixProposal: {
            summary: 'Guard the nullable order before reading items.',
            evidenceIds: finding.admissionEvidenceIds,
            safety: 'manual-review',
            edits: [
              {
                path: 'src/app.ts',
                startLine: 12,
                endLine: 13,
                replacement:
                  'if (order === null) {\n  return []\n}\nreturn order.items'
              }
            ]
          }
        }
      ]
    })

    expect(drafts).toHaveLength(1)
    const draft = drafts[0]!
    // Every draft round-trips through the neutral contract schema.
    expect(ReviewCommentDraftSchema.parse(draft)).toEqual(draft)
    expect(draft).toEqual({
      path: 'src/app.ts',
      targetRange: { startLine: 12, endLine: 13 },
      body: expect.stringContaining('Guard the nullable order'),
      suggestion: {
        replacement: 'if (order === null) {\n  return []\n}\nreturn order.items'
      },
      findingId: finding.id,
      severity: finding.severity,
      category: finding.category
    })
    // The neutral body never carries a pre-rendered fence; the suggestion is
    // structured and rendered per platform.
    expect(draft.body).not.toContain('```')
  })

  test('drops summary-only, old-side, and multi-edit suggestions', () => {
    const report = createReportFixture()
    const finding = report.admittedFindings[0]!
    const drafts = buildReviewCommentDrafts({
      ...report,
      admittedFindings: [
        {
          ...finding,
          id: 'find_summary1',
          reporterEligibility: 'summary-only'
        },
        {
          ...finding,
          id: 'find_old1',
          reporterEligibility: 'inline',
          location: { path: 'src/app.ts', startLine: 10, side: 'old' }
        },
        {
          ...finding,
          id: 'find_multi1',
          reporterEligibility: 'inline',
          fixProposal: {
            summary: 'Two edits need human review.',
            evidenceIds: finding.admissionEvidenceIds,
            safety: 'manual-review',
            edits: [
              {
                path: finding.location.path,
                startLine: finding.location.startLine,
                endLine: finding.location.startLine,
                replacement: 'first'
              },
              {
                path: finding.location.path,
                startLine: finding.location.startLine + 1,
                endLine: finding.location.startLine + 1,
                replacement: 'second'
              }
            ]
          }
        }
      ]
    })

    // Only the multi-edit inline finding is emitted, and without a suggestion.
    expect(drafts).toHaveLength(1)
    expect(drafts[0]!.findingId).toBe('find_multi1')
    expect(drafts[0]!.suggestion).toBeUndefined()
  })

  test('drops a suggestion whose edit range does not map to the target range', () => {
    const report = createReportFixture()
    const finding = report.admittedFindings[0]!
    const drafts = buildReviewCommentDrafts({
      ...report,
      admittedFindings: [
        {
          ...finding,
          location: { path: 'src/app.ts', startLine: 12, endLine: 13, side: 'new' },
          fixProposal: {
            summary: 'Range mismatch.',
            evidenceIds: finding.admissionEvidenceIds,
            safety: 'manual-review',
            edits: [
              {
                path: 'src/app.ts',
                startLine: 12,
                endLine: 14,
                replacement: 'mismatched'
              }
            ]
          }
        }
      ]
    })

    expect(drafts[0]!.suggestion).toBeUndefined()
    expect(drafts[0]!.body).toContain('Range mismatch.')
  })

  test('drops a suggestion whose replacement contains a code fence', () => {
    const report = createReportFixture()
    const finding = report.admittedFindings[0]!
    const drafts = buildReviewCommentDrafts({
      ...report,
      admittedFindings: [
        {
          ...finding,
          location: { path: 'src/app.ts', startLine: 12, endLine: 13, side: 'new' },
          fixProposal: {
            summary: 'Fence in replacement.',
            evidenceIds: finding.admissionEvidenceIds,
            safety: 'manual-review',
            edits: [
              {
                path: 'src/app.ts',
                startLine: 12,
                endLine: 13,
                replacement: 'const x = 1\n```\nbreakout'
              }
            ]
          }
        }
      ]
    })

    expect(drafts[0]!.suggestion).toBeUndefined()
  })

  test('escapes Markdown metacharacters in untrusted body text', () => {
    const report = createReportFixture()
    const finding = report.admittedFindings[0]!
    const drafts = buildReviewCommentDrafts({
      ...report,
      admittedFindings: [
        {
          ...finding,
          title: 'Bug ```injected``` [x](javascript:alert(1))',
          description: 'See ```suggestion\nmalicious()\n``` here.',
          location: { path: 'src/app.ts', startLine: 12, endLine: 13, side: 'new' }
        }
      ]
    })

    const body = drafts[0]!.body
    expect(body).not.toContain('```')
    expect(body).not.toContain('](javascript:')
  })
})
