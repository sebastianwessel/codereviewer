import { describe, expect, test } from 'vitest'
import { renderMarkdownReport } from './index.js'
import { createReportFixture } from '../../shared/testing/report-fixture.js'

describe('Markdown reporter', () => {
  test('renders deterministic report sections and escapes user-controlled text', () => {
    const report = createReportFixture()
    const rendered = renderMarkdownReport({
      ...report,
      refutationResults: [
        {
          id: 'refute_abc123',
          candidateId: 'cand_abc123',
          verdict: 'proved',
          summary: 'No contradiction found.',
          evidenceIds: ['ev_diff1'],
          checks: [
            {
              kind: 'task-evidence',
              result: 'passed',
              summary: 'Evidence exists.',
              evidenceIds: ['ev_diff1']
            }
          ]
        }
      ],
      providerIssues: [
        {
          code: 'provider_error',
          stage: 'refutation-check',
          recovered: true,
          message: 'Provider failed once and the run continued.'
        }
      ],
      admittedFindings: [
        {
          ...report.admittedFindings[0]!,
          title: 'Bad | title <script>alert(1)</script>\n## Forged',
          description:
            'Leaked token sk-proj-abcdefghijklmnopqrstuvwxyz should not appear.\n![secret](https://example.invalid/x.png)'
        },
        {
          ...report.admittedFindings[0]!,
          id: 'find_artifact1',
          title: 'Support signal diagnostic',
          description: 'A deterministic support signal was preserved for audit.',
          proposedBy: 'typescript-support-signal',
          reporterEligibility: 'artifact-only',
          severity: 'medium',
          refutationId: 'refute_abc123'
        }
      ]
    })

    expect(rendered).toContain('# Review Report')
    expect(rendered).toContain('Suggested fix')
    expect(rendered).toContain('Return the computed value from the changed branch.')
    expect(rendered).toContain('Fix edits')
    expect(rendered).toContain('## Provider Issues')
    expect(rendered).toContain('provider_error')
    // An unresolved suspicion must reach the human with enough context to decide:
    // the section names its purpose, and the entry carries location, description,
    // and the reason it could not be resolved — not just an id.
    expect(rendered).toContain('## Unresolved - Needs Human Decision')
    expect(rendered).toContain('find_artifact1')
    expect(rendered).toContain('- Why unresolved:')
    // Assert the VERDICT, not just the label. The label alone passed while nothing
    // populated `refutationId`, so every entry silently rendered "no refutation
    // verdict was recorded" and told the reader a decision was needed without
    // saying what had already been established.
    expect(rendered).not.toContain('no refutation verdict was recorded')
    expect(rendered).toContain('## Refutation Results')
    expect(rendered).toContain('refute_abc123')
    expect(rendered).toContain('Refutation evidence: ev_diff1')
    expect(rendered).toContain(
      'Refutation check task-evidence: passed - Evidence exists. evidence: ev_diff1'
    )
    expect(rendered).toContain('src/app.ts:4-4')
    expect(rendered).toContain('return computedValue')
    expect(rendered).toContain(
      'Bad \\\\| title &lt;script&gt;alert\\(1\\)&lt;/script&gt; \\#\\# Forged'
    )
    expect(rendered).not.toContain('\n## Forged')
    expect(rendered).not.toContain('![secret]')
    expect(rendered).not.toContain('sk-proj-abcdefghijklmnopqrstuvwxyz')
    expect(rendered).not.toContain('- medium: 1')
  })

  // A reader who cannot tell what this document's silence means supplies their
  // own figure, and the one they supply is optimistic. The two rates that bound
  // that error are printed where the reader is.
  test('states the measured error rates and what an absent finding does not mean', () => {
    const rendered = renderMarkdownReport(createReportFixture())

    // These must match `reports/eval-results-ledger.md` (2026-08-05, engine
    // db78900) exactly. The prose once quoted ranges no run in that set produced,
    // and later kept citing the superseded 2026-08-02 sweep after a re-baseline
    // had replaced it; this assertion is what catches both.
    expect(rendered).toContain(
      'in-diff recall mean 68.3% over three runs, standard deviation 2.89pp'
    )
    expect(rendered).toContain('**0 of 27**')
    expect(rendered).toContain('adjusted precision mean 96.2%')
    expect(rendered).toContain(
      'the absence of a finding is not the absence of a defect'
    )
  })

  // A rate is a property of a model. Quoted without one, it invites the reader
  // to assume it holds for whatever they ran, and the fixture's model is not the
  // model any of those rates were measured on.
  test('names the model the rates were measured on, and says when this run used another', () => {
    const rendered = renderMarkdownReport(createReportFixture())

    expect(rendered).toContain('openai/gpt-5.3-codex')
    expect(rendered).toContain('This run used')
    expect(rendered).toContain('openai/gpt-5-mini')
    expect(rendered).toContain('were not measured on it')
    // And the price is attributed too, for the same reason.
    expect(rendered).toContain('- Model: `openai/gpt-5-mini`')
  })

  test('a run on the measured model is not warned about', () => {
    const report = createReportFixture()
    const rendered = renderMarkdownReport({
      ...report,
      run: { ...report.run, provider: 'openai', model: 'gpt-5.3-codex' }
    })

    expect(rendered).toContain('which is the model this run used')
    expect(rendered).not.toContain('were not measured on it')
  })

  test('a run that recorded no model says so rather than claiming a match', () => {
    const report = createReportFixture()
    const { model: _model, ...runWithoutModel } = report.run
    const rendered = renderMarkdownReport({ ...report, run: runWithoutModel })

    expect(rendered).toContain('did not record which model produced it')
    expect(rendered).toContain('- Model: not recorded')
    expect(rendered).not.toContain('which is the model this run used')
  })

  // The most expensive thing this document can do is read as a clearance. It
  // used to open with `Passed: yes` above five empty headings.
  test('a report with nothing to act on does not read as a clearance', () => {
    const report = createReportFixture()
    const rendered = renderMarkdownReport({
      ...report,
      admittedFindings: [],
      qualityGate: {
        passed: true,
        failingFindingIds: [],
        thresholds: { maxHigh: 0 },
        baselineFilteringApplied: true
      }
    })

    expect(rendered).toContain('## Actionable Findings (0)')
    expect(rendered).toContain('This run proved no defect it could act on')
    expect(rendered).toContain('never as "there is nothing to find"')
    expect(rendered).toContain(
      'not a judgement about the change'
    )
    expect(rendered).not.toContain('Passed: yes')
  })

  // Coverage `complete` is a statement that the source reached a model. Printed
  // as a bare status under a passing gate it reads as completeness of the search.
  test('does not present coverage as a completeness claim about defects', () => {
    const rendered = renderMarkdownReport(createReportFixture())

    expect(rendered).toContain(
      'not that every defect in it was found'
    )
  })

  test('a finding carries the refutation it survived and the evidence it rests on', () => {
    const report = createReportFixture()
    const rendered = renderMarkdownReport({
      ...report,
      refutationResults: [
        {
          id: 'refute_join1',
          candidateId: 'cand_join1',
          verdict: 'proved',
          summary: 'Looked for a caller-side guard; none exists.',
          evidenceIds: ['ev_diff1'],
          checks: [
            {
              kind: 'proof-review',
              result: 'passed',
              summary: 'The claim follows from the cited line.',
              evidenceIds: ['ev_diff1']
            }
          ]
        }
      ],
      admittedFindings: [
        { ...report.admittedFindings[0]!, refutationId: 'refute_join1' }
      ]
    })

    expect(rendered).toContain(
      '- Survived refutation (proved): Looked for a caller-side guard; none exists.'
    )
    expect(rendered).toContain('- Check proof-review: passed')
    // The evidence RECORD, not the bare id it used to print nowhere at all.
    expect(rendered).toContain('- Evidence this rests on:')
    expect(rendered).toContain(
      'Changed branch can return an incorrect value.'
    )
  })

  test('names an evidence id whose record is missing rather than dropping it', () => {
    const report = createReportFixture()
    const rendered = renderMarkdownReport({
      ...report,
      evidence: [],
      admittedFindings: [report.admittedFindings[0]!]
    })

    expect(rendered).toContain(
      'no evidence record for this id is present in this report'
    )
  })

  // Which finding blocks the merge used to be recoverable only by joining
  // `qualityGate.failingFindingIds` in the JSON.
  test('marks the finding that failed the quality gate on the finding itself', () => {
    const rendered = renderMarkdownReport(createReportFixture())

    expect(rendered).toContain(
      '- **This finding is why the quality gate failed.**'
    )
  })

  test('renders the whole location span and the side it is numbered on', () => {
    const report = createReportFixture()
    const rendered = renderMarkdownReport({
      ...report,
      admittedFindings: [
        {
          ...report.admittedFindings[0]!,
          location: {
            path: 'src/app.ts',
            startLine: 4,
            endLine: 11,
            side: 'new'
          }
        }
      ]
    })

    expect(rendered).toContain('- Location: `src/app.ts:4-11` (new side)')
  })

  // A stale baseline or a degraded stage was recorded in the JSON and in the
  // pull-request comment, and was invisible in the artifact this project tells
  // people to read.
  test('surfaces run warnings as bounds on the search', () => {
    const report = createReportFixture()
    const rendered = renderMarkdownReport({
      ...report,
      run: { ...report.run, warnings: ['baseline file was 41 days old'] }
    })

    expect(rendered).toContain('## Bounds that bound')
    expect(rendered).toContain('baseline file was 41 days old')
  })

  test('gives a rejected candidate the reason a human can act on', () => {
    const rendered = renderMarkdownReport(createReportFixture())

    expect(rendered).toContain('Candidate requires evidence.')
  })

  test('renders missing refutation evidence explicitly', () => {
    const report = createReportFixture()
    const rendered = renderMarkdownReport({
      ...report,
      refutationResults: [
        {
          id: 'refute_empty',
          candidateId: 'cand_empty',
          verdict: 'needs-more-evidence',
          summary: 'The refuter cited no decisive evidence.',
          evidenceIds: [],
          checks: [
            {
              kind: 'proof-review',
              result: 'unknown',
              summary: 'The proof review cited no evidence.',
              evidenceIds: []
            }
          ]
        }
      ]
    })

    expect(rendered).toContain('Refutation evidence: none cited')
    expect(rendered).toContain(
      'Refutation check proof-review: unknown - The proof review cited no evidence. evidence: none cited'
    )
  })
  // Spec 29. The signal is deterministic, free and advisory, and every assertion
  // here is about it staying that way on the page a human actually reads.
  test('reports source files with no test in the change, and says what it cannot know', () => {
    const report = createReportFixture()
    const rendered = renderMarkdownReport({
      ...report,
      testAdequacy: {
        consideredFileCount: 3,
        pairedFileCount: 1,
        unpairedPaths: ['src/alpha.ts', 'src/beta.ts'],
        changedTestFileCount: 1,
        unknown: { unsupportedLanguageFileCount: 0, notAnalysedFileCount: 0 }
      }
    })

    expect(rendered).toContain(
      '## Changed source files with no test file in this change (2)'
    )
    expect(rendered).toContain('`src/alpha.ts`')
    expect(rendered).toContain('`src/beta.ts`')
    // The disclosure is the load-bearing part: a reader must not be able to read
    // the list as "these files are untested".
    expect(rendered).toContain(
      'may already be covered completely by an existing test that this change had no reason to touch'
    )
    expect(rendered).toContain('**not a finding**')
    expect(rendered).toContain('did not affect the quality gate')
  })

  test('the signal is subordinate to the findings a reviewer came for', () => {
    const report = createReportFixture()
    const rendered = renderMarkdownReport({
      ...report,
      testAdequacy: {
        consideredFileCount: 1,
        pairedFileCount: 0,
        unpairedPaths: ['src/alpha.ts'],
        changedTestFileCount: 0,
        unknown: { unsupportedLanguageFileCount: 0, notAnalysedFileCount: 0 }
      }
    })

    expect(rendered.indexOf('## Actionable Findings')).toBeLessThan(
      rendered.indexOf('## Changed source files with no test file in this change')
    )
  })

  test('separates what went unpaired from what could not be asked', () => {
    const report = createReportFixture()
    const rendered = renderMarkdownReport({
      ...report,
      testAdequacy: {
        consideredFileCount: 1,
        pairedFileCount: 0,
        unpairedPaths: ['src/alpha.ts'],
        changedTestFileCount: 0,
        unknown: { unsupportedLanguageFileCount: 4, notAnalysedFileCount: 2 }
      }
    })

    expect(rendered).toContain(
      '6 further changed files were not asked the question at all: 4 in a language this engine does not analyse, 2 never read for this run'
    )
    expect(rendered).toContain('unknown, not untested')
  })

  test('renders no heading when there is nothing to observe or nothing was computed', () => {
    const report = createReportFixture()
    const heading = '## Changed source files with no test file in this change'
    const nothingToObserve = renderMarkdownReport({
      ...report,
      testAdequacy: {
        consideredFileCount: 2,
        pairedFileCount: 2,
        unpairedPaths: [],
        changedTestFileCount: 2,
        unknown: { unsupportedLanguageFileCount: 0, notAnalysedFileCount: 0 }
      }
    })

    // An empty section under a heading reads as a clearance, which is the error
    // this whole document is arranged against.
    expect(nothingToObserve).not.toContain(heading)
    expect(renderMarkdownReport(report)).not.toContain(heading)
  })

  // Spend and tokens come from `renderUsageLines`, which the intent-fulfilment
  // report renders too. The case worth pinning is the unmeasured one: a price that
  // could not be computed must be readable as unknown and never as free, and a
  // token count nobody took must not appear as a zero. `intent-markdown.test.ts`
  // holds the matching assertions for the other surface.
  test('an unmeasured cost is disclosed and unmeasured token counts are not invented', () => {
    const rendered = renderMarkdownReport(createReportFixture())

    expect(rendered).toContain(
      '- Cost: unavailable (token counts or model prices were missing)'
    )
    expect(rendered).not.toContain('- Cost: $')
    expect(rendered).not.toContain('- Input tokens:')
    expect(rendered).not.toContain('- Output tokens:')
  })

  test('measured spend prints the cached tokens beside the input count they are part of', () => {
    const report = createReportFixture()
    const rendered = renderMarkdownReport({
      ...report,
      run: {
        ...report.run,
        costUsd: 0.125_104,
        inputTokens: 382_152,
        cachedInputTokens: 366_080,
        outputTokens: 2351
      }
    })

    expect(rendered).toContain('- Cost: $0.1251')
    expect(rendered).toContain('- Input tokens: 382,152 (366,080 cached)')
    expect(rendered).toContain('- Output tokens: 2,351')
  })
})

// `report.discovery` reached `report.json` and no human surface — the markdown
// reporter never read it. It is the section that separates "the reviewer proposed
// little" from "it proposed plenty and later stages removed it", and those have
// completely different fixes.
describe('what discovery produced', () => {
  test('reports the proposal counts and what removed them', () => {
    const report = createReportFixture()
    const markdown = renderMarkdownReport({
      ...report,
      discovery: {
        totals: {
          callCount: 3,
          rawFindingCount: 11,
          rawFindingsPerCall: [5, 4, 2],
          candidateCount: 7,
          droppedCount: 1,
          suppressedByIdCount: 1,
          suppressedByLocationCount: 0,
          cappedByLimitCount: 0,
          contextOverflowSplitCount: 2,
          mergeCallCount: 1,
          mergeGroupCount: 1,
          mergedAwayCount: 2
        },
        tasks: []
      }
    })

    expect(markdown).toContain('## What Discovery Produced')
    expect(markdown).toContain('3 discovery call(s)')
    expect(markdown).toContain('11 finding(s)')
    expect(markdown).toContain('7 became candidates')
    expect(markdown).toContain('Packets split because the provider refused the input: 2')
  })

  // A provider-errored run recorded nothing. Rendering zeros would state a
  // measurement nobody took — "discovery proposed 0" is a different claim from
  // "discovery was never asked".
  test('says nothing at all when the run recorded no discovery', () => {
    const markdown = renderMarkdownReport(createReportFixture())

    expect(markdown).not.toContain('## What Discovery Produced')
  })
})
