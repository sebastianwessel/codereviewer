import { describe, expect, it } from 'vitest'
import {
  digestImpactReport,
  digestIntentReport,
  digestReviewReport
} from './report-digest.js'
import {
  impactReportFixture,
  intentReportFixture,
  reviewReportFixture,
  reviewReportWithFullAccountingFixture
} from './fixtures.js'

const json = (value: unknown): string => JSON.stringify(value)

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

  it('returns undefined for something that is not a review report', () => {
    expect(digestReviewReport('not json')).toBeUndefined()
    expect(digestReviewReport('{"run":{}}')).toBeUndefined()
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

  it('defaults a missing reporterEligibility to "unknown" rather than guessing', () => {
    const { reporterEligibility: _ignored, ...findingWithoutEligibility } =
      reviewReportFixture.admittedFindings[0] as Record<string, unknown> & {
        reporterEligibility: string
      }
    const digest = digestReviewReport(
      json({
        ...reviewReportFixture,
        admittedFindings: [findingWithoutEligibility]
      })
    )

    expect(digest?.findings[0]?.reporterEligibility).toBe('unknown')
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
})

describe('digestImpactReport', () => {
  // The <= 1.1 shape, where each changed symbol carried its own references. Kept
  // because this digest must also work against an installed engine older than the
  // workflow it runs from.
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

  // The shape the engine ACTUALLY emits since schema 2.0: the changed symbols and
  // the files they reach are two normalized lists, joined on the name/path/line
  // triple. Nothing read `changedSymbols`, so between 2.0 and this test the Impact
  // section silently vanished from every pull-request comment while the fixture
  // above kept the unit suite green. `src/cli/review-e2e.test.ts` is what caught
  // it; this is the same fact pinned where it is cheap to check.
  it('joins the normalized >= 2.0 lists into per-symbol reference counts', () => {
    const digest = digestImpactReport(
      json({
        schemaVersion: '3.0',
        status: 'completed',
        summary: {
          changedSymbolCount: 2,
          referenceCount: 2,
          testReferenceCount: 1
        },
        changedSymbols: [
          {
            name: 'requireSession',
            definitionPath: 'src/auth/session.ts',
            definitionLine: 10,
            changeKind: 'modified'
          },
          {
            name: 'unusedHelper',
            definitionPath: 'src/auth/session.ts',
            definitionLine: 30,
            changeKind: 'new'
          }
        ],
        impactedFiles: [
          {
            path: 'src/routes/admin.ts',
            symbols: [
              {
                name: 'requireSession',
                definitionPath: 'src/auth/session.ts',
                definitionLine: 10,
                sites: [
                  { line: 40, text: 'requireSession(request)' },
                  { line: 41, text: 'requireSession(other)' }
                ]
              }
            ]
          }
        ],
        impactedTestFiles: [
          {
            path: 'src/auth/session.test.ts',
            symbols: [
              {
                name: 'requireSession',
                definitionPath: 'src/auth/session.ts',
                definitionLine: 10,
                sites: [{ line: 4, text: 'requireSession' }]
              }
            ]
          }
        ],
        warnings: []
      })
    )

    expect(digest?.symbols.map((symbol) => symbol.name)).toEqual([
      'requireSession'
    ])
    expect(digest?.symbols[0]).toMatchObject({
      referenceCount: 2,
      testReferenceCount: 1
    })
  })

  // Same name, same file, different declarations: the join key is the full triple
  // for exactly this case, and a narrower key would give one symbol the other's
  // callers.
  it('does not give one symbol the callers of a same-named symbol', () => {
    const digest = digestImpactReport(
      json({
        schemaVersion: '3.0',
        status: 'completed',
        summary: { changedSymbolCount: 2, referenceCount: 1 },
        changedSymbols: [
          { name: 'parse', definitionPath: 'src/a.ts', definitionLine: 1 },
          { name: 'parse', definitionPath: 'src/a.ts', definitionLine: 9 }
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
