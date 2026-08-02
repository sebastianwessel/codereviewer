import { describe, expect, it } from 'vitest'
import {
  digestImpactReport,
  digestIntentReport,
  digestReviewReport
} from './report-digest.js'
import {
  impactReportFixture,
  intentReportFixture,
  reviewReportFixture
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
