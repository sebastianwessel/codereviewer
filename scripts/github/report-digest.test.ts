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

  it('keeps a "no intent was stated" status rather than reporting zero obligations', () => {
    const digest = digestIntentReport(
      json({ ...intentReportFixture, status: 'no-intent', obligations: [] })
    )

    expect(digest?.status).toBe('no-intent')
  })
})

describe('digestImpactReport', () => {
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
})
