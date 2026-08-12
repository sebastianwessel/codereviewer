import { describe, expect, it } from 'vitest'
import {
  digestImpactReport,
  digestIntentReport,
  digestReviewReport,
  ReportShapeError
} from './report-digest.js'
import {
  impactReportFixture,
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
        schemaVersion: '3.0',
        status: 'completed',
        summary: {
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
})
