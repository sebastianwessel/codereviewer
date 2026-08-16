import { describe, expect, test } from 'vitest'
import { parseEvalRecallView, recallViewReadModels } from './eval-recall-view.js'
import {
  EvalCaseReportSchema,
  EvalExpectedFindingReportSchema,
  EvalReportSchema
} from './eval-report-contracts.js'

// The exact payload shape that stopped opening on 2026-08-11: four
// per-classification finding arrays on the case result, no `producedFindings`,
// and `schemaVersion: '1.0'`. Every engine-pinned archive under
// `.codereviewer/eval/` looks like this, and they are the evidence base the
// ledger is written from.
const legacyCaseResultReport = {
  schemaVersion: '1.0',
  metricsVersion: '2026-08-07.open-redirect-mechanism',
  generatedAt: '2026-08-07T00:00:00.000Z',
  fixtureCount: 1,
  selection: {
    fixtureSource: 'slice-root',
    caseFilters: [],
    selectedCaseIds: ['case-a']
  },
  caseResults: [
    {
      caseId: 'case-a',
      expectedFindings: [
        {
          expectedIndex: 0,
          category: 'security',
          severity: 'high',
          path: 'src/app.ts',
          matchMode: 'path-semantic',
          diffScope: 'in-diff',
          semanticSummary: 'The guard is missing on the admin route.'
        }
      ],
      matchedFindings: [{ expectedIndex: 0, findingId: 'find_a' }],
      // The four arrays `producedFindings` replaced. A strict producer contract
      // rejects the report on these, which is what broke `eval recall-report`.
      duplicateFindings: [],
      falsePositiveFindings: [{ findingId: 'find_b', title: 'noise' }],
      unlistedRealFindings: [],
      artifactOnlyFalsePositiveFindings: []
    }
  ]
}

describe('the recall view', () => {
  test('opens an archive written before producedFindings existed', () => {
    const view = parseEvalRecallView(legacyCaseResultReport)

    expect(view.caseResults[0]?.caseId).toBe('case-a')
    expect(view.caseResults[0]?.matchedFindings).toEqual([
      { expectedIndex: 0, findingId: 'find_a' }
    ])
    expect(view.caseResults[0]?.expectedFindings[0]?.semanticSummary).toContain(
      'admin route'
    )
  })

  // The bound on the tolerance. An older report is a report; one missing the
  // fields recall is computed FROM is broken, and recall derived from it would be
  // wrong in the direction that flatters the engine — an expectation with no
  // matches recorded reads as a miss.
  test('refuses a payload missing the fields recall is computed from', () => {
    const { matchedFindings: _dropped, ...withoutMatches } =
      legacyCaseResultReport.caseResults[0]!

    expect(() =>
      parseEvalRecallView({
        ...legacyCaseResultReport,
        caseResults: [withoutMatches]
      })
    ).toThrow()
  })

  // The producer-shape change of 2026-08-11 was not the only one this view has to
  // span. Per-expectation `diffScope` was added on 2026-07-31 -- its own
  // metrics-version entry says so: "An older report carries no classification" --
  // and requiring it here refused 200 archived reports on disk, 14 of them under
  // `.codereviewer/eval/archive/`, for a field the recall report never renders.
  // The tolerance is bounded by what recall is COMPUTED FROM, and diff scope is
  // not one of those fields.
  test('opens an archive written before per-expectation diff scope existed', () => {
    const { diffScope: _dropped, ...withoutDiffScope } =
      legacyCaseResultReport.caseResults[0]!.expectedFindings[0]!
    const view = parseEvalRecallView({
      ...legacyCaseResultReport,
      caseResults: [
        {
          ...legacyCaseResultReport.caseResults[0]!,
          expectedFindings: [withoutDiffScope]
        }
      ]
    })

    expect(view.caseResults[0]?.expectedFindings[0]?.semanticSummary).toContain(
      'admin route'
    )
  })

  // Tolerance is for shape drift, not for a different artifact entirely.
  test('refuses something that is not an eval report', () => {
    expect(() => parseEvalRecallView({ hello: 'world' })).toThrow()
  })
})

// Fields the producer records that this view deliberately does not read.
//
// TOLERANCE HAS A BLIND SPOT, and it is the mirror image of the one this view was
// written to fix. A loose schema accepts an archive whose shape moved — the point
// of the module — but it also accepts a field the producer ADDED and reads it
// never, with no parse error, no warning, and a recall report that is simply
// missing a fact it could have used. That is the same class of silence as an eval
// metric that renders as "unknown" in every comparison forever, which is why
// `eval-comparison-view.test.ts` carries this guard already; the recall view is the
// second hand-maintained view of the same producer and had none.
//
// Adding a key here is a decision: say what recall analysis loses by not reading
// it. The rule that decides is stated in the module header — this view reads the
// fields recall is COMPUTED FROM, and nothing else.
const REPORT_FIELDS_DELIBERATELY_NOT_READ: readonly string[] = [
  // The shape literal. Reading it would mean deciding what to do per version,
  // which is exactly the coupling to today's producer that made every archive
  // unopenable here; nothing in this repository dispatches on it, and the fields
  // recall is computed from are identical across every version this view accepts.
  //
  // `metricsVersion` used to sit here for that reason and has MOVED into the read
  // model. Nothing about the argument above changed — the view still does not
  // branch on it — but `eval recall-report` POOLS several reports into one `k/n`
  // per expectation, and a pool that spans a metrics-version boundary merges two
  // definitions of a match. It is read to REFUSE, not to dispatch. See
  // `eval-pool-identity.ts`.
  'schemaVersion',
  // The scoring configuration and the aggregate metrics block. This report
  // RECOMPUTES recall per expectation across the reports it was handed, rather
  // than restating a stored rate, which is the whole reason it can span archives.
  'scoring',
  'metrics',
  'metricGroups',
  // The regression gate's verdict on ONE run. This report is a per-expectation
  // cross-run view and adjudicates nothing.
  'regressionGate'
  // `provenance` used to sit here, under a comment that ended "Reading provenance
  // to refuse a mixed pool would be a new refusal, not a new read." That was the
  // right description and the wrong conclusion: `eval recall-report` pools
  // per-expectation outcomes across every report it is handed, and the refusal was
  // missing rather than out of scope. It is now read — see the read model — and
  // the new refusal is the one `eval-pool-identity.ts` owns for every pooling
  // caller, not a second rule written here.
]

const CASE_FIELDS_DELIBERATELY_NOT_READ: readonly string[] = [
  // How the RUN went. Parse validity, provider failures, agentic stages, discovery
  // telemetry, the context ledger, warnings and per-case spend all describe the
  // conditions a case ran under; recall is a property of the expectations, and a
  // case that errored contributes its expectations as misses either way.
  'parseValid',
  'providerErrored',
  'providerIssues',
  'agenticStages',
  'discovery',
  'contextLedger',
  'warnings',
  'inlineFindingCount',
  'refutationResults',
  'fixOutcomes',
  'durationMs',
  'inputTokens',
  'cachedInputTokens',
  'outputTokens',
  'usageUnavailable',
  'costUnavailable',
  'costUsd',
  // THE PRECISION SIDE. Every produced finding and every classification of one —
  // duplicates, false positives and their plausibility split, no-finding-zone
  // hits, and the artifact-only population's own copy of all of it — answers "what
  // did the engine say that nothing asked for?". Recall answers the opposite
  // question and its denominator is `expectedFindings`, so none of these can move
  // it.
  'producedFindings',
  'duplicateFindingIds',
  'falsePositiveFindingIds',
  'unlistedRealFindingIds',
  'genuineFalsePositiveFindingIds',
  'noFindingZoneFalsePositiveIds',
  'artifactOnlyFindingIds',
  'artifactOnlyMatchedFindings',
  'artifactOnlyFalsePositiveFindingIds',
  'artifactOnlyUnlistedRealFindingIds',
  'artifactOnlyGenuineFalsePositiveFindingIds',
  // The misses and the undecided pairs, as the producer recorded them. This view
  // derives a miss as "an expectation with no match", which is the same fact from
  // the two fields it already requires — deliberately, because those two have
  // never changed shape while these arrived later and default to empty. Reading a
  // defaulted-empty list from an older archive would read as "nothing was
  // inconclusive" rather than "nobody recorded it".
  'unmatchedExpectedIndexes',
  'inconclusiveExpectedIndexes',
  'inconclusiveFindingIds',
  'inconclusiveMatches'
]

// Empty, and worth keeping as a list rather than skipping the level: the recall
// report renders an expectation whole — its location, mode, severity and summary
// — so a field added to the producer's expectation is a field this view should
// almost certainly carry. An empty exclusion list is the strongest form of this
// guard, not a missing one.
const EXPECTED_FINDING_FIELDS_DELIBERATELY_NOT_READ: readonly string[] = []

const recallViewCoverage = [
  {
    label: 'report',
    producer: EvalReportSchema,
    readModel: recallViewReadModels.report,
    notRead: REPORT_FIELDS_DELIBERATELY_NOT_READ
  },
  {
    label: 'case result',
    producer: EvalCaseReportSchema,
    readModel: recallViewReadModels.caseResult,
    notRead: CASE_FIELDS_DELIBERATELY_NOT_READ
  },
  {
    label: 'expected finding',
    producer: EvalExpectedFindingReportSchema,
    readModel: recallViewReadModels.expectedFinding,
    notRead: EXPECTED_FINDING_FIELDS_DELIBERATELY_NOT_READ
  }
] as const

describe('the recall view accounts for every field the producer writes', () => {
  for (const { label, producer, readModel, notRead } of recallViewCoverage) {
    test(`reads or explicitly declines every ${label} field`, () => {
      const read = new Set(Object.keys(readModel.shape))
      const declined = new Set(notRead)
      const unaccounted = Object.keys(producer.shape).filter(
        (field) => !read.has(field) && !declined.has(field)
      )

      expect(unaccounted).toEqual([])
    })

    test(`declines nothing the ${label} no longer carries`, () => {
      const produced = new Set(Object.keys(producer.shape))
      const stale = [...Object.keys(readModel.shape), ...notRead].filter(
        (field) => !produced.has(field)
      )

      expect(stale).toEqual([])
    })
  }
})
