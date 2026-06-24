import type { ReviewReport } from '../../shared/contracts/index.js'
import { ReviewReportSchema } from '../../shared/contracts/index.js'

const hash = '1'.repeat(64)
const contentHash = '2'.repeat(64)

export const createReportFixture = (): ReviewReport =>
  ReviewReportSchema.parse({
    schemaVersion: '1.0',
    run: {
      runId: 'test-run',
      startedAt: '2026-06-20T00:00:00.000Z',
      completedAt: '2026-06-20T00:00:01.000Z',
      mode: 'ci',
      depth: 'balanced',
      repositoryRootHash: hash,
      baseRef: 'main',
      headRef: 'HEAD',
      configHash: hash,
      provider: 'openai',
      model: 'gpt-5-mini',
      durationMs: 1000,
      warnings: []
    },
    coverage: {
      status: 'complete',
      reviewableFileCount: 1,
      coveredFileCount: 1,
      reviewableBytes: 160,
      coveredBytes: 160,
      incompleteReasons: [],
      files: [
        {
          path: 'src/app.ts',
          contentHash,
          status: 'complete',
          bytes: 160,
          coveredBytes: 160,
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
        title: 'Incorrect return branch',
        description: 'The changed branch can return an incorrect value.',
        location: {
          path: 'src/app.ts',
          startLine: 4,
          side: 'new'
        },
        evidenceIds: ['ev_diff1'],
        proposedBy: 'review-agent',
        fixProposal: {
          summary: 'Return the computed value from the changed branch.',
          evidenceIds: ['ev_diff1'],
          safety: 'manual-review',
          edits: [
            {
              path: 'src/app.ts',
              startLine: 4,
              endLine: 4,
              replacement: 'return computedValue',
              description: 'Replace the incorrect return value.'
            }
          ]
        },
        admissionStatus: 'admitted',
        admittedAt: '2026-06-20T00:00:00.000Z',
        admissionEvidenceIds: ['ev_diff1'],
        reporterEligibility: 'inline',
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'gpt-5-mini',
          instructionHashes: [],
          skillHashes: [],
          signalVersions: {
            typescript: '6.0.3'
          },
          configHash: hash
        },
        baselineStatus: 'new',
        fingerprints: [
          {
            algorithm: 'v1-category-rule-path-location-title-evidence',
            value: 'abc123'
          }
        ]
      }
    ],
    rejectedFindings: [
      {
        candidateId: 'cand_weak1',
        status: 'needs-more-evidence',
        reason: 'insufficient-evidence',
        message: 'Candidate requires evidence.',
        evidenceIds: ['ev_model1']
      }
    ],
    evidence: [
      {
        id: 'ev_diff1',
        kind: 'diff',
        summary: 'Changed branch can return an incorrect value.',
        location: {
          path: 'src/app.ts',
          startLine: 4,
          side: 'new'
        },
        source: 'typescript-support-signal',
        contentHash,
        redactionApplied: true
      }
    ],
    refutationResults: [],
    providerIssues: [],
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
        maxHigh: 0
      },
      baselineFilteringApplied: true
    },
    artifacts: []
  })
