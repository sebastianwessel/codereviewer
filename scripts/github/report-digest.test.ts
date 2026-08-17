import { describe, expect, it } from 'vitest'
import { ChangeImpactReferenceReportSchema } from '../../src/domains/change-impact/impact-report.js'
import {
  IntentFulfilmentReportSchema,
  ObligationStatusSchema,
  type ObligationStatus
} from '../../src/domains/intent-fulfilment/index.js'
import {
  BaselineStatusSchema,
  compareSeverityDescending,
  ReporterEligibilitySchema,
  ReviewReportSchema,
  SeveritySchema,
  type Severity
} from '../../src/shared/contracts/index.js'
import {
  digestImpactReport,
  digestIntentReport,
  digestReadModels,
  digestReviewReport,
  ReportShapeError,
  severityOrder
} from './report-digest.js'
import {
  impactReportFixture,
  impactReportWithAdjudicationFixture,
  intentReportFixture,
  reviewReportFixture,
  reviewReportWithFullAccountingFixture
} from './fixtures.js'

const json = (value: unknown): string => JSON.stringify(value)

/** The message a digest refusal carries, for asserting on what a human is told. */
const refusalMessage = (digest: () => unknown): string => {
  try {
    digest()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }

  throw new Error('the digest accepted a shape it was expected to refuse')
}

describe('digestReviewReport', () => {
  it('reduces a report to what the comment renders', () => {
    const digest = digestReviewReport(json(reviewReportFixture))

    expect(digest).toBeDefined()
    expect(digest?.runId).toBe('run_abc123')
    expect(digest?.qualityGatePassed).toBe(false)
    expect(digest?.failingFindingIds).toEqual(['find_high1'])
    expect(digest?.severityCounts).toMatchObject({ high: 1, medium: 1, low: 0 })
    expect(digest?.skippedFileCount).toBe(1)
    expect(digest?.costUsd).toBeCloseTo(1.2345)
  })

  it('carries the content-anchored fingerprint that inline comments key on', () => {
    const digest = digestReviewReport(json(reviewReportFixture))

    expect(digest?.findings[0]?.fingerprint).toBe('fp1')
  })

  // The comment asserts that a defect exists. Without the refuter's own account
  // of what it tried and could not do, the assertion is unfalsifiable from the
  // comment alone and a reader can only take it on faith.
  it('carries what refutation tried against the finding and could not do', () => {
    const digest = digestReviewReport(json(reviewReportFixture))

    expect(digest?.findings[0]?.whySurvived).toBe(
      'proved: Searched the route table for a guard that runs before the handler; none is registered.'
    )
  })

  it('leaves the refutation account absent rather than inventing one', () => {
    const digest = digestReviewReport(
      json({ ...reviewReportFixture, refutationResults: [] })
    )

    expect(digest?.findings[0]?.whySurvived).toBeUndefined()
  })

  it('tolerates a report that gained fields it does not know about', () => {
    const digest = digestReviewReport(
      json({ ...reviewReportFixture, somethingNew: { nested: true } })
    )

    expect(digest?.runId).toBe('run_abc123')
  })

  it('treats an absent quality gate as passing but records that it was absent', () => {
    const { qualityGate: _ignored, ...withoutGate } = reviewReportFixture
    const digest = digestReviewReport(json(withoutGate))

    expect(digest?.qualityGatePassed).toBe(true)
    expect(digest?.qualityGateEvaluated).toBe(false)
  })

  it('refuses something that is not a review report', () => {
    expect(() => digestReviewReport('not json')).toThrow(ReportShapeError)
    expect(() => digestReviewReport('{"run":{}}')).toThrow(ReportShapeError)
  })

  // THE DEFECT EVERY REFUSAL BELOW EXISTS FOR. `admittedFindings` moving is the
  // review report's version of what `symbols` moving did to the Impact section:
  // a loose schema parses the new shape, finds no findings, and the comment
  // reports that this search found nothing — a clearance, produced by a run that
  // found defects. There is no reader-visible difference between that and a clean
  // change, which is why the digest must refuse rather than render it.
  it('refuses a report whose findings moved rather than reporting zero findings', () => {
    const { admittedFindings, ...withoutFindings } = reviewReportFixture

    expect(() =>
      digestReviewReport(json({ ...withoutFindings, findings: admittedFindings }))
    ).toThrow(ReportShapeError)
  })

  // A finding is required to carry all of these by the engine's own contract
  // (`AdmittedFindingSchema`), so an absent one is not an older report — it is a
  // broken one, and a default in its place is a guess rendered as a fact.
  it('refuses a finding missing a field the engine always writes', () => {
    for (const field of [
      'description',
      'baselineStatus',
      'reporterEligibility',
      'fingerprints'
    ]) {
      const { [field]: _removed, ...finding } = reviewReportFixture
        .admittedFindings[0] as Record<string, unknown>

      expect(() =>
        digestReviewReport(
          json({ ...reviewReportFixture, admittedFindings: [finding] })
        )
      ).toThrow(ReportShapeError)
    }
  })

  // A schema bump is the producer declaring that a consumer must be re-read. The
  // pin turns that declaration into a red test in the commit that makes it, which
  // is the cheapest place this whole defect class can be caught.
  it('refuses a report written against a schema version it was not built for', () => {
    expect(() =>
      digestReviewReport(json({ ...reviewReportFixture, schemaVersion: '2.0' }))
    ).toThrow(ReportShapeError)
  })

  // What a refusal has to tell whoever reads the pull request: which report, what
  // is missing from the comment because of it, and where the disagreement lives.
  // The engine and this digest ship in one commit, so it is never a stale artifact.
  it('says which report failed, what is missing, and where to fix it', () => {
    const message = refusalMessage(() => digestReviewReport('{"run":{}}'))

    expect(message).toContain('review report')
    expect(message).toContain('no findings from it are shown')
    expect(message).toContain('scripts/github/report-digest.ts')
  })

  // A1: `reporterEligibility` used to be parsed by the schema and then dropped
  // on the floor before it reached `FindingDigest`, which is why the summary
  // comment could not tell an unresolved suspicion from a finished finding.
  it('carries reporterEligibility onto each finding', () => {
    const digest = digestReviewReport(json(reviewReportWithFullAccountingFixture))
    const byId = new Map(digest?.findings.map((finding) => [finding.id, finding]))

    expect(byId.get('find_high1')?.reporterEligibility).toBe('inline')
    expect(byId.get('find_medium1')?.reporterEligibility).toBe('summary-only')
    expect(byId.get('find_unresolved1')?.reporterEligibility).toBe('artifact-only')
  })

  // Severity counts describe what a reader must act on, so an artifact-only
  // suspicion — which is not a proved defect — must not inflate them.
  it('excludes artifact-only findings from severityCounts', () => {
    const digest = digestReviewReport(json(reviewReportWithFullAccountingFixture))

    expect(digest?.severityCounts.high).toBe(1)
  })

  // A3: the precision accounting the comment needs — how many candidates were
  // examined and how many were thrown out — was parsed by nothing at all.
  it('counts rejected candidates, defaulting to 0 rather than leaving it undefined', () => {
    expect(digestReviewReport(json(reviewReportFixture))?.rejectedFindingCount).toBe(0)
    expect(
      digestReviewReport(json(reviewReportWithFullAccountingFixture))
        ?.rejectedFindingCount
    ).toBe(2)
  })

  it('carries the merged-away count only when discovery telemetry is present', () => {
    expect(
      digestReviewReport(json(reviewReportFixture))?.mergedAwayCount
    ).toBeUndefined()
    expect(
      digestReviewReport(json(reviewReportWithFullAccountingFixture))
        ?.mergedAwayCount
    ).toBe(4)
  })

  // A2: resolved-baseline count. A run that never computed it (no `baseline`
  // field at all) must render as absent, not as a plausible zero.
  it('carries the resolved-baseline count only when the report computed it', () => {
    expect(
      digestReviewReport(json(reviewReportFixture))?.resolvedBaselineEntryCount
    ).toBeUndefined()
    expect(
      digestReviewReport(json(reviewReportWithFullAccountingFixture))
        ?.resolvedBaselineEntryCount
    ).toBe(2)
  })

  it('treats a computed-but-empty resolvedBaselineEntries as a real zero, not absence', () => {
    const digest = digestReviewReport(
      json({ ...reviewReportFixture, resolvedBaselineEntries: [] })
    )

    expect(digest?.resolvedBaselineEntryCount).toBe(0)
  })
})

describe('digestIntentReport', () => {
  it('lists only the obligations nothing in the change evidenced', () => {
    const digest = digestIntentReport(json(intentReportFixture))

    expect(digest?.obligationCount).toBe(3)
    expect(digest?.evidencedCount).toBe(2)
    expect(digest?.unevidenced).toEqual([
      { statement: 'Cover the guard with a test', status: 'not-evidenced' }
    ])
  })

  it('does not list a prohibition the change never went against as unevidenced', () => {
    // `not-contradicted` is the engine's answer for an obligation asking that
    // something NOT be done, which the change does not do. It produces no citation
    // by its nature, so listing it under "nothing evidences these" would put an
    // obligation nobody can act on in front of a reviewer on every run — 39.8% of
    // this lane's classified false positives before the status existed.
    const digest = digestIntentReport(
      json({
        ...intentReportFixture,
        summary: { ...intentReportFixture.summary, notContradictedCount: 1 },
        obligations: [
          ...intentReportFixture.obligations,
          {
            id: 'o4',
            source: {
              origin: 'inbox:pull-request/42',
              line: 7,
              text: 'Do not log session tokens'
            },
            statement: 'Do not log session tokens',
            status: 'not-contradicted'
          }
        ]
      })
    )

    expect(digest?.notContradictedCount).toBe(1)
    expect(digest?.unevidenced).toEqual([
      { statement: 'Cover the guard with a test', status: 'not-evidenced' }
    ])
  })

  it('keeps a "no intent was stated" status rather than reporting zero obligations', () => {
    const digest = digestIntentReport(
      json({ ...intentReportFixture, status: 'no-intent', obligations: [] })
    )

    expect(digest?.status).toBe('no-intent')
  })

  // The same defect as the review report's, one section over: without the counters
  // or the obligations, the Intent section renders "no obligation is left
  // unevidenced by this change" over a report the digest could not read. That is
  // the one error spec 23 calls expensive — a false "this is done" makes a
  // reviewer stop looking — manufactured by tolerance rather than by judgement.
  it('refuses an intent report whose summary or obligations moved', () => {
    const { summary: _summary, ...withoutSummary } = intentReportFixture
    const { obligations, ...withoutObligations } = intentReportFixture

    expect(() => digestIntentReport(json(withoutSummary))).toThrow(
      ReportShapeError
    )
    expect(() =>
      digestIntentReport(json({ ...withoutObligations, items: obligations }))
    ).toThrow(ReportShapeError)
  })

  it('refuses an intent report written against another schema version', () => {
    expect(() =>
      digestIntentReport(json({ ...intentReportFixture, schemaVersion: '2.0' }))
    ).toThrow(ReportShapeError)
  })

  it('says which report failed and what is missing', () => {
    const message = refusalMessage(() => digestIntentReport('{}'))

    expect(message).toContain('intent report')
    expect(message).toContain('Intent section is missing')
  })
})

describe('digestImpactReport', () => {
  // The shape the engine emits since schema 2.0: the changed symbols and the files
  // they reach are two normalized lists, joined on the name/path/line triple.
  it('keeps only symbols that actually have dependents', () => {
    const digest = digestImpactReport(json(impactReportFixture))

    expect(digest?.symbols.map((symbol) => symbol.name)).toEqual([
      'requireSession'
    ])
    expect(digest?.symbols[0]).toMatchObject({
      referenceCount: 2,
      testReferenceCount: 1
    })
  })

  // THE DEFECT THIS WHOLE FILE WAS REWRITTEN FOR, pinned as a refusal.
  //
  // Schema 2.0 replaced `symbols` — one list of changed symbols each carrying its
  // own references — with the normalized pair above. This digest read only
  // `symbols`, so from 434473a onward it parsed every report successfully, joined
  // nothing, and rendered no Impact section at all, in every pull-request comment,
  // for months. Nothing failed anywhere, because a tolerant reader has no failure:
  // the missing section was indistinguishable from a change that affects nothing.
  //
  // The old spelling must now be refused rather than read. Not because reading it
  // would be wrong, but because there is no producer left that can write it — see
  // the head of `report-digest.ts` — so a report shaped like this is a disagreement
  // with the engine, and the only useful thing to do with it is say so.
  it('refuses the pre-2.0 shape instead of rendering an empty section', () => {
    const legacy = {
      schemaVersion: '1.1',
      status: 'completed',
      summary: { changedSymbolCount: 1, referenceCount: 2, testReferenceCount: 1 },
      symbols: [
        {
          name: 'requireSession',
          definitionPath: 'src/auth/session.ts',
          definitionLine: 10,
          changeKind: 'modified',
          references: [{ path: 'src/routes/admin.ts', line: 40, text: 'requireSession()' }],
          testReferences: [{ path: 'src/auth/session.test.ts', line: 4, text: 'requireSession' }]
        }
      ],
      warnings: []
    }

    expect(() => digestImpactReport(json(legacy))).toThrow(ReportShapeError)
  })

  it('refuses an impact report written against another schema version', () => {
    expect(() =>
      digestImpactReport(json({ ...impactReportFixture, schemaVersion: '4.0' }))
    ).toThrow(ReportShapeError)
  })

  it('says which report failed and what is missing', () => {
    const message = refusalMessage(() => digestImpactReport('{}'))

    expect(message).toContain('impact report')
    expect(message).toContain('Impact section is missing')
  })

  // Same name, same file, different declarations: the join key is the full triple
  // for exactly this case, and a narrower key would give one symbol the other's
  // callers.
  it('does not give one symbol the callers of a same-named symbol', () => {
    const digest = digestImpactReport(
      json({
        // Built on the fixture so the bookkeeping the digest now reads — the
        // adjudication status and its counters — is the shape a run writes,
        // rather than a hand-made minimum that would drift from it.
        ...impactReportFixture,
        summary: {
          ...impactReportFixture.summary,
          changedSymbolCount: 2,
          referenceCount: 1,
          testReferenceCount: 0
        },
        changedSymbols: [
          {
            name: 'parse',
            definitionPath: 'src/a.ts',
            definitionLine: 1,
            changeKind: 'modified'
          },
          {
            name: 'parse',
            definitionPath: 'src/a.ts',
            definitionLine: 9,
            changeKind: 'modified'
          }
        ],
        impactedFiles: [
          {
            path: 'src/b.ts',
            symbols: [
              {
                name: 'parse',
                definitionPath: 'src/a.ts',
                definitionLine: 9,
                sites: [{ line: 3, text: 'parse(input)' }]
              }
            ]
          }
        ],
        impactedTestFiles: [],
        warnings: []
      })
    )

    expect(digest?.symbols).toHaveLength(1)
    expect(digest?.symbols[0]).toMatchObject({
      definitionPath: 'src/a.ts',
      referenceCount: 1
    })
  })

  // THE ADJUDICATED LAYER, which this digest did not read at all until
  // 2026-08-16: an operator who turned `changeImpact.adjudication.enabled` on
  // bought model calls that decided which dependents actually break, and the
  // digest dropped every one of them before the comment could render it.
  it('carries the adjudicated findings and everything they are relied on with', () => {
    const digest = digestImpactReport(json(impactReportWithAdjudicationFixture))

    expect(digest.adjudicationStatus).toBe('completed')
    expect(digest.findings.map((finding) => finding.path)).toEqual([
      'src/routes/admin.ts',
      'src/auth/session.test.ts'
    ])
    // Spec 22: a finding MUST carry the dependent's path and line, the contract
    // element relied upon, and the consequence. All four survive the digest, or
    // the comment states a judgement it cannot back.
    expect(digest.findings[0]).toMatchObject({
      destination: 'production',
      compatibilityClass: 'breaks-on-build'
    })
    expect(digest.findings[0]?.reliances[0]).toEqual({
      line: 41,
      symbolName: 'loadUser',
      contractElement: 'the declaration of loadUser, which this change removes',
      consequence: 'this reference cannot resolve and the file will not build',
      adjudicatedBy: 'deterministic'
    })
    // One file, two tiers. Which sentence cost a provider call is a property of
    // the reliance, and flattening it onto the finding would lose it.
    expect(digest.findings[0]?.reliances[1]?.adjudicatedBy).toBe('model')
  })

  // An empty finding list means three different things, and the counters are what
  // separate them. Summed here, once, by the contract's own helper.
  it('sums how much was checked, so an empty list can be told from an absent one', () => {
    const checked = digestImpactReport(
      json(impactReportWithAdjudicationFixture)
    )
    const disabled = digestImpactReport(json(impactReportFixture))

    // 3 relied upon + 0 settled in code + 1 answered "does not rely".
    expect(checked.checkedPairCount).toBe(4)
    expect(checked.adjudicationCallCount).toBe(3)
    expect(disabled.adjudicationStatus).toBe('disabled')
    expect(disabled.checkedPairCount).toBe(0)
  })

  // The counters that say the triage above is narrower than it looks. A run whose
  // provider threw, or whose call cap bound the residue, must not be readable as
  // a run that checked everything and found little.
  it('carries the counters that qualify a partial triage', () => {
    const digest = digestImpactReport(
      json({
        ...impactReportWithAdjudicationFixture,
        summary: {
          ...impactReportWithAdjudicationFixture.summary,
          unadjudicatedPairCount: 2,
          failedAdjudicationCallCount: 1,
          adjudicationCallsTruncated: true
        }
      })
    )

    expect(digest).toMatchObject({
      unadjudicatedPairCount: 2,
      failedAdjudicationCallCount: 1,
      adjudicationCallsTruncated: true
    })
  })

  // `adjudicationStatus` is DECIDED on by the renderer — it is what tells "checked
  // and found nothing" from "never ran" — so a fourth member added to the
  // vocabulary must fail here rather than take the quietest branch.
  it('refuses an adjudication status this build does not know', () => {
    expect(() =>
      digestImpactReport(
        json({ ...impactReportFixture, adjudicationStatus: 'partial' })
      )
    ).toThrow(ReportShapeError)
  })

  // Same rule for the compatibility class, which keys the wording of every
  // rendered finding. `no-impact` is the case that matters: it is a real member of
  // the contract's enum and an adjudication outcome, but never a finding, and a
  // report carrying one would be manufacturing something to look at.
  it('refuses a finding carrying a compatibility class that is not reportable', () => {
    expect(() =>
      digestImpactReport(
        json({
          ...impactReportWithAdjudicationFixture,
          impactFindings: [
            {
              ...impactReportWithAdjudicationFixture.impactFindings[0],
              compatibilityClass: 'no-impact'
            }
          ]
        })
      )
    ).toThrow(ReportShapeError)
  })
})

// A finding as the fixture writes it, with one field replaced by a value the
// producer's contract does not admit. The fixtures themselves cannot carry such a
// value — `fixtures.ts` parses each one through the producer's own schema on
// import — which is precisely the half of the problem those imports already close.
const reviewReportWithFindingField = (
  field: 'reporterEligibility' | 'baselineStatus',
  value: string
): unknown => ({
  ...reviewReportFixture,
  admittedFindings: [
    { ...reviewReportFixture.admittedFindings[0]!, [field]: value },
    ...reviewReportFixture.admittedFindings.slice(1)
  ]
})

const intentReportWithObligationStatuses = (
  statuses: readonly string[]
): unknown => ({
  ...intentReportFixture,
  obligations: statuses.map((status, index) => ({
    id: `o${index + 1}`,
    source: {
      origin: 'inbox:pull-request/42',
      line: index + 1,
      text: `Obligation ${index + 1}`
    },
    statement: `Obligation ${index + 1}`,
    status
  }))
})

// How the comment treats each obligation status. `unevidenced` is the list a
// reviewer reads as "nothing in this change does these", so a status landing on it
// is a claim about the change, and a status kept off it is a decision that a claim
// would be false or unactionable.
//
// A status added to `ObligationStatusSchema` and not classified here fails this
// test in the commit that adds it. Before the digest imported the vocabulary it
// could not: a new status parsed as a plain string, fell through both exclusions
// below, and joined the outstanding list on every pull request — which is exactly
// the false-alarm mode `not-contradicted` was introduced to remove.
const OBLIGATION_STATUS_TREATMENT: Readonly<
  Record<ObligationStatus, 'listed-as-unevidenced' | 'not-listed'>
> = {
  // The change does what the obligation asks and cites the lines that do it.
  evidenced: 'not-listed',
  'not-evidenced': 'listed-as-unevidenced',
  // A prohibition the change never went against. It produces no citation by its
  // nature, so listing it would put an obligation nobody can act on in front of a
  // reviewer on every run.
  'not-contradicted': 'not-listed',
  // The material did not settle it, which is a real answer and one a human still
  // has to look at.
  undetermined: 'listed-as-unevidenced'
}

describe('the digest reads its producers closed vocabularies', () => {
  it('refuses a reporter eligibility the finding contract does not define', () => {
    expect(() =>
      digestReviewReport(
        json(reviewReportWithFindingField('reporterEligibility', 'needs-triage'))
      )
    ).toThrow(ReportShapeError)
  })

  it('refuses a baseline status the finding contract does not define', () => {
    expect(() =>
      digestReviewReport(
        json(reviewReportWithFindingField('baselineStatus', 'reopened'))
      )
    ).toThrow(ReportShapeError)
  })

  it('refuses an obligation status the intent contract does not define', () => {
    expect(() =>
      digestIntentReport(json(intentReportWithObligationStatuses(['deferred'])))
    ).toThrow(ReportShapeError)
  })

  // Refusing what the producer cannot write is only half of it: every value the
  // producer CAN write has to be readable, or pinning the vocabulary would trade a
  // silent miscount for a comment that refuses to render at all.
  it('reads every eligibility and baseline status the contract admits', () => {
    for (const eligibility of ReporterEligibilitySchema.options) {
      expect(() =>
        digestReviewReport(
          json(reviewReportWithFindingField('reporterEligibility', eligibility))
        )
      ).not.toThrow()
    }

    for (const baselineStatus of BaselineStatusSchema.options) {
      expect(() =>
        digestReviewReport(
          json(reviewReportWithFindingField('baselineStatus', baselineStatus))
        )
      ).not.toThrow()
    }
  })

  it('classifies every obligation status the intent contract admits', () => {
    const classified = new Set(Object.keys(OBLIGATION_STATUS_TREATMENT))

    expect(
      ObligationStatusSchema.options.filter((status) => !classified.has(status))
    ).toEqual([])
    // The mirror failure: an entry outliving the status it names would leave the
    // table looking complete while the new spelling went unclassified.
    const admitted = new Set<string>(ObligationStatusSchema.options)
    expect(
      Object.keys(OBLIGATION_STATUS_TREATMENT).filter(
        (status) => !admitted.has(status)
      )
    ).toEqual([])
  })

  it('lists exactly the statuses classified as unevidenced', () => {
    const statuses = ObligationStatusSchema.options
    const digest = digestIntentReport(
      json(intentReportWithObligationStatuses(statuses))
    )
    const listed = new Set(digest.unevidenced.map((obligation) => obligation.status))

    expect([...statuses].filter((status) => listed.has(status)).sort()).toEqual(
      [...statuses]
        .filter(
          (status) =>
            OBLIGATION_STATUS_TREATMENT[status] === 'listed-as-unevidenced'
        )
        .sort()
    )
  })
})

// Fields each producer writes that the digest deliberately does not read.
//
// The rule is `eval-comparison-view.test.ts`'s, for the same reason and against
// the same failure: a hand-maintained narrow view has no failure mode when the
// producer GAINS a field. It parses, it renders, and the new fact is simply never
// in the comment — which is how `changedSymbols` stayed unread for months while
// every test here passed. Refusing an unreadable shape catches a field that MOVED;
// only this list catches one that arrived.
//
// Adding a key here is a decision, not a formality: state what the comment loses
// by not rendering it. If the answer is "nothing a reader needs", it belongs here;
// if it is "we never got to it", model it instead.
const REVIEW_FIELDS_DELIBERATELY_NOT_READ: readonly string[] = [
  // The evidence records every finding cites. The comment shows a finding's
  // location and what refutation could not do to it, and links to the artifacts
  // for the rest; inlining evidence bodies would put untrusted model-adjacent text
  // into a pull request comment for no decision a reader makes there.
  'evidence',
  // The test-adequacy signal. It has no section in this comment (it is rendered by
  // the markdown report), and adding one is a product decision, not a read.
  'testAdequacy',
  // Verification cross-witnesses of general-review findings. A confidence signal
  // that never changes a finding's severity, admission or the gate, and the comment
  // states no per-finding confidence.
  'corroborations',
  // The list of artifacts the run wrote. `pipeline.ts` reads the run directory it
  // spawned by artifact NAME, so this list is bookkeeping the comment never
  // resolves.
  'artifacts'
]

const INTENT_FIELDS_DELIBERATELY_NOT_READ: readonly string[] = [
  // When the report was written. The comment is about the run it was posted from,
  // and a timestamp beside it would only invite reading a stale comment as fresh.
  'generatedAt',
  // The refs and counts the lane ran over. The pull request already states its own
  // base and head, above the comment.
  'scope',
  // The changed files no stated obligation covers. The COUNT is rendered, from
  // `summary.extraScopeFileCount`; the file list itself is left to the artifact
  // rather than spent on comment length.
  'extraScope',
  // Tokens and cost for this lane. The comment publishes one run-level cost, from
  // the review report.
  'usage'
]

// `impactFindings` and `adjudicationStatus` were BOTH on this list until
// 2026-08-16, declared as a live product question: how a model-authored finding
// list should be read beside the review's own was said to be undecided. The
// consequence of leaving it undecided was not neutral. An operator who switched
// `changeImpact.adjudication.enabled` on paid for the calls that decide which
// dependents actually break, the engine wrote them into `impact-report.json`, and
// the human on the pull request saw only the untriaged reference table — the layer
// spec 22 calls the floor, and measures near 90% irrelevant on its own. The two
// lists are now rendered as two lists, under separate headings, and the question
// is answered where a reader can see the answer.
const IMPACT_FIELDS_DELIBERATELY_NOT_READ: readonly string[] = [
  'generatedAt',
  'scope',
  // Tokens and cost for this lane. The comment publishes one run-level cost, from
  // the review report — the same decision the intent lane's usage gets.
  'usage'
]

// One producer contract, one read model, and the two lists that must account for
// every key the producer writes.
const readModelCoverage = [
  {
    label: 'review report',
    producer: ReviewReportSchema,
    readModel: digestReadModels.review,
    notRead: REVIEW_FIELDS_DELIBERATELY_NOT_READ
  },
  {
    label: 'intent report',
    producer: IntentFulfilmentReportSchema,
    readModel: digestReadModels.intent,
    notRead: INTENT_FIELDS_DELIBERATELY_NOT_READ
  },
  {
    label: 'impact report',
    producer: ChangeImpactReferenceReportSchema,
    readModel: digestReadModels.impact,
    notRead: IMPACT_FIELDS_DELIBERATELY_NOT_READ
  }
] as const

// The guard is on the TOP LEVEL of each report, which is where the shape change
// that motivated it happened (`symbols` → `changedSymbols`/`impactedFiles`) and
// where a producer change removes or adds a whole SECTION of the comment. It does
// not enumerate nested shapes; the refusal rule in `report-digest.ts` is what
// covers a nested field that moves.
describe('the digest accounts for every field its producers write', () => {
  for (const { label, producer, readModel, notRead } of readModelCoverage) {
    it(`reads or explicitly declines every ${label} field`, () => {
      const read = new Set(Object.keys(readModel.shape))
      const declined = new Set(notRead)
      const unaccounted = Object.keys(producer.shape).filter(
        (field) => !read.has(field) && !declined.has(field)
      )

      expect(unaccounted).toEqual([])
    })

    it(`declines nothing the ${label} no longer carries`, () => {
      const produced = new Set(Object.keys(producer.shape))
      const stale = [...Object.keys(readModel.shape), ...notRead].filter(
        (field) => !produced.has(field)
      )

      expect(stale).toEqual([])
    })
  }
})

// `severityOrder` is the pull-request comment's ordering AND its counts line, and
// it used to be a hand-written literal beside the engine's own private ordering.
// The two agreed, so nothing was wrong and nothing was watching: a sixth severity
// would have typechecked, been counted into `severityCounts`, then been dropped
// from the counts line and sorted ahead of `critical` (`indexOf` returns `-1`).
// It is derived from the vocabulary and the comparator now, and these pin the
// derivation from both ends.
describe('severityOrder', () => {
  it('renders most severe first', () => {
    // The literal is repeated HERE on purpose, and only here. Deriving the array
    // means a new severity silently takes a position in a pull-request comment;
    // this fails when that happens, so somebody confirms the comment still reads
    // the way it should before the change ships.
    expect(severityOrder).toEqual(['critical', 'high', 'medium', 'low', 'info'])
  })

  it('names every member of the severity vocabulary', () => {
    expect([...severityOrder].sort()).toEqual([...SeveritySchema.options].sort())
  })

  it('agrees member for member with the engine ordering', () => {
    // Strictly descending by the engine's own comparator, so the comment can never
    // rank two severities differently from admission's floor or the report sort.
    for (let index = 1; index < severityOrder.length; index += 1) {
      const previous = severityOrder[index - 1] as Severity
      const current = severityOrder[index] as Severity

      expect(compareSeverityDescending(previous, current)).toBeLessThan(0)
    }
  })
})
