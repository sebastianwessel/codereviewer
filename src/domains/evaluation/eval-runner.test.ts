import { describe, expect, test } from 'vitest'
import type {
  AdmittedFinding,
  EvidenceRecord,
  FindingProvenance,
  ReviewReport
} from '../../shared/contracts/index.js'
import { parseEvalCases } from './eval-fixture.schema.js'
import { renderEvalSummary, runEvaluation } from './eval-runner.js'

const inlineEvalCases = [
  {
    id: 'typescript-positive',
    language: 'typescript',
    repositoryFixture: 'fixtures/typescript/positive',
    baseRef: 'main',
    headRef: 'HEAD',
    changedFiles: ['src/app.ts'],
    expectedFindings: [
      {
        category: 'bug',
        severity: 'high',
        path: 'src/app.ts',
        lineRange: [4, 4],
        semanticSummary: 'incorrect return value from changed branch'
      }
    ],
    expectedNoFindingZones: [],
    tags: ['positive', 'typescript']
  },
  {
    id: 'typescript-negative',
    language: 'typescript',
    repositoryFixture: 'fixtures/typescript/negative',
    baseRef: 'main',
    headRef: 'HEAD',
    changedFiles: ['src/format.ts'],
    expectedFindings: [],
    expectedNoFindingZones: [
      {
        path: 'src/format.ts',
        lineRange: [1, 20],
        reason: 'Formatting-only changes must not produce review findings.'
      }
    ],
    tags: ['negative', 'typescript']
  }
]

const hash =
  '1111111111111111111111111111111111111111111111111111111111111111'

const provenance: FindingProvenance = {
  reviewer: 'scripted-reviewer',
  instructionHashes: [],
  skillHashes: [],
  analyzerVersions: {},
  configHash: hash
}

const evidence: EvidenceRecord = {
  id: 'ev_eval1',
  kind: 'diff',
  summary: 'Changed branch can return an incorrect value.',
  location: {
    path: 'src/app.ts',
    startLine: 4,
    side: 'new'
  },
  source: 'scripted-fixture',
  redactionApplied: true
}

const admittedFinding = (
  overrides: Partial<AdmittedFinding> = {}
): AdmittedFinding => ({
  id: 'find_eval1',
  taskId: 'task_eval1',
  category: 'bug',
  severity: 'high',
  title: 'Incorrect return value',
  description: 'The changed branch can return an incorrect value for callers.',
  location: {
    path: 'src/app.ts',
    startLine: 4,
    side: 'new'
  },
  evidenceIds: ['ev_eval1'],
  proposedBy: 'scripted-reviewer',
  suggestedFix: 'Return the computed value from the changed branch.',
  admissionStatus: 'admitted',
  admittedAt: '2026-06-20T00:00:00.000Z',
  admissionEvidenceIds: ['ev_eval1'],
  reporterEligibility: 'inline',
  provenance,
  baselineStatus: 'new',
  fingerprints: [
    {
      algorithm: 'test',
      value: 'eval1'
    }
  ],
  ...overrides
})

const reviewReport = (
  admittedFindings: readonly AdmittedFinding[],
  warnings: readonly string[] = [],
  coverageStatus: 'complete' | 'incomplete' = 'complete'
): ReviewReport => ({
  schemaVersion: '1.0',
  run: {
    runId: 'run-eval',
    startedAt: '2026-06-20T00:00:00.000Z',
    completedAt: '2026-06-20T00:00:01.000Z',
    mode: 'ci',
    depth: 'balanced',
    repositoryRootHash: hash,
    configHash: hash,
    durationMs: 1000,
    costUsd: 0.1,
    warnings: [...warnings]
  },
  coverage: {
    status: coverageStatus,
    reviewableFileCount: 1,
    coveredFileCount: coverageStatus === 'complete' ? 1 : 0,
    reviewableBytes: 100,
    coveredBytes: coverageStatus === 'complete' ? 100 : 50,
    incompleteReasons:
      coverageStatus === 'complete' ? [] : ['src/app.ts: only half covered'],
    files: [
      {
        path: 'src/app.ts',
        contentHash: hash,
        status: coverageStatus,
        bytes: 100,
        coveredBytes: coverageStatus === 'complete' ? 100 : 50,
        taskIds: ['task_eval1'],
        ...(coverageStatus === 'complete'
          ? {}
          : { incompleteReason: 'only half covered' })
      }
    ]
  },
  admittedFindings: [...admittedFindings],
  rejectedFindings: [],
  evidence: [evidence],
  artifacts: [],
  skippedFiles: [],
  qualityGate: {
    passed: true,
    failingFindingIds: [],
    thresholds: {
      maxCritical: 0,
      maxHigh: 1
    }
  }
})

describe('eval runner', () => {
  test('validates fixture samples and returns a deterministic eval report', () => {
    const cases = parseEvalCases(inlineEvalCases)
    const result = runEvaluation({
      cases,
      outputs: [
        {
          caseId: 'typescript-positive',
          changedLineCount: 50,
          diffHunkCount: 2,
          contextLedger: [
            {
              consideredForModelContext: true,
              truncated: false
            }
          ],
          result: {
            status: 'ok',
            reviewReport: reviewReport([admittedFinding()])
          }
        },
        {
          caseId: 'typescript-negative',
          changedLineCount: 10,
          diffHunkCount: 1,
          contextLedger: [],
          result: {
            status: 'ok',
            reviewReport: reviewReport([
              admittedFinding({
                id: 'find_noise1',
                title: 'Style-only note',
                description: 'This comment should not be emitted for formatting.',
                location: {
                  path: 'src/format.ts',
                  startLine: 3,
                  side: 'new'
                },
                fingerprints: [
                  {
                    algorithm: 'test',
                    value: 'noise1'
                  }
                ]
              })
            ])
          }
        }
      ],
      thresholds: {
        minParseValidity: 1,
        minRecall: 1,
        maxFalsePositiveCount: 0,
        failOnProviderError: true
      },
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    expect(result.artifactName).toBe('eval-report.json')
    expect(result.report).toMatchSnapshot()
    expect(result.report.regressionGate).toMatchObject({
      passed: false,
      reasons: ['falsePositiveCount above threshold: 1 > 0'],
      failingCaseIds: ['typescript-negative']
    })

    expect(renderEvalSummary({ cases, report: result.report })).toMatchSnapshot()
  })

  test('records malformed fixture, provider error, and incomplete coverage outcomes', () => {
    expect(() =>
      parseEvalCases([
        {
          id: 'invalid',
          language: 'typescript',
          repositoryFixture: '/absolute/path',
          changedFiles: [],
          expectedFindings: [],
          tags: []
        }
      ])
    ).toThrow()

    const cases = parseEvalCases(inlineEvalCases)
    const result = runEvaluation({
      cases,
      outputs: [
        {
          caseId: 'typescript-positive',
          changedLineCount: 10,
          diffHunkCount: 1,
          contextLedger: [
            {
              consideredForModelContext: true,
              truncated: true
            }
          ],
          result: {
            status: 'ok',
            reviewReport: reviewReport([admittedFinding()], [], 'incomplete')
          }
        },
        {
          caseId: 'typescript-negative',
          changedLineCount: 10,
          diffHunkCount: 1,
          contextLedger: [],
          result: {
            status: 'provider-error',
            code: 'provider_timeout',
            message: 'Provider operation timed out.'
          }
        }
      ],
      thresholds: {
        failOnProviderError: true,
        maxIncompleteCoverageRate: 0,
        maxContextMutationRate: 0
      },
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    expect(result.report.metrics).toMatchObject({
      parseValidity: 0.5,
      providerErrorRate: 0.5,
      incompleteCoverageRate: 0.5,
      contextMutationRate: 1
    })
    expect(result.report.regressionGate.passed).toBe(false)
    expect(result.report.regressionGate.reasons).toEqual([
      'provider error present',
      'incompleteCoverageRate above threshold: 0.5 > 0',
      'contextMutationRate above threshold: 1 > 0'
    ])
  })
})
