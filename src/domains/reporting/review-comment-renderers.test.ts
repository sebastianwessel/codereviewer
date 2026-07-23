import { describe, expect, test } from 'vitest'
import type { ReviewCommentDraft } from '../../shared/contracts/index.js'
import { renderReviewComments } from './review-comment-renderers.js'

const multilineDraft: ReviewCommentDraft = {
  path: 'src/app.ts',
  targetRange: { startLine: 12, endLine: 14 },
  body: '**HIGH bug:** Title\n\nDescription.\n\nFinding: find_abc123',
  suggestion: { replacement: 'if (order === null) {\n  return []\n}' },
  findingId: 'find_abc123',
  severity: 'high',
  category: 'bug'
}

const singleLineNoSuggestion: ReviewCommentDraft = {
  path: 'src/app.ts',
  targetRange: { startLine: 5, endLine: 5 },
  body: '**MEDIUM bug:** No fix here\n\nFinding: find_def456',
  findingId: 'find_def456',
  severity: 'medium',
  category: 'bug'
}

const fenceCount = (text: string): number =>
  (text.match(/```/gu) ?? []).length

describe('review-comment renderers', () => {
  test('GitHub renders side RIGHT with absolute anchors and a ```suggestion block', () => {
    const comment = renderReviewComments([multilineDraft], 'github')[0]!

    expect(comment).toEqual({
      path: 'src/app.ts',
      line: 14,
      side: 'RIGHT',
      startLine: 12,
      startSide: 'RIGHT',
      body: expect.stringContaining('```suggestion\nif (order === null) {'),
      findingId: 'find_abc123',
      severity: 'high',
      category: 'bug'
    })
  })

  test('GitHub omits startLine on a single-line range and has no suggestion when absent', () => {
    const comment = renderReviewComments([singleLineNoSuggestion], 'github')[0]!

    expect(comment).not.toHaveProperty('startLine')
    expect(comment.body).not.toContain('```')
  })

  test('GitLab uses an offset-anchored ```suggestion:-x+y block on the last line', () => {
    const comment = renderReviewComments([multilineDraft], 'gitlab')[0]!

    // Range spans lines 12..14: anchored on line 14, replacing 2 lines above.
    expect(comment).toMatchObject({ path: 'src/app.ts', line: 14 })
    expect(comment.body).toContain('```suggestion:-2+0\nif (order === null) {')
  })

  test('Bitbucket degrades to a plain fenced block with no apply affordance', () => {
    const comment = renderReviewComments([multilineDraft], 'bitbucket')[0]!

    expect(comment).toMatchObject({ path: 'src/app.ts', line: 14 })
    expect(comment.body).toContain('```\nif (order === null) {')
    expect(comment.body).not.toContain('```suggestion')
  })

  test('generic keeps the full range and a plain fenced block', () => {
    const comment = renderReviewComments([multilineDraft], 'generic')[0]!

    expect(comment).toMatchObject({
      path: 'src/app.ts',
      startLine: 12,
      endLine: 14
    })
    expect(comment.body).toContain('```\nif (order === null) {')
    expect(comment.body).not.toContain('```suggestion')
  })

  test('every rendered body has balanced fences and no raw source beyond the replacement', () => {
    const platforms = ['github', 'gitlab', 'bitbucket', 'generic'] as const

    for (const platform of platforms) {
      const comment = renderReviewComments([multilineDraft], platform)[0]!
      // Balanced fences => never an unterminated code fence.
      expect(fenceCount(comment.body) % 2).toBe(0)
      // The only source-shaped text is the eligibility-checked replacement.
      const withoutReplacement = comment.body.replace(
        multilineDraft.suggestion!.replacement,
        ''
      )
      expect(withoutReplacement).not.toContain('order.items')
    }
  })

  test('a suggestion that overflows the body cap degrades to prose only', () => {
    const overflowDraft: ReviewCommentDraft = {
      path: 'src/app.ts',
      targetRange: { startLine: 1, endLine: 1 },
      body: 'x'.repeat(2990),
      suggestion: { replacement: 'y'.repeat(100) },
      findingId: 'find_over1',
      severity: 'low',
      category: 'bug'
    }
    const comment = renderReviewComments([overflowDraft], 'github')[0]!

    expect(comment.body).not.toContain('```')
    expect(comment.body.length).toBeLessThanOrEqual(3000)
  })
})
