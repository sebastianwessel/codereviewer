import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../../../../shared/contracts/index.js'
import type { BaselineFingerprintRecord } from '../../../admission/index.js'
import type { DriftFinding } from '../../../drift/index.js'
import { prepareReviewRunFinalization } from './finalization.js'

const config = CodeReviewerConfigSchema.parse({
  provider: {
    id: 'openai',
    model: 'gpt-5-mini'
  },
  reporting: {
    formats: ['json']
  },
  baseline: {
    includeResolvedInReport: true
  }
})

const warningDriftFinding = {
  id: 'drift-docs',
  category: 'documentation-drift',
  gate: 'warning',
  path: 'docs/guide.md',
  message: 'Stale docs.',
  evidence: 'docs',
  recommendation: 'Update docs.'
} satisfies DriftFinding

const errorDriftFinding = {
  ...warningDriftFinding,
  id: 'drift-security',
  category: 'security-drift',
  gate: 'error'
} satisfies DriftFinding

const baselineFingerprints: readonly BaselineFingerprintRecord[] = [
  {
    fingerprints: [
      {
        algorithm: 'v1',
        value: 'abc123'
      }
    ]
  }
]

describe('review runner finalization', () => {
  test('prepares run cost, warnings, and resolved baseline entries', () => {
    const finalization = prepareReviewRunFinalization({
      config,
      configWarnings: ['config-warning'],
      driftFindings: [warningDriftFinding, errorDriftFinding],
      admissionWarnings: ['admission-warning'],
      admittedFindings: [],
      baselineFingerprints,
      providerUsage: {
        inputTokens: 1_000_000,
        outputTokens: 500_000
      }
    })

    expect(finalization.runCost).toEqual({
      warnings: [],
      costUsd: 1.25,
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      cachedInputTokens: 0
    })
    expect(finalization.warnings).toEqual([
      'config-warning',
      'drift:documentation-drift',
      'admission-warning'
    ])
    expect(finalization.resolvedBaselineEntries).toEqual([
      {
        algorithm: 'v1',
        value: 'abc123'
      }
    ])
  })

  // `baselineFingerprints` is undefined exactly when there is nothing to compare
  // against — a configured baseline file that does not exist yet, which is the
  // first run after enabling one. `?? []` turned that into "compared against an
  // empty set, zero resolved", and the field then reaches the report as a
  // COMPUTED empty array. The pull-request digest reads computed-empty as a real
  // zero on purpose, so the comment printed "No longer reported: 0
  // previously-flagged findings did not come back this run" for a run that
  // compared against nothing — while the same report marked every finding
  // `baselineStatus: unknown` and warned `baseline-missing`.
  test('reports no resolved entries at all when there was no baseline to compare against', () => {
    const finalization = prepareReviewRunFinalization({
      config,
      driftFindings: [],
      admissionWarnings: [],
      admittedFindings: []
    })

    expect(finalization.resolvedBaselineEntries).toBeUndefined()
  })

  // The counterweight: a baseline that exists and resolved nothing IS a measured
  // zero, and must keep saying so.
  test('reports a measured zero when the baseline exists and resolved nothing', () => {
    const finalization = prepareReviewRunFinalization({
      config,
      driftFindings: [],
      admissionWarnings: [],
      admittedFindings: [],
      baselineFingerprints: []
    })

    expect(finalization.resolvedBaselineEntries).toEqual([])
  })
})
