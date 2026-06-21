import { describe, expect, test } from 'vitest'
import type { EvidenceRecord } from '../../shared/contracts/index.js'
import {
  admitCandidate,
  type CandidateFinding,
  type AdmissionPolicy
} from './admission-gate.js'
import {
  evaluateQualityGate,
  matchBaselineFindings,
  type BaselineFingerprintRecord
} from './index.js'

const configHash =
  '1111111111111111111111111111111111111111111111111111111111111111'

const diffEvidence: EvidenceRecord = {
  id: 'ev_diff1',
  kind: 'diff',
  summary: 'Changed branch can return an incorrect value.',
  location: {
    path: 'src/app.ts',
    startLine: 4,
    side: 'new'
  },
  source: 'typescript-analyzer',
  contentHash:
    '2222222222222222222222222222222222222222222222222222222222222222',
  redactionApplied: true
}

const modelEvidence: EvidenceRecord = {
  id: 'ev_model1',
  kind: 'model-rationale',
  summary: 'The model thinks this looks wrong.',
  source: 'review-agent',
  redactionApplied: true
}

const candidate: CandidateFinding = {
  id: 'cand_bug1',
  taskId: 'task_bug1',
  category: 'bug',
  severity: 'high',
  title: 'Incorrect return branch',
  description: 'The changed branch can return an incorrect value for callers.',
  location: {
    path: 'src/app.ts',
    startLine: 4,
    side: 'new'
  },
  evidenceIds: ['ev_diff1'],
  proposedBy: 'review-agent',
  confidence: 0.8,
  fixProposal: {
    summary: 'Return the computed value from the changed branch.',
    evidenceIds: ['ev_diff1'],
    safety: 'manual-review'
  }
}

const policy: AdmissionPolicy = {
  reviewedPaths: ['src/app.ts'],
  minimumSeverity: 'low',
  inlineSeverityThreshold: 'high',
  provenance: {
    reviewer: 'review-agent',
    modelProvider: 'openai',
    modelName: 'gpt-5-mini',
    instructionHashes: [],
    skillHashes: [],
    analyzerVersions: {
      typescript: '6.0.3'
    },
    configHash
  },
  admittedAt: '2026-06-20T00:00:00.000Z'
}

describe('admission gate', () => {
  test('admits candidates with reviewed locations and non-model evidence', () => {
    const result = admitCandidate({
      candidate,
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy
    })

    expect(result.status).toBe('admitted')
    expect(result.admittedFinding).toMatchObject({
      category: 'bug',
      severity: 'high',
      admissionStatus: 'admitted',
      reporterEligibility: 'inline',
      baselineStatus: 'new',
      evidenceIds: ['ev_diff1'],
      fixProposal: expect.objectContaining({
        safety: 'manual-review'
      })
    })
    expect(result.admittedFinding?.fingerprints[0]?.algorithm).toBe(
      'v1-category-rule-path-location-title-evidence'
    )
  })

  test('rejects schema-invalid candidates', () => {
    const result = admitCandidate({
      candidate: {
        ...candidate,
        severity: 'urgent'
      },
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy
    })

    expect(result.rejectedFinding).toEqual({
      candidateId: 'cand_bug1',
      status: 'rejected',
      reason: 'schema-invalid',
      message: expect.stringContaining('Candidate failed schema validation.'),
      evidenceIds: ['ev_diff1']
    })
  })

  test('marks model-only candidates as needs-more-evidence', () => {
    const result = admitCandidate({
      candidate: {
        ...candidate,
        evidenceIds: ['ev_model1'],
        fixProposal: {
          summary: 'Investigate the model-only concern.',
          evidenceIds: ['ev_model1'],
          safety: 'manual-review'
        }
      },
      evidence: [modelEvidence],
      existingAdmittedFindings: [],
      policy
    })

    expect(result.rejectedFinding).toMatchObject({
      candidateId: 'cand_bug1',
      status: 'needs-more-evidence',
      reason: 'insufficient-evidence'
    })
  })

  test('rejects invalid locations, duplicate fingerprints, and below-threshold severity', () => {
    const admitted = admitCandidate({
      candidate,
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy
    }).admittedFinding

    expect(admitted).toBeDefined()

    expect(
      admitCandidate({
        candidate: {
          ...candidate,
          location: {
            path: 'src/other.ts',
            startLine: 1,
            side: 'new'
          }
        },
        evidence: [diffEvidence],
        existingAdmittedFindings: [],
        policy
      }).rejectedFinding
    ).toMatchObject({ reason: 'location-invalid' })

    expect(
      admitCandidate({
        candidate,
        evidence: [diffEvidence],
        existingAdmittedFindings: [admitted!],
        policy
      }).rejectedFinding
    ).toMatchObject({ reason: 'duplicate' })

    expect(
      admitCandidate({
        candidate: {
          ...candidate,
          severity: 'info'
        },
        evidence: [diffEvidence],
        existingAdmittedFindings: [],
        policy: {
          ...policy,
          minimumSeverity: 'medium'
        }
      }).rejectedFinding
    ).toMatchObject({ reason: 'below-threshold' })
  })

  test('rejects same-evidence same-location duplicates even when title wording differs', () => {
    const admitted = admitCandidate({
      candidate: {
        ...candidate,
        proposedBy: 'typescript-analyzer',
        title: 'Parse diagnostic blocks reliable review'
      },
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy
    }).admittedFinding

    expect(admitted).toBeDefined()

    const result = admitCandidate({
      candidate: {
        ...candidate,
        id: 'cand_modelduplicate',
        proposedBy: 'review-agent',
        title: 'TypeScript parse error: Expression expected',
        description:
          'The TypeScript analyzer reported the same parse diagnostic at the same location.'
      },
      evidence: [diffEvidence],
      existingAdmittedFindings: [admitted!],
      policy
    })

    expect(result.rejectedFinding).toMatchObject({
      candidateId: 'cand_modelduplicate',
      reason: 'duplicate'
    })
  })

  test('rejects fix proposals that are not tied to candidate evidence', () => {
    const result = admitCandidate({
      candidate: {
        ...candidate,
        fixProposal: {
          summary: 'Change the branch.',
          evidenceIds: ['ev_missing'],
          safety: 'manual-review'
        }
      },
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy
    })

    expect(result.rejectedFinding).toMatchObject({
      reason: 'schema-invalid'
    })
  })

  test('redacts model-controlled finding text before admission', () => {
    const result = admitCandidate({
      candidate: {
        ...candidate,
        title: 'Leaked sk-proj-abcdefghijklmnopqrstuvwxyz123456',
        description:
          'Provider echoed Authorization: Bearer very-secret-token-value',
        fixProposal: {
          summary: 'Use sk-proj-abcdefghijklmnopqrstuvwxyz123456 nowhere.',
          evidenceIds: ['ev_diff1'],
          safety: 'manual-review'
        }
      },
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy
    })

    expect(result.admittedFinding?.title).not.toContain('sk-proj')
    expect(result.admittedFinding?.description).not.toContain(
      'very-secret-token-value'
    )
    expect(result.admittedFinding?.fixProposal?.summary).not.toContain('sk-proj')
    expect(JSON.stringify(result.admittedFinding)).toContain('[REDACTED]')
  })
})

describe('baseline and quality gate', () => {
  test('matches existing findings by fingerprint and reports missing configured baseline', () => {
    const admitted = admitCandidate({
      candidate,
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy
    }).admittedFinding!
    const baseline: BaselineFingerprintRecord[] = [
      {
        fingerprints: admitted.fingerprints
      }
    ]

    expect(
      matchBaselineFindings({
        admittedFindings: [admitted],
        baselineFingerprints: baseline,
        baselineConfigured: true
      }).admittedFindings[0]?.baselineStatus
    ).toBe('existing')

    const missingBaseline = matchBaselineFindings({
      admittedFindings: [admitted],
      baselineConfigured: true
    })
    expect(missingBaseline.warnings).toEqual(['baseline-missing'])
    // A configured-but-missing baseline yields indeterminate (`unknown`) status.
    expect(missingBaseline.admittedFindings[0]?.baselineStatus).toBe('unknown')
  })

  test('reports resolved baseline entries and fails gate on unknown findings', () => {
    const admitted = admitCandidate({
      candidate,
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy
    }).admittedFinding!
    const resolvedFingerprint = { algorithm: 'v1', value: 'resolvedonly' }

    const result = matchBaselineFindings({
      admittedFindings: [admitted],
      baselineFingerprints: [{ fingerprints: [resolvedFingerprint] }],
      baselineConfigured: true
    })
    expect(result.resolvedBaselineFingerprints).toEqual([resolvedFingerprint])
    expect(result.admittedFindings[0]?.baselineStatus).toBe('new')

    // `unknown` findings are treated as new for failOnNewOnly (fail-safe).
    const unknownFinding = { ...admitted, baselineStatus: 'unknown' as const }
    expect(
      evaluateQualityGate({
        admittedFindings: [unknownFinding],
        thresholds: { maxHigh: 0, failOnNewOnly: true }
      }).passed
    ).toBe(false)
  })

  test('quality gate considers admitted findings only and can fail on new only', () => {
    const admitted = admitCandidate({
      candidate,
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy
    }).admittedFinding!

    expect(
      evaluateQualityGate({
        admittedFindings: [admitted],
        thresholds: {
          maxHigh: 0,
          failOnNewOnly: true
        }
      })
    ).toMatchObject({
      passed: false,
      failingFindingIds: [admitted.id],
      baselineFilteringApplied: true
    })
  })
})
