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

  // The count leads the suffix because a provider id carries its own colon. A
  // format that split on the first colon from the other end would report the
  // withheld count as part of the path.
  test('rewrites a claim-cap warning, keeping a provider id that contains a colon whole', () => {
    const report = {
      ...emptyVerificationReport(),
      warnings: ['claim-provider-capped:700:claims-file:.codereviewer/claims.json']
    }

    expect(runWarningsForVerificationReport(report)).toEqual([
      'Verification claim provider "claims-file:.codereviewer/claims.json" reached the per-provider cap of 200 claims; 700 further claim(s) were not investigated.'
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
