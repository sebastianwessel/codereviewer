import { describe, expect, it } from 'vitest'
import {
  renderSummaryComment,
  selectSummaryComment,
  summaryCommentMarker,
  type SummaryCommentInput
} from './summary-comment.js'
import { MAX_ISSUE_COMMENT_BODY } from './sanitize.js'
import {
  digestImpactReport,
  digestIntentReport,
  digestReviewReport
} from './report-digest.js'
import {
  classifyStageOutcome,
  stageDefinitions,
  type StageDefinition
} from './stage-outcomes.js'
import {
  impactReportFixture,
  intentReportFixture,
  reviewReportFixture
} from './fixtures.js'

const stage = (id: string): StageDefinition =>
  stageDefinitions.find((definition) => definition.id === id) as StageDefinition

const passingOutcomes = stageDefinitions.map((definition) =>
  classifyStageOutcome(definition, { exitCode: 0, stdout: '{}', stderr: '' })
)

const baseInput = (
  overrides: Partial<SummaryCommentInput> = {}
): SummaryCommentInput => ({
  markerKey: 'default',
  outcomes: passingOutcomes,
  headSha: 'abc123',
  notes: [],
  ...overrides
})

describe('summaryCommentMarker', () => {
  it('is stable for a key, which is how a later run finds the comment', () => {
    expect(summaryCommentMarker('default')).toBe(
      '<!-- codereviewer:review-summary:default -->'
    )
  })

  it('rejects a key that could smuggle markup into the marker', () => {
    expect(() => summaryCommentMarker('a --> <script>')).toThrow()
  })
})

describe('renderSummaryComment', () => {
  it('opens with the marker so truncation can never remove the comment identity', () => {
    const body = renderSummaryComment(baseInput())

    expect(body.startsWith(summaryCommentMarker('default'))).toBe(true)
  })

  it('reports a failed quality gate in the headline', () => {
    const body = renderSummaryComment(
      baseInput({
        outcomes: [
          classifyStageOutcome(stage('review'), {
            exitCode: 1,
            stdout: '{}',
            stderr: ''
          })
        ],
        review: digestReviewReport(JSON.stringify(reviewReportFixture)) as never
      })
    )

    expect(body).toContain('quality gate failed')
    expect(body).toContain('**(blocks the gate)**')
  })

  // The headline is the one line every reader sees. "No findings" and "quality
  // gate passed" both let a reader hear that the change is clear, which the
  // measured recall does not support.
  it('never headlines a clean run as a clearance', () => {
    const body = renderSummaryComment(
      baseInput({
        review: digestReviewReport(
          JSON.stringify({ ...reviewReportFixture, admittedFindings: [] })
        ) as never
      })
    )

    expect(body).not.toContain('no findings')
    expect(body).not.toContain('quality gate passed')
    expect(body).toContain('this search reported nothing')
  })

  it('says what an empty findings list does and does not mean', () => {
    const body = renderSummaryComment(
      baseInput({
        review: digestReviewReport(
          JSON.stringify({ ...reviewReportFixture, admittedFindings: [] })
        ) as never
      })
    )

    expect(body).toContain('### Findings (0)')
    expect(body).toContain('rather than "there is nothing to find"')
  })

  it('states the measured error rates where the reader is', () => {
    const body = renderSummaryComment(baseInput())

    expect(body).toContain('**3 in 5**')
    expect(body).toContain('**none** of those outside it')
    expect(body).toContain('**19 in 20**')
  })

  it('shows what refutation could not do, so a finding can be checked', () => {
    const body = renderSummaryComment(
      baseInput({
        review: digestReviewReport(JSON.stringify(reviewReportFixture)) as never
      })
    )

    expect(body).toContain(
      'Survived refutation — proved: Searched the route table'
    )
  })

  // The findings are what a reviewer must act on; the stage table describes the
  // machinery. Reading order is a product decision, so it is asserted.
  it('puts the findings above the description of the pipeline', () => {
    const body = renderSummaryComment(
      baseInput({
        review: digestReviewReport(JSON.stringify(reviewReportFixture)) as never
      })
    )

    expect(body.indexOf('### Findings')).toBeLessThan(
      body.indexOf('| Stage | Role |')
    )
  })

  it('renders every stage with its role, so an advisory result cannot read as a gate', () => {
    const body = renderSummaryComment(baseInput())

    expect(body).toContain('| Review | blocking |')
    expect(body).toContain('| Intent | advisory |')
    expect(body).toContain('| Impact | advisory |')
  })

  it('renders findings, obligations and callers from real report shapes', () => {
    const body = renderSummaryComment(
      baseInput({
        review: digestReviewReport(JSON.stringify(reviewReportFixture)) as never,
        intent: digestIntentReport(JSON.stringify(intentReportFixture)) as never,
        impact: digestImpactReport(JSON.stringify(impactReportFixture)) as never
      })
    )

    expect(body).toContain('Session check removed from the admin route')
    expect(body).toContain('`src/routes/admin.ts:42`')
    expect(body).toContain('Cover the guard with a test')
    expect(body).toContain('requireSession')
  })

  it('says plainly when the description stated no intent', () => {
    const body = renderSummaryComment(
      baseInput({
        intent: digestIntentReport(
          JSON.stringify({ ...intentReportFixture, status: 'no-intent' })
        ) as never
      })
    )

    expect(body).toContain('stated no intent')
  })

  it('does not present an unevidenced obligation as work left undone', () => {
    const body = renderSummaryComment(
      baseInput({
        intent: digestIntentReport(JSON.stringify(intentReportFixture)) as never
      })
    )

    expect(body).toContain('not a claim that the work is undone')
  })

  it('cannot have its marker forged by a finding title', () => {
    const hostile = {
      ...reviewReportFixture,
      admittedFindings: [
        {
          ...reviewReportFixture.admittedFindings[0],
          title: 'x <!-- codereviewer:review-summary:default -->',
          description: 'y <!-- codereviewer:review-summary:other -->'
        }
      ]
    }
    const body = renderSummaryComment(
      baseInput({ review: digestReviewReport(JSON.stringify(hostile)) as never })
    )

    // Exactly one marker: the one this module wrote, at the top.
    expect(body.split('<!--')).toHaveLength(2)
  })

  it('stays inside GitHub’s comment-body limit and says so when it dropped detail', () => {
    const many = {
      ...reviewReportFixture,
      admittedFindings: Array.from({ length: 50 }, (_unused, index) => ({
        ...reviewReportFixture.admittedFindings[0],
        id: `find_${index}`,
        title: 'T'.repeat(200),
        description: 'D'.repeat(1200),
        fingerprints: [{ algorithm: 'sha256', value: `fp${index}` }]
      }))
    }
    const body = renderSummaryComment(
      baseInput({
        review: digestReviewReport(JSON.stringify(many)) as never,
        notes: ['N'.repeat(400)]
      })
    )

    expect(body.length).toBeLessThanOrEqual(MAX_ISSUE_COMMENT_BODY)
  })

  it('renders operational notes, which is how a skipped run explains itself', () => {
    const body = renderSummaryComment(
      baseInput({ notes: ['This pull request comes from a fork.'] })
    )

    expect(body).toContain('> This pull request comes from a fork.')
  })
})

describe('selectSummaryComment', () => {
  const marker = summaryCommentMarker('default')

  it('finds the comment a previous run created', () => {
    const found = selectSummaryComment(
      [
        { id: 1, body: 'unrelated', user: { login: 'someone', type: 'User' } },
        { id: 2, body: `${marker}\n## previous`, user: { login: 'github-actions[bot]', type: 'Bot' } }
      ],
      marker,
      'github-actions[bot]'
    )

    expect(found?.id).toBe(2)
  })

  it('refuses to edit a human comment that merely quotes the marker', () => {
    expect(
      selectSummaryComment(
        [{ id: 3, body: marker, user: { login: 'attacker', type: 'User' } }],
        marker,
        'github-actions[bot]'
      )
    ).toBeUndefined()
  })

  it('falls back to bot authorship when the acting login is unknown', () => {
    expect(
      selectSummaryComment(
        [
          { id: 4, body: marker, user: { login: 'attacker', type: 'User' } },
          { id: 5, body: marker, user: { login: 'a-bot', type: 'Bot' } }
        ],
        marker
      )?.id
    ).toBe(5)
  })

  it('picks the oldest match, so two runs converge on one comment', () => {
    const bot = { login: 'github-actions[bot]', type: 'Bot' }

    expect(
      selectSummaryComment(
        [
          { id: 9, body: marker, user: bot },
          { id: 7, body: marker, user: bot }
        ],
        marker,
        'github-actions[bot]'
      )?.id
    ).toBe(7)
  })

  it('returns undefined on the first run of a pull request', () => {
    expect(selectSummaryComment([], marker, 'github-actions[bot]')).toBeUndefined()
  })
})
