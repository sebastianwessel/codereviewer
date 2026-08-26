import { describe, expect, it } from 'vitest'
import {
  adjustedPrecisionInTwenty,
  inDiffRecallInTen,
  measuredReliability,
  MEASURED_ON_MODEL,
  MEASURED_ON_PROVIDER,
  NO_MODEL_SEARCH,
  NOTHING_PROVED
} from '../../src/domains/reporting/measured-reliability.js'
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
  reviewStageDefinition,
  skippedStage
} from './stage-outcomes.js'
import {
  impactReportFixture,
  impactReportWithAdjudicationFixture,
  intentReportFixture,
  reviewReportFixture,
  reviewReportWithFullAccountingFixture
} from './fixtures.js'

const passingOutcomes = [
  classifyStageOutcome(reviewStageDefinition, {
    exitCode: 0,
    stdout: '{}',
    stderr: ''
  })
]

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
          classifyStageOutcome(reviewStageDefinition, {
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
    // The shared sentence itself, so this test cannot pin a private variant of it.
    expect(body).toContain(NOTHING_PROVED)
  })

  // The figures themselves are checked against the ledger, for this renderer AND
  // for `report.md`, by `src/domains/reporting/measured-reliability.test.ts`. This
  // assertion pinned literal rates and is why the drift survived a re-baseline:
  // the comment said "3 in 5" long after the measurement said 68.3%, and CI
  // defended it. What it checks now is that the rates REACH this surface, derived
  // from the one module that holds them.
  //
  // WHERE they reach it moved: the numbers are inside the collapsed block now,
  // because a reviewer opens this comment for the findings. The guarantee did not
  // move — a rate still names the provider and model it was measured on, and the
  // assertion below is written against the collapsed block so that "moved" can
  // never quietly become "dropped".
  //
  // It renders a REVIEW REPORT rather than `baseInput()` alone. It used to pass
  // no report at all, so what it actually pinned was that the rates are printed
  // for a run that produced nothing — the fork-pull-request defect one test down,
  // asserted as the intended behaviour. The rates belong to a search, so the
  // fixture that proves they reach the reader has to be a search.
  it('states the measured error rates where the reader is', () => {
    const body = renderSummaryComment(
      baseInput({
        review: digestReviewReport(JSON.stringify(reviewReportFixture)) as never
      })
    )
    const collapsed = body.slice(body.indexOf('<details>'))

    expect(collapsed).toContain(`**${inDiffRecallInTen} in 10**`)
    expect(collapsed).toContain(
      `**${measuredReliability.outOfDiffRecallFound} of ${measuredReliability.outOfDiffRecallTotal}** of those outside it`
    )
    expect(collapsed).toContain(`**${adjustedPrecisionInTwenty} in 20**`)
    // A rate published without the model it was measured on invites the reader to
    // assume it holds for theirs. This is the standing decision, and it is
    // asserted on the text that carries the numbers, not on the body.
    expect(collapsed).toContain(`${MEASURED_ON_PROVIDER}/${MEASURED_ON_MODEL}`)
  })

  // The same rates over a run that searched nothing. `aiReview.enabled: false`
  // makes the engine report zero findings and pass its gate, and this comment
  // then told the reviewer that a diff-scoped search finding seven in ten
  // in-diff defects had reported nothing — a measured rate standing in for a
  // search that never ran. The reviewer is the one person who can still look.
  it('says no model searched the change instead of quoting rates for a search that did not happen', () => {
    const body = renderSummaryComment(
      baseInput({
        review: digestReviewReport(
          JSON.stringify({
            ...reviewReportFixture,
            run: { ...reviewReportFixture.run, modelSearch: 'not-performed' },
            admittedFindings: []
          })
        ) as never
      })
    )

    expect(body).toContain(NO_MODEL_SEARCH)
    expect(body).toContain('Code review: no model search ran')
    expect(body).not.toContain(`**${inDiffRecallInTen} in 10**`)
    expect(body).not.toContain(`${MEASURED_ON_PROVIDER}/${MEASURED_ON_MODEL}`)
  })

  // THE LARGER CASE, and the one `modelSearch: 'not-performed'` does not cover.
  // A fork pull request and a run with no provider credentials both reach
  // `renderSummaryComment` with NO review report at all (`pipeline.ts`), so the
  // predicate keyed on the report's own field is false and the comment published
  // the measured recall and precision of a diff-scoped model search under a
  // headline saying the review did not run. Nothing searched, and the reader was
  // handed the accuracy of a search.
  //
  // The rates are withheld and NOT replaced by `NO_MODEL_SEARCH`: that sentence
  // names `aiReview.enabled: false` as the cause, which is false here. The reason
  // this comment carries no rates is already in the comment, in the note the
  // pipeline attached.
  it('quotes no measured rate when no review report exists at all', () => {
    const body = renderSummaryComment(
      baseInput({
        outcomes: [skippedStage(reviewStageDefinition, 'fork pull request')],
        notes: [
          'This pull request comes from a fork. GitHub withholds repository secrets and write access from fork pull requests, so the review cannot run and no comment can be posted.'
        ]
      })
    )

    expect(body).not.toContain(`**${inDiffRecallInTen} in 10**`)
    expect(body).not.toContain(`**${adjustedPrecisionInTwenty} in 20**`)
    expect(body).not.toContain(`${MEASURED_ON_PROVIDER}/${MEASURED_ON_MODEL}`)
    // No heading standing over silence either: the block exists to characterise a
    // search, and there was none to characterise.
    expect(body).not.toContain('**How reliable this is**')
    // Nor the caveat about a search: it describes an automated review that misses
    // defects and points at the rates, and both halves are about a run that did
    // not happen.
    expect(body).not.toContain('read each finding as something to check')
    // The cause is still on the comment — withholding a false claim must not
    // withhold the true one.
    expect(body).toContain('comes from a fork')
    // And `aiReview.enabled: false` is NOT named, because it is not what happened.
    expect(body).not.toContain(NO_MODEL_SEARCH)
  })

  // The numbers moved down; the caveat did not. A reader who expands nothing must
  // still be told that a finding is a lead and an empty list is not a clearance.
  it('states the confidence caveat in plain language above the findings', () => {
    const body = renderSummaryComment(
      baseInput({
        review: digestReviewReport(JSON.stringify(reviewReportFixture)) as never
      })
    )
    const caveat = body.indexOf('read each finding as something to check')

    expect(caveat).toBeGreaterThan(-1)
    expect(caveat).toBeLessThan(body.indexOf('### Findings'))
    // No rate above the fold: a number without the model it was measured on is
    // exactly what the collapsed block exists to hold.
    expect(body.slice(0, body.indexOf('<details>'))).not.toContain(' in 10**')
  })

  it('shows what refutation could not do, so a finding can be checked', () => {
    const body = renderSummaryComment(
      baseInput({
        review: digestReviewReport(JSON.stringify(reviewReportFixture)) as never
      })
    )

    // Kept as evidence, moved out of the findings list: "Survived refutation" is
    // the engine's vocabulary, not a sentence a human reviewer writes.
    expect(body.slice(body.indexOf('<details>'))).toContain(
      'Survived refutation — proved: Searched the route table'
    )
    expect(body.slice(0, body.indexOf('<details>'))).not.toContain(
      'Survived refutation'
    )
  })

  // The findings are what a reviewer must act on; the stage table describes the
  // machinery. Reading order is a product decision, so it is asserted.
  it('puts the findings above the description of the pipeline, which is collapsed', () => {
    const body = renderSummaryComment(
      baseInput({
        review: digestReviewReport(JSON.stringify(reviewReportFixture)) as never
      })
    )

    expect(body.indexOf('### Findings')).toBeLessThan(
      body.indexOf('| Stage | Role |')
    )
    expect(body.indexOf('<details>')).toBeLessThan(
      body.indexOf('| Stage | Role |')
    )
  })

  // What the change was for and what it might affect are context for reading the
  // findings, so they precede them — the order a human reviewer works in.
  it('reads verdict, intent, impact, findings, then the lower-confidence items', () => {
    const body = renderSummaryComment(
      baseInput({
        review: digestReviewReport(
          JSON.stringify(reviewReportWithFullAccountingFixture)
        ) as never,
        intent: digestIntentReport(JSON.stringify(intentReportFixture)) as never,
        impact: digestImpactReport(JSON.stringify(impactReportFixture)) as never
      })
    )
    const order = [
      '## Code review',
      '### Intent',
      '### Impact',
      '### Findings',
      '### Worth a look',
      '<details>'
    ].map((heading) => body.indexOf(heading))

    expect(order).toEqual([...order].sort((left, right) => left - right))
    expect(order.every((index) => index >= 0)).toBe(true)
  })

  it('renders the review stage with its role, so it cannot read as anything but the gate', () => {
    const body = renderSummaryComment(baseInput())

    expect(body).toContain('| Review | blocking |')
  })

  // A stage that could not run is the case where the reason matters most, and it
  // is the one thing the collapsed stage table must not be the only home for.
  it('says at the top why a run that could not complete produced no findings', () => {
    const body = renderSummaryComment(
      baseInput({
        outcomes: [
          classifyStageOutcome(reviewStageDefinition, {
            exitCode: 4,
            stdout: '',
            stderr: '{"code":"provider_error","message":"429 rate limit"}'
          })
        ]
      })
    )

    expect(body.indexOf('429 rate limit')).toBeLessThan(body.indexOf('<details>'))
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

  // Reading order puts intent and impact above the findings. Drop order must not:
  // a findings list at the size limit would otherwise be pushed out by the summary
  // of what the change was for, leaving the reader the half they cannot act on.
  it('drops the change summary before the findings when the body will not fit', () => {
    const many = {
      ...reviewReportFixture,
      admittedFindings: Array.from({ length: 50 }, (_unused, index) => ({
        ...reviewReportFixture.admittedFindings[0],
        id: `find_${index}`,
        location: { path: `src/${'d'.repeat(180)}.ts`, startLine: 42 },
        title: 'T'.repeat(200),
        description: 'D'.repeat(1200),
        fingerprints: [{ algorithm: 'sha256', value: `fp${index}` }]
      }))
    }
    const wordyIntent = {
      ...intentReportFixture,
      obligations: Array.from({ length: 20 }, (_unused, index) => ({
        statement: `O${index} ${'o'.repeat(300)}`,
        status: 'not-evidenced'
      }))
    }
    const body = renderSummaryComment(
      baseInput({
        review: digestReviewReport(JSON.stringify(many)) as never,
        intent: digestIntentReport(JSON.stringify(wordyIntent)) as never,
        // Enough operational notes to put the findings and the intent summary
        // together over the limit, so one of the two must go.
        notes: Array.from({ length: 8 }, () => 'N'.repeat(500))
      })
    )

    // Something was dropped, so the assertion below is about a real choice.
    expect(body).toContain('reached GitHub')
    expect(body).toContain('### Findings')
    expect(body).not.toContain('### Intent')
  })

  it('renders operational notes, which is how a skipped run explains itself', () => {
    const body = renderSummaryComment(
      baseInput({ notes: ['This pull request comes from a fork.'] })
    )

    expect(body).toContain('> This pull request comes from a fork.')
  })

  // A1: an `artifact-only` finding is a suspicion the refuter could neither
  // prove nor disprove, deliberately kept as a question for a human. Before
  // this behaviour existed it rendered mixed into the flat findings list,
  // indistinguishable from a finished, proved defect.
  describe('unresolved (artifact-only) findings', () => {
    const reviewWithUnresolved = digestReviewReport(
      JSON.stringify(reviewReportWithFullAccountingFixture)
    ) as never

    // Headed "Worth a look" on this surface. `report.md` keeps "Unresolved -
    // Needs Human Decision"; a pull-request comment is read by someone deciding
    // whether to spend two minutes, and the heading is the whole invitation.
    it('renders unresolved findings in their own section, separate from actionable findings', () => {
      const body = renderSummaryComment(baseInput({ review: reviewWithUnresolved }))

      expect(body).toContain('### Worth a look (1)')
      expect(body).toContain('Possible SSRF via the fetched webhook URL')
    })

    // The reason it could not be settled is the useful half of the line. The
    // verdict label in front of it names an engine state and nothing a reviewer
    // can act on.
    it('gives the reason without the refutation verdict label', () => {
      const body = renderSummaryComment(baseInput({ review: reviewWithUnresolved }))

      expect(body).toContain(
        '_The allow-list this depends on is defined in a config file outside the reviewed diff._'
      )
      expect(body).not.toContain('needs-more-evidence')
    })

    it('does not count an unresolved finding in the actionable Findings section', () => {
      const body = renderSummaryComment(baseInput({ review: reviewWithUnresolved }))

      // 2 actionable findings from the base fixture; the 3rd, unresolved one is
      // not counted here even though 3 findings were admitted in total.
      expect(body).toContain('### Findings (2)')
      expect(
        body.indexOf('### Findings (2)')
      ).toBeLessThan(body.indexOf('### Worth a look'))
    })

    it('frames unresolved findings as open questions, not verdicts', () => {
      const body = renderSummaryComment(baseInput({ review: reviewWithUnresolved }))

      expect(body).toContain('Open questions, not verdicts')
      expect(body).toContain('do not affect the quality gate')
    })

    it('renders no unresolved section when every finding is actionable', () => {
      const body = renderSummaryComment(
        baseInput({
          review: digestReviewReport(JSON.stringify(reviewReportFixture)) as never
        })
      )

      expect(body).not.toContain('Worth a look')
    })
  })

  // A2: `resolvedBaselineEntries` is fingerprints only (the baseline discloses
  // no source, path, or finding text), so the comment can state a count and
  // nothing more.
  describe('resolved-since-baseline count', () => {
    it('states the count when the run computed it', () => {
      const body = renderSummaryComment(
        baseInput({
          review: digestReviewReport(
            JSON.stringify(reviewReportWithFullAccountingFixture)
          ) as never
        })
      )

      expect(body).toContain('No longer reported: 2')
      // The count must never be presented as a repair: nothing here separates a
      // fixed defect from one this run simply did not report.
      expect(body).toContain('not the same as fixed')
    })

    it('omits the line entirely when the run never computed it, rather than implying zero', () => {
      const body = renderSummaryComment(
        baseInput({
          review: digestReviewReport(JSON.stringify(reviewReportFixture)) as never
        })
      )

      // Asserted on the text the line ACTUALLY renders. It read
      // `not.toContain('Resolved since baseline')` — a heading this comment has
      // never carried — so it passed over a renderer that printed an uncomputed
      // count as 0, which is the one thing it exists to catch.
      expect(body).not.toContain('No longer reported: ')
      expect(body).not.toContain('previously-flagged finding')
    })
  })

  // A3: the precision story — a short findings list is credible only if the
  // reader can see that discovery examined more than it kept.
  describe('candidate accounting', () => {
    it('states how many candidates were examined, admitted, rejected and merged', () => {
      const body = renderSummaryComment(
        baseInput({
          review: digestReviewReport(
            JSON.stringify(reviewReportWithFullAccountingFixture)
          ) as never
        })
      )

      expect(body).toContain(
        'Candidates: 5 examined, 3 admitted, 2 rejected, 4 merged as duplicates before that'
      )
    })

    it('omits the merged clause when the report has no discovery telemetry', () => {
      const body = renderSummaryComment(
        baseInput({
          review: digestReviewReport(JSON.stringify(reviewReportFixture)) as never
        })
      )

      expect(body).toContain('Candidates: 2 examined, 2 admitted, 0 rejected —')
      expect(body).not.toContain('merged as duplicates')
    })
  })
})

// THE IMPACT SECTION'S TWO LISTS.
//
// The reference table is the untriaged floor: "this file mentions a name this
// change touched". The adjudicated list above it is the judgement: "this file was
// shown to rely on the part that moved". Spec 22 governs this comment as a surface
// of the capability, so what may be asserted here is what may be asserted in the
// report — and the layer that decides which dependents actually break reached no
// reader here at all until 2026-08-16.
describe('renderSummaryComment: the Impact section', () => {
  const impactSectionOf = (body: string): string => {
    const start = body.indexOf('### Impact')

    expect(start).toBeGreaterThanOrEqual(0)

    const rest = body.slice(start)
    const boundaries = ['\n\n### ', '\n\n<details>', '\n\n_This comment reached']
      .map((boundary) => rest.indexOf(boundary))
      .filter((index) => index >= 0)

    return boundaries.length === 0
      ? rest
      : rest.slice(0, Math.min(...boundaries))
  }
  const bodyFor = (report: unknown): string =>
    renderSummaryComment(
      baseInput({
        impact: digestImpactReport(JSON.stringify(report)) as never
      })
    )

  // BYTE FOR BYTE, and this is the whole point of pinning it: adjudication is off
  // by default, so this is the section on essentially every pull request the
  // engine comments on today. Reading a layer that is empty on the default path
  // must change that path by exactly nothing — no heading, no qualifier, no
  // rearranged blank line.
  it('renders the default path — adjudication off — exactly as it did before the layer was read', () => {
    expect(impactSectionOf(bodyFor(impactReportFixture))).toBe(
      [
        '### Impact',
        '',
        '2 changed symbols, 2 production references outside the defining file.',
        '',
        '| Symbol | Defined in | Reference sites | Test reference sites |',
        '| --- | --- | --- | --- |',
        '| `requireSession` | `src/auth/session.ts` | 2 | 1 |'
      ].join('\n')
    )
  })

  it('says nothing about adjudication when it is switched off', () => {
    const section = impactSectionOf(bodyFor(impactReportFixture))

    expect(section).not.toContain('Shown to rely')
    expect(section).not.toContain('untriaged')
  })

  // The gap this section was fixed for: with adjudication on, the engine spends
  // model calls deciding which dependents break, and the human on the pull request
  // could not see one of them.
  it('renders the dependents an adjudicator showed to rely on the change', () => {
    const section = impactSectionOf(bodyFor(impactReportWithAdjudicationFixture))

    expect(section).toContain('**Shown to rely on this change (2)**')
    expect(section).toContain('**breaks on build** · `src/routes/admin.ts`')
    // Path, line, contract element and consequence: the four things spec 22
    // requires a change-impact finding to carry.
    expect(section).toContain(
      'line 41: relies on the declaration of loadUser, which this change removes — this reference cannot resolve and the file will not build'
    )
    expect(section).toContain('_(settled in code)_')
    expect(section).toContain('_(judged by a model)_')
    // A test dependent breaks in CI, not in production. Different news, said so.
    expect(section).toContain('`src/auth/session.test.ts`')
    expect(section).toContain('a test — it breaks in CI, not in production')
  })

  // A judgement and a text match are not the same claim, and a reader who cannot
  // tell them apart has been handed a reference count dressed as a finding.
  it('keeps the adjudicated judgements and the untriaged reference list apart', () => {
    const section = impactSectionOf(bodyFor(impactReportWithAdjudicationFixture))

    expect(section).toContain('**Everything this change reaches, untriaged**')
    expect(section.indexOf('**Shown to rely on this change')).toBeLessThan(
      section.indexOf('**Everything this change reaches, untriaged**')
    )
    // The reference table is still there, whole — both changed symbols, with the
    // site counts that are a text match rather than a judgement.
    expect(section).toContain('| `requireSession` | `src/auth/session.ts` | 2 | 1 |')
    expect(section).toContain('| `loadUser` | `src/auth/session.ts` | 1 | 0 |')
  })

  // No accuracy number exists for this layer, and the comment may not be a more
  // confident artifact than the report a reader could open instead.
  it('carries the unmeasured qualifier with the judgements', () => {
    const section = impactSectionOf(bodyFor(impactReportWithAdjudicationFixture))

    expect(section).toContain('This layer is unmeasured')
    expect(section).toContain('Breaking a dependent is frequently deliberate')
    // A class is a mechanism, not a rating. Spec 22 chose the axis for that.
    expect(section).toContain('Labels are mechanisms, not ratings')
    expect(section).toContain('the name the file uses is gone')
  })

  // ADJUDICATION RAN AND FOUND NOTHING IS A RESULT. Rendering it as silence would
  // be indistinguishable from the default path, where nothing was checked at all —
  // the absence-reads-as-a-clean-answer defect this repository keeps finding.
  it('says that adjudication ran and found nothing, rather than looking like it never ran', () => {
    const section = impactSectionOf(
      bodyFor({
        ...impactReportWithAdjudicationFixture,
        impactFindings: [],
        summary: {
          ...impactReportWithAdjudicationFixture.summary,
          impactFindingCount: 0,
          reliedUponPairCount: 0,
          deterministicNoImpactPairCount: 1,
          modelVerdictCounts: { relies: 0, 'does-not-rely': 3, undetermined: 0 }
        }
      })
    )

    expect(section).toContain('**Shown to rely on this change (0)**')
    expect(section).toContain(
      '4 uses of a changed symbol were checked against what changed, and none was shown to rely on it. That is an answer, not an empty section'
    )
    expect(section).not.toContain('Nothing was triaged')
  })

  // The other empty: adjudication was on and nothing reached it. Also a result,
  // and a different one — it makes no claim about the dependents at all.
  it('tells nothing-was-checked apart from checked-and-clear', () => {
    const section = impactSectionOf(
      bodyFor({
        ...impactReportWithAdjudicationFixture,
        adjudicationStatus: 'no-model',
        impactFindings: [],
        summary: {
          ...impactReportWithAdjudicationFixture.summary,
          impactFindingCount: 0,
          reliedUponPairCount: 0,
          deterministicNoImpactPairCount: 0,
          unadjudicatedPairCount: 4,
          adjudicationCallCount: 0,
          modelVerdictCounts: { relies: 0, 'does-not-rely': 0, undetermined: 0 }
        }
      })
    )

    expect(section).toContain('Nothing was triaged')
    expect(section).toContain('No model was available')
    expect(section).toContain(
      '4 uses of a changed symbol were left unadjudicated'
    )
  })

  // A partial triage read as a complete one is the mistake this layer exists to
  // prevent, so a failing provider and a bound call cap are stated with the list.
  it('qualifies a triage that was cut short', () => {
    const section = impactSectionOf(
      bodyFor({
        ...impactReportWithAdjudicationFixture,
        summary: {
          ...impactReportWithAdjudicationFixture.summary,
          unadjudicatedPairCount: 2,
          failedAdjudicationCallCount: 1,
          adjudicationCallsTruncated: true
        }
      })
    )

    expect(section).toContain('1 adjudication call did not complete')
    expect(section).toContain('The adjudication call cap was reached')
    expect(section).toContain(
      'absence from this list is not a statement that a dependent is unaffected'
    )
  })

  // A run whose judge was never called is not a run whose judge said no. Without
  // this sentence a reader credits a model with an answer code reached for free.
  it('does not let a deterministic answer read as a model’s', () => {
    const section = impactSectionOf(
      bodyFor({
        ...impactReportWithAdjudicationFixture,
        impactFindings: impactReportWithAdjudicationFixture.impactFindings
          .slice(0, 1)
          .map((finding) => ({
            ...finding,
            reliances: finding.reliances.slice(0, 1)
          })),
        summary: {
          ...impactReportWithAdjudicationFixture.summary,
          impactFindingCount: 1,
          reliedUponPairCount: 1,
          deterministicNoImpactPairCount: 3,
          adjudicationCallCount: 0,
          modelVerdictCounts: { relies: 0, 'does-not-rely': 0, undetermined: 0 }
        }
      })
    )

    expect(section).toContain(
      'No model call was spent on this change: everything above was settled in code.'
    )
  })

  // Untrusted text reaches this section too: a contract element and a consequence
  // are composed from identifiers read out of the repository.
  it('cannot have the comment marker forged by a reliance sentence', () => {
    const body = bodyFor({
      ...impactReportWithAdjudicationFixture,
      impactFindings: impactReportWithAdjudicationFixture.impactFindings
        .slice(0, 1)
        .map((finding) => ({
          ...finding,
          reliances: finding.reliances.slice(0, 1).map((reliance) => ({
            ...reliance,
            contractElement: 'x <!-- codereviewer:review-summary:default --> y',
            consequence: 'z <!-- codereviewer:review-summary:other -->'
          }))
        }))
    })

    expect(body.split('<!--')).toHaveLength(2)
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
