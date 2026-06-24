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
      outputTokens: 500_000
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
})
