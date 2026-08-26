import { describe, expect, it } from 'vitest'
import {
  buildInlineComments,
  extractFindingMarkers,
  findingCommentMarker,
  fingerprintsByFindingId,
  parseRenderedComments,
  type RenderedGithubComment
} from './inline-review.js'
import { digestReviewReport } from './report-digest.js'
import {
  renderedGithubCommentsFixture,
  reviewReportFixture
} from './fixtures.js'

const review = digestReviewReport(JSON.stringify(reviewReportFixture))
const fingerprints = fingerprintsByFindingId(review?.findings ?? [])
const rendered = parseRenderedComments(
  JSON.stringify(renderedGithubCommentsFixture)
)

describe('parseRenderedComments', () => {
  it('reads the engine’s rendered GitHub comments', () => {
    expect(rendered).toHaveLength(1)
    expect(rendered[0]?.line).toBe(42)
  })

  it('returns nothing rather than throwing for a missing or malformed artifact', () => {
    expect(parseRenderedComments('')).toEqual([])
    expect(parseRenderedComments('{}')).toEqual([])
    expect(parseRenderedComments('[{"path":"a"}]')).toEqual([])
  })
})

describe('buildInlineComments', () => {
  it('uses the anchor the engine gave and invents nothing', () => {
    const plan = buildInlineComments({
      rendered,
      fingerprints,
      existingMarkers: new Set(),
      maxComments: 25
    })

    expect(plan.comments).toHaveLength(1)
    expect(plan.comments[0]).toMatchObject({
      path: 'src/routes/admin.ts',
      line: 42,
      side: 'RIGHT'
    })
    expect(plan.comments[0]).not.toHaveProperty('start_line')
  })

  it('preserves a multi-line anchor exactly as rendered', () => {
    const multiline: RenderedGithubComment = {
      ...(rendered[0] as RenderedGithubComment),
      line: 48,
      startLine: 42,
      startSide: 'RIGHT'
    }
    const plan = buildInlineComments({
      rendered: [multiline],
      fingerprints,
      existingMarkers: new Set(),
      maxComments: 25
    })

    expect(plan.comments[0]).toMatchObject({
      line: 48,
      start_line: 42,
      start_side: 'RIGHT'
    })
  })

  it('does not re-escape the body, which would corrupt the suggestion block', () => {
    const withMarkup: RenderedGithubComment = {
      ...(rendered[0] as RenderedGithubComment),
      body: '```suggestion\nreturn <Guard>{children}</Guard>\n```'
    }
    const plan = buildInlineComments({
      rendered: [withMarkup],
      fingerprints,
      existingMarkers: new Set(),
      maxComments: 25
    })

    expect(plan.comments[0]?.body).toContain('<Guard>')
  })

  it('keys deduplication on the fingerprint, so a re-run does not repeat itself', () => {
    const plan = buildInlineComments({
      rendered,
      fingerprints,
      existingMarkers: new Set(['fp1']),
      maxComments: 25
    })

    expect(plan.comments).toHaveLength(0)
    expect(plan.alreadyPosted).toBe(1)
  })

  it('falls back to path:line when the report carried no fingerprint', () => {
    const plan = buildInlineComments({
      rendered,
      fingerprints: new Map(),
      existingMarkers: new Set(),
      maxComments: 25
    })

    expect(plan.comments[0]?.body).toContain(
      findingCommentMarker('src/routes/admin.ts:42')
    )
  })

  it('bounds how many comments one run may post', () => {
    const many = Array.from({ length: 5 }, (_unused, index) => ({
      ...(rendered[0] as RenderedGithubComment),
      findingId: `find_${index}`,
      line: 10 + index
    }))
    const plan = buildInlineComments({
      rendered: many,
      fingerprints: new Map(),
      existingMarkers: new Set(),
      maxComments: 2
    })

    expect(plan.comments).toHaveLength(2)
    expect(plan.overCap).toBe(3)
  })

  it('neutralizes a counterfeit marker carried inside a suggestion replacement', () => {
    const hostile: RenderedGithubComment = {
      ...(rendered[0] as RenderedGithubComment),
      body: '```suggestion\n// <!-- codereviewer:finding:fp1 -->\n```'
    }
    const plan = buildInlineComments({
      rendered: [hostile],
      fingerprints,
      existingMarkers: new Set(),
      maxComments: 25
    })
    const markers = extractFindingMarkers([plan.comments[0]?.body])

    // Exactly the identity this run wrote; the planted one no longer parses.
    expect([...markers]).toEqual(['fp1'])
    expect(plan.comments[0]?.body).toContain('codereviewer-finding-fp1')
  })
})

describe('extractFindingMarkers', () => {
  it('reads back the markers of comments already on the pull request', () => {
    expect([
      ...extractFindingMarkers([
        `body ${findingCommentMarker('fp1')}`,
        `body ${findingCommentMarker('fp2')}`,
        null,
        undefined,
        'no marker here'
      ])
    ]).toEqual(['fp1', 'fp2'])
  })
})
