import { describe, expect, test } from 'vitest'
import type { DriftCheckResult } from '../drift/index.js'
import {
  createDriftGateError,
  driftWarningsFor
} from './review-runner-drift.js'

const driftResult = {
  passed: false,
  warningCount: 1,
  errorCount: 1,
  findings: [
    {
      id: 'warning-drift',
      category: 'documentation-drift',
      gate: 'warning',
      path: 'docs/example.md',
      message: 'Documentation warning.',
      evidence: 'docs',
      recommendation: 'Update the docs.'
    },
    {
      id: 'error-drift',
      category: 'security-drift',
      gate: 'error',
      path: 'README.md',
      message: 'Security drift.',
      evidence: 'legacy artifact path',
      recommendation: 'Use .codereviewer.'
    }
  ]
} satisfies DriftCheckResult

describe('review runner drift helpers', () => {
  test('creates report warning strings only for warning drift findings', () => {
    expect(driftWarningsFor(driftResult.findings)).toEqual([
      'drift:documentation-drift'
    ])
  })

  test('creates a structured drift quality-gate error from a failed drift result', () => {
    expect(createDriftGateError(driftResult)).toEqual({
      code: 'drift_gate_failed',
      message: 'Review stopped because hard drift findings block the run.',
      category: 'quality-gate',
      recoverable: true,
      exitCode: 1,
      details: {
        errorCount: 1,
        warningCount: 1
      }
    })
  })
})
