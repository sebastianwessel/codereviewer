import { describe, expect, test } from 'vitest'
import { ReviewReportSchema } from './review-report.schema.js'

const sha256 = 'a'.repeat(64)

const validReport = {
  schemaVersion: '1.0',
  run: {
    runId: 'test-run',
    startedAt: '2026-06-20T00:00:00.000Z',
    completedAt: '2026-06-20T00:00:01.000Z',
    mode: 'local',
    depth: 'balanced',
    repositoryRootHash: sha256,
    configHash: sha256,
    durationMs: 1000,
    warnings: []
  },
  coverage: {
    status: 'complete',
    reviewableFileCount: 1,
    coveredFileCount: 1,
    reviewableBytes: 120,
    coveredBytes: 120,
    incompleteReasons: [],
    files: [
      {
        path: 'src/example.ts',
        contentHash: sha256,
        status: 'complete',
        bytes: 120,
        coveredBytes: 120,
        taskIds: ['task_abc123']
      }
    ]
  },
  admittedFindings: [
    {
      id: 'find_abc123',
      taskId: 'task_abc123',
      category: 'bug',
      severity: 'high',
      title: 'Incorrect null handling',
      description: 'The changed branch can throw before checking input.',
      location: {
        path: 'src/example.ts',
        startLine: 10,
        side: 'new'
      },
      evidenceIds: ['ev_abc123'],
      proposedBy: 'scripted-reviewer',
      fixProposal: {
        summary: 'Guard the nullable input before accessing it.',
        evidenceIds: ['ev_abc123'],
        safety: 'manual-review'
      },
      admissionStatus: 'admitted',
      admittedAt: '2026-06-20T00:00:01.000Z',
      admissionEvidenceIds: ['ev_abc123'],
      reporterEligibility: 'inline',
      provenance: {
        reviewer: 'scripted-reviewer',
        instructionHashes: [sha256],
        skillHashes: [],
        analyzerVersions: {
          typescript: 'test'
        },
        configHash: sha256
      },
      baselineStatus: 'new',
      fingerprints: [
        {
          algorithm: 'v1-rule-path-location-title',
          value: 'abc123'
        }
      ]
    }
  ],
  rejectedFindings: [
    {
      candidateId: 'cand_abc123',
      status: 'rejected',
      reason: 'insufficient-evidence',
      message: 'Candidate had only model rationale.'
    }
  ],
  evidence: [
    {
      id: 'ev_abc123',
      kind: 'diagnostic',
      summary: 'Type checker reported a nullable access.',
      location: {
        path: 'src/example.ts',
        startLine: 10,
        side: 'new'
      },
      source: 'typescript',
      redactionApplied: false
    }
  ],
  skippedFiles: [
    {
      path: 'dist/generated.js',
      reason: 'excluded'
    }
  ],
  qualityGate: {
    passed: false,
    failingFindingIds: ['find_abc123'],
    thresholds: {
      maxHigh: 0,
      failOnNewOnly: true
    },
    baselineFilteringApplied: true
  },
  artifacts: [
    {
      format: 'json',
      path: 'report.json',
      sha256,
      containsSensitiveContent: false
    }
  ]
}

describe('ReviewReportSchema', () => {
  test('accepts a valid review report fixture', () => {
    expect(ReviewReportSchema.parse(validReport).schemaVersion).toBe('1.0')
  })

  test('rejects missing required fields', () => {
    const invalid = { ...validReport, artifacts: undefined }
    expect(() => ReviewReportSchema.parse(invalid)).toThrow()
  })

  test('rejects invalid paths and enum values', () => {
    expect(() =>
      ReviewReportSchema.parse({
        ...validReport,
        admittedFindings: [
          {
            ...validReport.admittedFindings[0],
            severity: 'urgent'
          }
        ]
      })
    ).toThrow()

    expect(() =>
      ReviewReportSchema.parse({
        ...validReport,
        evidence: [
          {
            ...validReport.evidence[0],
            location: {
              path: '../outside.ts',
              startLine: 1,
              side: 'new'
            }
          }
        ]
      })
    ).toThrow()
  })

  test('rejects sensitive artifact markers', () => {
    expect(() =>
      ReviewReportSchema.parse({
        ...validReport,
        artifacts: [
          {
            ...validReport.artifacts[0],
            containsSensitiveContent: true
          }
        ]
      })
    ).toThrow()
  })

  test('rejects fix proposals without evidence or with apply semantics', () => {
    expect(() =>
      ReviewReportSchema.parse({
        ...validReport,
        admittedFindings: [
          {
            ...validReport.admittedFindings[0],
            fixProposal: {
              summary: 'Apply this patch automatically.',
              evidenceIds: [],
              safety: 'manual-review'
            }
          }
        ]
      })
    ).toThrow()

    expect(() =>
      ReviewReportSchema.parse({
        ...validReport,
        admittedFindings: [
          {
            ...validReport.admittedFindings[0],
            fixProposal: {
              summary: 'Apply this patch automatically.',
              evidenceIds: ['ev_abc123'],
              safety: 'auto-apply'
            }
          }
        ]
      })
    ).toThrow()
  })
})
