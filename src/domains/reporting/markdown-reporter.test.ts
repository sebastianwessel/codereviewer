import { describe, expect, test } from 'vitest'
import { renderMarkdownReport } from './index.js'
import { createReportFixture } from '../../shared/testing/report-fixture.js'
import {
  MEASURED_ON_MODEL,
  MEASURED_ON_PROVIDER,
  NO_MODEL_SEARCH,
  NOTHING_PROVED,
  NOTHING_SEARCHED
} from './measured-reliability.js'

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

  // The silent-optimism case this document is least able to survive: with
  // `aiReview.enabled: false` nothing searched the change, and the report still
  // printed the measured recall and precision of a model search plus the model
  // it was measured on. Rates describe how often a SEARCH finds a defect; over a
  // run that performed none they are not irrelevant, they flatter.
  test('a run that performed no model search prints no rates and no model', () => {
    const report = createReportFixture()
    const { provider: _provider, model: _model, ...run } = report.run
    const rendered = renderMarkdownReport({
      ...report,
      run: { ...run, modelSearch: 'not-performed' }
    })

    expect(rendered).toContain(NO_MODEL_SEARCH)
    expect(rendered).not.toContain('in-diff recall mean')
    expect(rendered).not.toContain('adjusted precision mean')
    expect(rendered).not.toContain(`${MEASURED_ON_PROVIDER}/${MEASURED_ON_MODEL}`)
    expect(rendered).not.toContain('did not record which model produced it')
    expect(rendered).toContain('- Model: none — this run performed no model search')
  })

  // The coverage line is the one line that quantifies the run, and it used to
  // end with "a statement that the source reached a model" on a run whose own
  // header says in capitals that no model searched the change. A reader
  // reconciling the two has to decide which surface is lying.
  test('the coverage certificate does not claim a model on a run with no model search', () => {
    const report = createReportFixture()
    const { provider: _provider, model: _model, ...run } = report.run
    const rendered = renderMarkdownReport({
      ...report,
      run: { ...run, modelSearch: 'not-performed' }
    })

    expect(rendered).toContain(
      'a statement that the source was read and assembled for review, not that anything searched it: this run performed no model search.'
    )
    expect(rendered).not.toContain('a statement that the source reached a model')
  })

  test('the coverage certificate still states the model claim on a searched run', () => {
    const rendered = renderMarkdownReport({
      ...createReportFixture(),
      run: { ...createReportFixture().run, modelSearch: 'performed' }
    })

    expect(rendered).toContain(
      'a statement that the source reached a model, not that every defect in it was found.'
    )
  })

  // "No findings" and "nothing was looked for" are the two readings this section
  // must keep apart, and the sentence it prints for a searched run says the
  // measured corpus misses roughly three in ten — a figure about a search that,
  // here, did not happen.
  test('an empty findings list on a run with no model search does not borrow the search sentence', () => {
    const report = createReportFixture()
    const { provider: _provider, model: _model, ...run } = report.run
    const rendered = renderMarkdownReport({
      ...report,
      run: { ...run, modelSearch: 'not-performed' },
      admittedFindings: [],
      qualityGate: { passed: true, failingFindingIds: [], thresholds: {} }
    })

    expect(rendered).toContain(NOTHING_SEARCHED)
    expect(rendered).not.toContain(NOTHING_PROVED)
  })

  // The honest case, kept honest: a run that DID search and found nothing still
  // owes the reader its rates and still has to say the search found nothing.
  test('a run that searched and found nothing keeps its rates and its sentence', () => {
    const report = createReportFixture()
    const rendered = renderMarkdownReport({
      ...report,
      run: { ...report.run, modelSearch: 'performed' },
      admittedFindings: [],
      qualityGate: { passed: true, failingFindingIds: [], thresholds: {} }
    })

    expect(rendered).toContain(NOTHING_PROVED)
    expect(rendered).toContain('in-diff recall mean')
    expect(rendered).not.toContain(NO_MODEL_SEARCH)
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

  // A gate failed by an unrecovered provider issue names no finding, because
  // `evaluateQualityGate`'s own comment says the failure is that findings are
  // MISSING. The renderer attributed every failure to findings anyway, so a run
  // whose discovery call errored printed "0 findings cross a configured
  // threshold" — a blocked merge, with zero of the stated cause shown, and the
  // real cause in a section far below that the reader has no reason to connect.
  test('says an incomplete search failed the gate, not zero findings', () => {
    const report = createReportFixture()
    const rendered = renderMarkdownReport({
      ...report,
      admittedFindings: [],
      providerIssues: [
        {
          code: 'provider_error',
          stage: 'holistic_review',
          recovered: false,
          message: 'The discovery call failed.'
        }
      ],
      qualityGate: {
        passed: false,
        failingFindingIds: [],
        thresholds: { maxHigh: 0, failOnProviderError: true },
        baselineFilteringApplied: false
      }
    })

    expect(rendered).not.toContain('0 findings cross a configured threshold')
    expect(rendered).toContain('the search did not finish')
  })

  test('still attributes a gate failure to the findings that caused it', () => {
    const report = createReportFixture()
    const rendered = renderMarkdownReport({
      ...report,
      qualityGate: {
        passed: false,
        failingFindingIds: [report.admittedFindings[0]!.id],
        thresholds: { maxHigh: 0 },
        baselineFilteringApplied: false
      }
    })

    expect(rendered).toContain('1 finding crosses a configured threshold')
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

  test('a run that placed no model call reports zero, not an unavailable price', () => {
    // The one absent cost that is NOT unmeasured. With `aiReview.enabled: false`
    // the run makes no model call at all, so its spend is zero by construction —
    // and the report already says NO MODEL SEARCHED THIS CHANGE in its first
    // paragraph. It used to close with "unavailable (token counts or model prices
    // were missing)", which reads as a pricing table this engine failed to load
    // and sends the reader to chase a configuration defect that is not there.
    const report = createReportFixture()
    const rendered = renderMarkdownReport({
      ...report,
      run: { ...report.run, modelSearch: 'not-performed' }
    })

    expect(rendered).toContain('- Cost: $0.0000 — this run placed no model call')
    expect(rendered).not.toContain('model prices were missing')
    // Still no invented token counts: nobody counted them either.
    expect(rendered).not.toContain('- Input tokens:')
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

  test('states the two strain signals a split count cannot carry', () => {
    // A refused packet is answered by NARROWING THE READS first and splitting the
    // task second, and only the second had a counter — so a run that halved its own
    // per-read allowance three times, down to the floor, rendered
    // `contextOverflowSplitCount: 0` and read exactly like a run that never
    // strained. The lookup allowance is the same kind of fact: the reviewer stopped
    // looking because it ran out, not because it was finished.
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
          contextOverflowSplitCount: 0,
          readBudgetReductionCount: 3,
          mergeCallCount: 1,
          mergeGroupCount: 1,
          mergedAwayCount: 2
        },
        tasks: [
          {
            taskId: 'task_one',
            callCount: 2,
            rawFindingCount: 7,
            rawFindingsPerCall: [5, 2],
            candidateCount: 4,
            droppedCount: 1,
            suppressedByIdCount: 1,
            suppressedByLocationCount: 0,
            cappedByLimitCount: 0,
            contextOverflowSplitCount: 0,
            readBudgetReductionCount: 3,
            retrievalBudgetExhausted: true,
            mergeCallCount: 1,
            mergeGroupCount: 1,
            mergedAwayCount: 2
          },
          {
            taskId: 'task_two',
            callCount: 1,
            rawFindingCount: 4,
            rawFindingsPerCall: [4],
            candidateCount: 3,
            droppedCount: 0,
            suppressedByIdCount: 0,
            suppressedByLocationCount: 0,
            cappedByLimitCount: 0,
            contextOverflowSplitCount: 0,
            readBudgetReductionCount: 0,
            retrievalBudgetExhausted: false,
            mergeCallCount: 0,
            mergeGroupCount: 0,
            mergedAwayCount: 0
          }
        ]
      }
    })

    expect(markdown).toContain('Packets split because the provider refused the input: 0')
    expect(markdown).toContain(
      "Times the reviewer's per-read byte allowance was halved after a refused packet: 3"
    )
    expect(markdown).toContain(
      'Tasks that used up their cross-file lookup allowance: 1 of 2'
    )
  })

  test('says nothing about a lookup allowance that never existed', () => {
    // With cross-file retrieval off there is no allowance, and a line reading
    // "0 of 0" would suggest one. Absent stays absent.
    const report = createReportFixture()
    const markdown = renderMarkdownReport({
      ...report,
      discovery: {
        totals: {
          callCount: 1,
          rawFindingCount: 1,
          rawFindingsPerCall: [1],
          candidateCount: 1,
          droppedCount: 0,
          suppressedByIdCount: 0,
          suppressedByLocationCount: 0,
          cappedByLimitCount: 0,
          contextOverflowSplitCount: 0,
          readBudgetReductionCount: 0,
          mergeCallCount: 0,
          mergeGroupCount: 0,
          mergedAwayCount: 0
        },
        tasks: [
          {
            taskId: 'task_one',
            callCount: 1,
            rawFindingCount: 1,
            rawFindingsPerCall: [1],
            candidateCount: 1,
            droppedCount: 0,
            suppressedByIdCount: 0,
            suppressedByLocationCount: 0,
            cappedByLimitCount: 0,
            contextOverflowSplitCount: 0,
            readBudgetReductionCount: 0,
            mergeCallCount: 0,
            mergeGroupCount: 0,
            mergedAwayCount: 0
          }
        ]
      }
    })

    expect(markdown).not.toContain('cross-file lookup allowance')
  })

  // A provider-errored run recorded nothing. Rendering zeros would state a
  // measurement nobody took — "discovery proposed 0" is a different claim from
  // "discovery was never asked".
  test('says nothing at all when the run recorded no discovery', () => {
    const markdown = renderMarkdownReport(createReportFixture())

    expect(markdown).not.toContain('## What Discovery Produced')
  })
})

// The verification lane's corroborations reached `verification-report.json` and no
// human surface — the one signal that lane exists to produce landed where nobody
// reads it, while the reader deciding what to act on reads `report.md`.
describe('corroboration on a finding', () => {
  const reportWithCorroboration = (
    matchKinds: readonly ('fingerprint' | 'fuzzy')[]
  ) => {
    const report = createReportFixture()

    return {
      ...report,
      corroborations: [
        {
          findingId: report.admittedFindings[0]!.id,
          confidence: 'corroborated' as const,
          matchKinds: [...matchKinds],
          witnessClaimIds: ['claim_a', 'claim_b']
        }
      ]
    }
  }

  test('names the witness count and calls it confidence, not severity', () => {
    const markdown = renderMarkdownReport(reportWithCorroboration(['fingerprint']))

    expect(markdown).toContain(
      '- Corroborated: independently confirmed by 2 verification claim(s) (same defect)'
    )
    expect(markdown).toContain('severity and the quality gate are unchanged')
  })

  // An overlap is weaker evidence than an identity, so the two must not read the
  // same to a person deciding whether to act.
  test('distinguishes a fuzzy overlap from a fingerprint match', () => {
    expect(renderMarkdownReport(reportWithCorroboration(['fuzzy']))).toContain(
      'same file and overlapping lines'
    )
  })

  test('says nothing when the verification lane did not run', () => {
    expect(renderMarkdownReport(createReportFixture())).not.toContain(
      '- Corroborated:'
    )
  })
})
