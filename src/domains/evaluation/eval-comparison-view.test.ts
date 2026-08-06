import { describe, expect, test } from 'vitest'
import { parseEvalComparisonReport } from './eval-comparison-view.js'
import { EvalReportSchema } from './eval-report-contracts.js'

// The archived shape that broke `eval compare`: discovery totals written before
// `cappedByLimitCount` existed, in a report the producer contract now requires
// it in.
const archivedReport = {
  metricsVersion: '2026-08-01.discovery-telemetry',
  schemaVersion: '1.0',
  caseResults: [
    {
      caseId: 'case-a',
      discovery: {
        totals: { callCount: 3, rawFindingCount: 4 },
        tasks: [{ taskId: 'task-1', callCount: 3, rawFindingCount: 4 }]
      }
    }
  ],
  metrics: { recall: 0.5, precision: 0.5 }
}

describe('eval comparison view', () => {
  // The producer contract is correct to reject it: that report was not written
  // by this build. The comparison view exists because comparison must read it
  // anyway.
  test('the producer contract rejects a report missing a required field', () => {
    expect(() => EvalReportSchema.parse(archivedReport)).toThrow()
  })

  test('the comparison view reads it', () => {
    expect(() => parseEvalComparisonReport(archivedReport)).not.toThrow()
  })

  // The whole point of the view over a loosened producer contract.
  test('keeps an absent metric absent rather than defaulting it to zero', () => {
    const report = parseEvalComparisonReport(archivedReport)

    expect(report.metrics?.recall).toBe(0.5)
    expect(report.metrics?.falsePositiveCount).toBeUndefined()
    expect(report.metrics?.genuineFalsePositiveCount).toBeUndefined()
    expect(report.metricGroups).toBeUndefined()
  })

  // `null` (a rate over an empty denominator) and `undefined` (a rate the run
  // never recorded) are opposite statements and must survive parsing as such.
  test('distinguishes a measured-nothing rate from an unrecorded one', () => {
    const report = parseEvalComparisonReport({
      metricsVersion: 'x',
      metrics: { recallByDiffScope: { 'out-of-diff': null } }
    })

    expect(report.metrics?.recallByDiffScope?.['out-of-diff']).toBeNull()
    expect(report.metrics?.recallByDiffScope?.['in-diff']).toBeUndefined()
  })

  // A field a future engine build adds must not make an old tool refuse the
  // report, which is the mirror image of the defect being fixed.
  test('ignores a field the view does not model', () => {
    expect(() =>
      parseEvalComparisonReport({
        metricsVersion: 'x',
        somethingAddedLater: { nested: true }
      })
    ).not.toThrow()
  })

  // A report predating versioning gets the recorded sentinel, which the
  // scoring-rule history declares as "nothing is known", not a comparable id.
  test('defaults a missing metrics version to the pre-versioning sentinel', () => {
    expect(parseEvalComparisonReport({}).metricsVersion).toBe('pre-2026-07-26')
  })
})
