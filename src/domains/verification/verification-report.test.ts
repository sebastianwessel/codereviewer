import { describe, expect, test } from 'vitest'
import {
  emptyVerificationReport,
  runWarningsForVerificationReport
} from './verification-report.js'

describe('runWarningsForVerificationReport', () => {
  test('rewrites a claim-provider-failure warning into a human run warning', () => {
    const report = { ...emptyVerificationReport(), warnings: ['claim-provider-failed:codeql'] }

    expect(runWarningsForVerificationReport(report)).toEqual([
      'Verification claim provider "codeql" failed and was skipped.'
    ])
  })

  test('passes an unrecognized warning through unchanged', () => {
    const report = { ...emptyVerificationReport(), warnings: ['some-other-warning'] }

    expect(runWarningsForVerificationReport(report)).toEqual(['some-other-warning'])
  })

  test('an empty report produces no run warnings', () => {
    expect(runWarningsForVerificationReport(emptyVerificationReport())).toEqual([])
  })
})
