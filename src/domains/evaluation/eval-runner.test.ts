import { describe, expect, test } from 'vitest'
import type {
  AdmittedFinding,
  EvidenceRecord,
  FindingProvenance,
  ReviewReport
} from '../../shared/contracts/index.js'
import { parseEvalCases } from './eval-fixture.schema.js'
import {
  renderEvalComparison,
  renderEvalRecallReport,
  renderEvalSummary,
  runEvaluation,
  runEvaluationWithSemanticJudge
} from './eval-runner.js'

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
  signalVersions: {},
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
  coverageStatus: 'complete' | 'incomplete' = 'complete',
  runOverrides: Partial<ReviewReport['run']> = {},
  reportOverrides: Partial<ReviewReport> = {}
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
    warnings: [...warnings],
    ...runOverrides
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
  evidence: reportOverrides.evidence ?? [evidence],
  reviewIntents: [],
  modelSuspicions: [],
  modelTaskDiagnostics: reportOverrides.modelTaskDiagnostics ?? [],
  investigationTraces: [],
  proofPackets: [],
  refutationResults: [],
  aggregateResults: [],
  judgeResults: [],
  promotionDecisions: [],
  providerIssues: [],
  artifacts: [],
  skippedFiles: [],
  qualityGate: {
    passed: true,
    failingFindingIds: [],
    thresholds: {
      maxCritical: 0,
      maxHigh: 1
    }
  },
  ...reportOverrides
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
              kind: 'tool-result',
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
    expect(result.report.scoring).toEqual({
      semanticMatcher: 'deterministic'
    })
    expect(result.report.caseResults[0]?.contextLedger).toEqual([
      {
        kind: 'tool-result',
        consideredForModelContext: true,
        truncated: false
      }
    ])
    expect(result.report).toMatchSnapshot()
    expect(result.report.regressionGate).toMatchObject({
      passed: false,
      reasons: ['falsePositiveCount above threshold: 1 > 0'],
      failingCaseIds: ['typescript-negative']
    })

    expect(renderEvalSummary({ cases, report: result.report })).toMatchSnapshot()
  })

  test('preserves token usage and renders unavailable cost explicitly', () => {
    const cases = parseEvalCases([inlineEvalCases[0]])
    const result = runEvaluation({
      cases,
      outputs: [
        {
          caseId: 'typescript-positive',
          changedLineCount: 50,
          diffHunkCount: 2,
          contextLedger: [],
          result: {
            status: 'ok',
            reviewReport: reviewReport(
              [admittedFinding()],
              ['cost-unavailable'],
              'complete',
              {
                inputTokens: 12,
                outputTokens: 8,
                costUsd: undefined
              }
            )
          }
        }
      ],
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    expect(result.report.metrics).toMatchObject({
      inputTokens: 12,
      outputTokens: 8,
      costUnavailableCount: 1,
      costUsd: 0
    })
    expect(result.report.caseResults[0]).toMatchObject({
      inputTokens: 12,
      outputTokens: 8,
      costUnavailable: true,
      costUsd: 0
    })

    const summary = renderEvalSummary({ cases, report: result.report })
    expect(summary).toContain('| Input tokens | 12 |')
    expect(summary).toContain('| Output tokens | 8 |')
    expect(summary).toContain('| Cost | $0.00 known; unavailable for 1 case(s) |')
  })

  test('scores artifact-only findings separately from actionable eval metrics', () => {
    const cases = parseEvalCases([inlineEvalCases[0]])
    const result = runEvaluation({
      cases,
      outputs: [
        {
          caseId: 'typescript-positive',
          changedLineCount: 50,
          diffHunkCount: 2,
          contextLedger: [],
          result: {
            status: 'ok',
            reviewReport: reviewReport([
              admittedFinding({
                reporterEligibility: 'artifact-only'
              })
            ])
          }
        }
      ],
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    expect(result.report.metrics).toMatchObject({
      recall: 0,
      precision: 1,
      falsePositiveCount: 0,
      artifactOnlyRecall: 1,
      artifactOnlyPrecision: 1,
      artifactOnlyFindingCount: 1,
      artifactOnlyMatchedFindingCount: 1,
      artifactOnlyFalsePositiveCount: 0
    })
    expect(result.report.caseResults[0]).toMatchObject({
      matchedFindings: [],
      unmatchedExpectedIndexes: [0],
      falsePositiveFindingIds: [],
      artifactOnlyFindingIds: ['find_eval1'],
      artifactOnlyMatchedFindings: [
        {
          expectedIndex: 0,
          findingId: 'find_eval1'
        }
      ],
      artifactOnlyFalsePositiveFindingIds: []
    })

    const summary = renderEvalSummary({ cases, report: result.report })
    expect(summary).toContain('| Artifact-only recall | 100.0% |')
    expect(summary).toContain('| Artifact-only findings | 1 |')
    expect(summary).toContain('Artifact-only matched findings:')
    expect(summary).toContain(
      '- find_eval1 matched expected #0 high bug'
    )
  })

  test('reports proof quality metrics and proof-loop case summaries', () => {
    const cases = parseEvalCases([inlineEvalCases[0]])
    const result = runEvaluation({
      cases,
      outputs: [
        {
          caseId: 'typescript-positive',
          changedLineCount: 50,
          diffHunkCount: 2,
          contextLedger: [],
          result: {
            status: 'ok',
            reviewReport: reviewReport(
              [admittedFinding()],
              [],
              'complete',
              {},
              {
                evidence: [
                  evidence,
                  {
                    id: 'ev_toolread1',
                    kind: 'tool-read',
                    summary: 'Mediated context read for proof.',
                    location: {
                      path: 'src/app.ts',
                      startLine: 4,
                      side: 'file'
                    },
                    source: 'context-retrieval',
                    redactionApplied: true
                  }
                ],
                reviewIntents: [
                  {
                    id: 'intent_eval1',
                    title: 'Verify changed branch',
                    objective: 'Verify the changed branch end to end.',
                    taskIds: ['task_eval1'],
                    paths: ['src/app.ts'],
                    focusAreas: ['changed branch'],
                    riskAreas: ['incorrect return value'],
                    verificationQuestions: [
                      'Does the changed branch return the expected value?'
                    ],
                    source: 'model'
                  }
                ],
                modelSuspicions: [
                  {
                    id: 'susp_eval1',
                    taskId: 'task_eval1',
                    category: 'bug',
                    severityHint: 'high',
                    title: 'Incorrect return value',
                    hypothesis:
                      'The changed branch can return an incorrect value.',
                    primaryLocation: {
                      path: 'src/app.ts',
                      startLine: 4,
                      side: 'new'
                    },
                    contextRequests: [],
                    requestedContext: ['Inspect src/app.ts near line 4.'],
                    evidenceIds: ['ev_eval1'],
                    status: 'proved',
                    proposedBy: 'review-agent'
                  }
                ],
                proofPackets: [
                  {
                    id: 'proof_eval1',
                    suspicionId: 'susp_eval1',
                    candidateId: 'cand_eval1',
                    changedBehavior:
                      'The changed branch can return an incorrect value.',
                    executionOrDataPath: 'src/app.ts changed branch.',
                    violatedInvariant: 'Branch returns computed value.',
                    impact: 'Callers receive the wrong result.',
                    introducedByChange:
                      'The reviewed change introduced the return branch.',
                    evidenceIds: ['ev_eval1', 'ev_toolread1'],
                    contradictionChecks: ['No contradiction evidence cited.'],
                    fixDirection: 'Return the computed value.'
                  }
                ],
                refutationResults: [
                  {
                    id: 'refute_eval1',
                    proofPacketId: 'proof_eval1',
                    verdict: 'proved',
                    summary: 'Refutation check found no contradiction.',
                    evidenceIds: ['ev_eval1'],
                    checks: [
                      {
                        kind: 'task-evidence',
                        result: 'passed',
                        summary: 'Evidence exists.',
                        evidenceIds: ['ev_eval1']
                      }
                    ]
                  }
                ],
                promotionDecisions: [
                  {
                    candidateId: 'cand_eval1',
                    proofPacketId: 'proof_eval1',
                    refutationId: 'refute_eval1',
                    status: 'actionable',
                    reason: 'Proof and refutation passed.',
                    policy: 'promotion-policy-v1'
                  }
                ],
                providerIssues: [
                  {
                    code: 'provider_timeout',
                    stage: 'refutation-check',
                    recovered: true,
                    message: 'Refutation check timed out once and recovered.'
                  }
                ]
              }
            )
          }
        }
      ],
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    expect(result.report.metrics).toMatchObject({
      suspicionRecall: 1,
      proofRecall: 1,
      proofPromotionPrecision: 1,
      refutationFalseNegativeCount: 0,
      refutationFalsePositiveCount: 0,
      investigationToolReadCount: 1,
      providerIssueCount: 1
    })
    expect(result.report.caseResults[0]).toMatchObject({
      agenticStages: [
        {
          stage: 'intent-planning',
          status: 'active',
          count: 1
        },
        {
          stage: 'suspicion-generation',
          status: 'active',
          count: 1
        },
        {
          stage: 'suspicion-investigation',
          status: 'skipped',
          count: 0
        },
        {
          stage: 'proof-packet',
          status: 'active',
          count: 1
        },
        {
          stage: 'refutation',
          status: 'active',
          count: 1
        },
        {
          stage: 'aggregate-critic',
          status: 'skipped',
          count: 0
        },
        {
          stage: 'judge',
          status: 'skipped',
          count: 0
        },
        {
          stage: 'provider-recovery',
          status: 'recovered',
          count: 1
        }
      ],
      modelSuspicionIds: ['susp_eval1'],
      proofPackets: [
        {
          id: 'proof_eval1',
          suspicionId: 'susp_eval1',
          candidateId: 'cand_eval1',
          evidenceCount: 2,
          promotionStatus: 'actionable'
        }
      ],
      refutationResults: [
        {
          id: 'refute_eval1',
          proofPacketId: 'proof_eval1',
          verdict: 'proved'
        }
      ],
      promotionDecisions: [
        {
          candidateId: 'cand_eval1',
          proofPacketId: 'proof_eval1',
          refutationId: 'refute_eval1',
          status: 'actionable'
        }
      ],
      providerIssues: [
        {
          code: 'provider_timeout',
          stage: 'refutation-check',
          recovered: true,
          message: 'Refutation check timed out once and recovered.'
        }
      ]
    })

    const summary = renderEvalSummary({ cases, report: result.report })
    expect(summary).toContain('| Proof recall | 100.0% |')
    expect(summary).toContain('| Proof promotion precision | 100.0% |')
    expect(summary).toContain('| Investigation tool reads | 1 |')
    expect(summary).toContain(
      'recovered:provider_timeout@refutation-check - Refutation check timed out once and recovered.'
    )
    expect(summary).toContain('## Agentic Stage Coverage')
    expect(summary).toContain(
      '| typescript-positive | active 1 | active 1 | skipped 0 | active 1 | active 1 | skipped 0 | skipped 0 | recovered 1 |'
    )
  })

  test('reports model discovery attempts even when no suspicion survives selection', () => {
    const cases = parseEvalCases([inlineEvalCases[0]])
    const result = runEvaluation({
      cases,
      outputs: [
        {
          caseId: 'typescript-positive',
          changedLineCount: 50,
          diffHunkCount: 2,
          contextLedger: [],
          result: {
            status: 'ok',
            reviewReport: reviewReport(
              [],
              [],
              'complete',
              {
                provider: 'openai',
                model: 'gpt-5.3-codex'
              },
              {
                reviewIntents: [
                  {
                    id: 'intent_eval1',
                    title: 'Verify changed branch',
                    objective:
                      'Verify the changed branch and discover concrete issues.',
                    taskIds: ['task_eval1'],
                    paths: ['src/app.ts'],
                    focusAreas: ['changed branch'],
                    riskAreas: ['incorrect return value'],
                    verificationQuestions: [
                      'Does the changed branch return the expected value?'
                    ],
                    source: 'model'
                  }
                ],
                modelSuspicions: []
              }
            )
          }
        }
      ],
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    const caseResult = result.report.caseResults[0]
    expect(caseResult).toMatchObject({
      modelSuspicionIds: []
    })
    expect(
      caseResult?.agenticStages.find(
        (stage) => stage.stage === 'intent-planning'
      )
    ).toEqual({
      stage: 'intent-planning',
      status: 'active',
      count: 1
    })
    expect(
      caseResult?.agenticStages.find(
        (stage) => stage.stage === 'suspicion-generation'
      )
    ).toEqual({
      stage: 'suspicion-generation',
      status: 'active',
      count: 1
    })
    expect(result.report.metrics).toMatchObject({
      recall: 0,
      suspicionRecall: 0
    })
  })

  test('propagates model discovery diagnostics into eval case reports', () => {
    const cases = parseEvalCases([inlineEvalCases[0]])
    const result = runEvaluation({
      cases,
      outputs: [
        {
          caseId: 'typescript-positive',
          changedLineCount: 50,
          diffHunkCount: 2,
          contextLedger: [],
          result: {
            status: 'ok',
            reviewReport: reviewReport(
              [],
              [],
              'complete',
              {
                provider: 'openai',
                model: 'gpt-5.3-codex'
              },
              {
                modelTaskDiagnostics: [
                  {
                    taskId: 'task_eval1',
                    round: 1,
                    paths: ['src/app.ts'],
                    suggestionCount: 2,
                    selectedCandidateCount: 0,
                    modelSuspicionCount: 0,
                    proofPacketCount: 0,
                    droppedSuspicionReasons: {
                      'schema-invalid': 0,
                      'missing-required-field': 1,
                      'path-outside-task': 1,
                      'missing-task-evidence': 0,
                      'duplicate-input-candidate': 0,
                      'unsupported-truncation-claim': 0
                    }
                  }
                ]
              } as unknown as Partial<ReviewReport>
            )
          }
        }
      ],
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    expect(
      (
        result.report.caseResults[0] as {
          readonly modelTaskDiagnostics?: readonly unknown[]
        }
      ).modelTaskDiagnostics
    ).toEqual([
      expect.objectContaining({
        taskId: 'task_eval1',
        suggestionCount: 2,
        selectedCandidateCount: 0,
        droppedSuspicionReasons: expect.objectContaining({
          'missing-required-field': 1,
          'path-outside-task': 1
        })
      })
    ])
  })

  test('keeps artifact-only noise out of normal false-positive counts', () => {
    const cases = parseEvalCases([inlineEvalCases[1]])
    const result = runEvaluation({
      cases,
      outputs: [
        {
          caseId: 'typescript-negative',
          changedLineCount: 10,
          diffHunkCount: 1,
          contextLedger: [],
          result: {
            status: 'ok',
            reviewReport: reviewReport([
              admittedFinding({
                id: 'find_artifactnoise1',
                reporterEligibility: 'artifact-only',
                title: 'Uncertain style-only note',
                description: 'This uncertain comment should stay diagnostic.',
                location: {
                  path: 'src/format.ts',
                  startLine: 3,
                  side: 'new'
                },
                fingerprints: [
                  {
                    algorithm: 'test',
                    value: 'artifactnoise1'
                  }
                ]
              })
            ])
          }
        }
      ],
      thresholds: {
        maxFalsePositiveCount: 0,
        failOnProviderError: true
      },
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    expect(result.report.metrics).toMatchObject({
      falsePositiveCount: 0,
      noFindingZoneFalsePositiveCount: 0,
      artifactOnlyFalsePositiveCount: 1
    })
    expect(result.report.regressionGate).toMatchObject({
      passed: true,
      failingCaseIds: []
    })
    expect(result.report.caseResults[0]).toMatchObject({
      falsePositiveFindingIds: [],
      noFindingZoneFalsePositiveIds: [],
      artifactOnlyFalsePositiveFindingIds: ['find_artifactnoise1']
    })

    const summary = renderEvalSummary({ cases, report: result.report })
    expect(summary).toContain('Artifact-only findings:')
    expect(summary).toContain(
      '- find_artifactnoise1 high bug src/format.ts:3 - Uncertain style-only note'
    )
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
              kind: 'tool-result',
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

  test('records selection metadata and grouped metrics for comparison', () => {
    const cases = parseEvalCases([
      ...inlineEvalCases,
      {
        id: 'python-benchmark',
        language: 'python',
        repositoryFixture: 'fixtures/python/benchmark',
        changedFiles: ['src/service.py'],
        expectedFindings: [
          {
            category: 'bug',
            severity: 'medium',
            semanticSummary:
              'none returned without guard causes caller failure',
            matchMode: 'semantic-only'
          }
        ],
        expectedNoFindingZones: [],
        tags: ['benchmark', 'python'],
        sourceProfile: 'benchmark-semantic'
      }
    ])
    const result = runEvaluation({
      cases,
      outputs: [
        {
          caseId: 'typescript-positive',
          changedLineCount: 50,
          diffHunkCount: 2,
          contextLedger: [],
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
            reviewReport: reviewReport([])
          }
        },
        {
          caseId: 'python-benchmark',
          changedLineCount: 20,
          diffHunkCount: 1,
          contextLedger: [],
          result: {
            status: 'ok',
            reviewReport: reviewReport([
              admittedFinding({
                id: 'find_python1',
                category: 'bug',
                severity: 'medium',
                title: 'None returned without guard',
                description:
                  'None returned without guard causes caller failure.',
                location: {
                  path: 'src/service.py',
                  startLine: 12,
                  side: 'new'
                },
                fingerprints: [
                  {
                    algorithm: 'test',
                    value: 'python1'
                  }
                ]
              })
            ])
          }
        }
      ],
      selection: {
        fixtureSource: 'slice-root',
        sliceRoot: 'eval/benchmarks/crb',
        caseFilters: ['typescript-positive', 'python-benchmark'],
        selectedCaseIds: ['typescript-positive', 'typescript-negative', 'python-benchmark']
      },
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    expect(result.report.selection).toEqual({
      fixtureSource: 'slice-root',
      sliceRoot: 'eval/benchmarks/crb',
      caseFilters: ['typescript-positive', 'python-benchmark'],
      selectedCaseIds: ['typescript-positive', 'typescript-negative', 'python-benchmark']
    })
    expect(result.report.metricGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          groupBy: 'sourceProfile',
          key: 'project',
          fixtureCount: 2,
          caseIds: ['typescript-positive', 'typescript-negative'],
          metrics: expect.objectContaining({
            recall: 1,
            precision: 1,
            falsePositiveCount: 0
          })
        }),
        expect.objectContaining({
          groupBy: 'sourceProfile',
          key: 'benchmark-semantic',
          fixtureCount: 1,
          caseIds: ['python-benchmark'],
          metrics: expect.objectContaining({
            recall: 1,
            lineAccuracy: 1
          })
        }),
        expect.objectContaining({
          groupBy: 'language',
          key: 'typescript',
          fixtureCount: 2,
          caseIds: ['typescript-positive', 'typescript-negative']
        }),
        expect.objectContaining({
          groupBy: 'tag',
          key: 'benchmark',
          fixtureCount: 1,
          caseIds: ['python-benchmark']
        })
      ])
    )

    const summary = renderEvalSummary({ cases, report: result.report })
    expect(summary).toContain('## Selection')
    expect(summary).toContain('| Fixture source | slice-root |')
    expect(summary).toContain('| Slice root | eval/benchmarks/crb |')
    expect(summary).toContain('## Metric Groups')
    expect(summary).toContain('| sourceProfile | benchmark-semantic | 1 | 100.0% | 100.0% | 100.0% | 100.0% | 0 |')
    expect(summary).toContain('| language | typescript | 2 | 100.0% | 100.0% | 100.0% | 100.0% | 0 |')
  })

  test('uses semantic judge matches in eval reports without changing deterministic default', async () => {
    const cases = parseEvalCases([
      {
        id: 'semantic-benchmark',
        language: 'typescript',
        repositoryFixture: 'fixtures/typescript/semantic',
        changedFiles: ['src/app.ts'],
        expectedFindings: [
          {
            category: 'bug',
            severity: 'high',
            semanticSummary:
              'descriptor resource is leaked after the read path exits',
            matchMode: 'semantic-only'
          }
        ],
        expectedNoFindingZones: [],
        tags: ['benchmark'],
        sourceProfile: 'benchmark-semantic'
      }
    ])
    const outputs = [
      {
        caseId: 'semantic-benchmark',
        changedLineCount: 10,
        diffHunkCount: 1,
        contextLedger: [],
        result: {
          status: 'ok' as const,
          reviewReport: reviewReport([
            admittedFinding({
              id: 'find_paraphrase1',
              title: 'File handle stays open',
              description:
                'The code never closes the opened stream after reading.',
              location: {
                path: 'src/other.ts',
                startLine: 99,
                side: 'new'
              },
              fingerprints: [
                {
                  algorithm: 'test',
                  value: 'paraphrase1'
                }
              ]
            })
          ])
        }
      }
    ]

    const deterministic = runEvaluation({
      cases,
      outputs,
      generatedAt: '2026-06-20T00:00:02.000Z'
    })
    const judged = await runEvaluationWithSemanticJudge({
      cases,
      outputs,
      generatedAt: '2026-06-20T00:00:02.000Z',
      judge: async () => ({
        match: true,
        reason: 'Both findings describe the same leaked descriptor.'
      })
    })

    expect(deterministic.report.metrics.recall).toBe(0)
    expect(deterministic.report.scoring.semanticMatcher).toBe('deterministic')
    expect(judged.report.metrics.recall).toBe(1)
    expect(judged.report.scoring.semanticMatcher).toBe('semantic-judge')
    expect(judged.report.caseResults[0]?.matchedFindings).toEqual([
      {
        expectedIndex: 0,
        findingId: 'find_paraphrase1',
        semanticScore: 1,
        semanticReason: 'Both findings describe the same leaked descriptor.',
        lineOverlaps: false,
        severityMatches: true
      }
    ])
  })

  test('records expected finding details and renders per-expected recall report', () => {
    const cases = parseEvalCases(inlineEvalCases)
    const hit = runEvaluation({
      cases,
      outputs: [
        {
          caseId: 'typescript-positive',
          changedLineCount: 10,
          diffHunkCount: 1,
          contextLedger: [
            {
              kind: 'tool-result',
              consideredForModelContext: true,
              truncated: false
            }
          ],
          result: {
            status: 'ok',
            reviewReport: reviewReport([admittedFinding()], [], 'complete', {
              inputTokens: 30,
              outputTokens: 7
            })
          }
        },
        {
          caseId: 'typescript-negative',
          changedLineCount: 5,
          diffHunkCount: 1,
          contextLedger: [
            {
              kind: 'support-signal-output',
              consideredForModelContext: true,
              truncated: true
            }
          ],
          result: {
            status: 'ok',
            reviewReport: reviewReport([], [], 'complete', {
              inputTokens: 20,
              outputTokens: 3
            })
          }
        }
      ],
      generatedAt: '2026-06-20T00:00:02.000Z'
    })
    const miss = runEvaluation({
      cases,
      outputs: [
        {
          caseId: 'typescript-positive',
          changedLineCount: 10,
          diffHunkCount: 1,
          contextLedger: [],
          result: {
            status: 'ok',
            reviewReport: reviewReport([])
          }
        },
        {
          caseId: 'typescript-negative',
          changedLineCount: 5,
          diffHunkCount: 1,
          contextLedger: [],
          result: {
            status: 'ok',
            reviewReport: reviewReport([])
          }
        }
      ],
      generatedAt: '2026-06-20T00:00:03.000Z'
    })

    expect(hit.report.caseResults[0]?.expectedFindings).toEqual([
      {
        expectedIndex: 0,
        category: 'bug',
        severity: 'high',
        path: 'src/app.ts',
        lineRange: [4, 4],
        matchMode: 'path-line',
        semanticSummary: 'incorrect return value from changed branch'
      }
    ])

    const recallReport = renderEvalRecallReport({
      reports: [
        { label: 'hit', report: hit.report },
        { label: 'miss', report: miss.report }
      ]
    })

    expect(recallReport).toContain('# Evaluation Recall Report')
    expect(recallReport).toContain('Case set: same')
    expect(recallReport).toContain('| Expected findings | Always detected | Never detected | Flaky |')
    expect(recallReport).toContain('| 1 | 0 | 0 | 1 |')
    expect(recallReport).toContain('| typescript-positive | 0 | high | src/app.ts:4 | path-line | incorrect return value from changed branch | 1/2 | Y N |')
  })

  test('renders eval comparison selection status and mismatch warning before metrics', () => {
    const cases = parseEvalCases(inlineEvalCases)
    const base = runEvaluation({
      cases,
      outputs: [
        {
          caseId: 'typescript-positive',
          changedLineCount: 10,
          diffHunkCount: 1,
          contextLedger: [
            {
              kind: 'tool-result',
              consideredForModelContext: true,
              truncated: false
            }
          ],
          result: {
            status: 'ok',
            reviewReport: reviewReport([admittedFinding()], [], 'complete', {
              inputTokens: 30,
              outputTokens: 7
            })
          }
        },
        {
          caseId: 'typescript-negative',
          changedLineCount: 5,
          diffHunkCount: 1,
          contextLedger: [
            {
              kind: 'support-signal-output',
              consideredForModelContext: true,
              truncated: true
            }
          ],
          result: {
            status: 'ok',
            reviewReport: reviewReport([], [], 'complete', {
              inputTokens: 20,
              outputTokens: 3
            })
          }
        }
      ],
      generatedAt: '2026-06-20T00:00:02.000Z'
    })
    const headCases = parseEvalCases([inlineEvalCases[0]])
    const head = runEvaluation({
      cases: headCases,
      outputs: [
        {
          caseId: 'typescript-positive',
          changedLineCount: 10,
          diffHunkCount: 1,
          contextLedger: [
            {
              kind: 'file',
              consideredForModelContext: true,
              truncated: false
            }
          ],
          result: {
            status: 'ok',
            reviewReport: reviewReport(
              [admittedFinding()],
              ['cost-unavailable'],
              'complete',
              {
                inputTokens: 15,
                outputTokens: 5,
                costUsd: undefined
              }
            )
          }
        }
      ],
      generatedAt: '2026-06-20T00:00:03.000Z'
    })

    const comparison = renderEvalComparison({
      base: {
        ...base.report,
        metrics: {
          ...base.report.metrics,
          suspicionRecall: 0.5,
          proofRecall: 0.25,
          proofPromotionPrecision: 1,
          refutationFalseNegativeCount: 1,
          refutationFalsePositiveCount: 0
        },
        metricGroups: [
          {
            groupBy: 'sourceProfile',
            key: 'project',
            fixtureCount: 2,
            caseIds: ['typescript-positive', 'typescript-negative'],
            metrics: {
              ...base.report.metrics,
              recall: 0.5,
              precision: 1,
              f1: 0.667,
              suspicionRecall: 0.5,
              proofRecall: 0.25,
              proofPromotionPrecision: 1,
              refutationFalseNegativeCount: 1,
              refutationFalsePositiveCount: 0,
              falsePositiveCount: 0
            }
          },
          {
            groupBy: 'language',
            key: 'typescript',
            fixtureCount: 2,
            caseIds: ['typescript-positive', 'typescript-negative'],
            metrics: {
              ...base.report.metrics,
              recall: 0.5,
              precision: 1,
              f1: 0.667,
              suspicionRecall: 0.5,
              proofRecall: 0.25,
              proofPromotionPrecision: 1,
              refutationFalseNegativeCount: 1,
              refutationFalsePositiveCount: 0,
              falsePositiveCount: 0
            }
          }
        ],
        caseResults: base.report.caseResults.map((caseResult) =>
          caseResult.caseId === 'typescript-positive'
            ? {
                ...caseResult,
                agenticStages: [
                  {
                    stage: 'intent-planning',
                    status: 'active',
                    count: 1
                  },
                  {
                    stage: 'proof-packet',
                    status: 'active',
                    count: 1
                  }
                ]
              }
            : caseResult
        )
      },
      head: {
        ...head.report,
        metrics: {
          ...head.report.metrics,
          providerErrorRate: 0.5,
          providerIssueRate: 1,
          providerIssueCount: 1,
          suspicionRecall: 1,
          proofRecall: 0.75,
          proofPromotionPrecision: 0.5,
          refutationFalseNegativeCount: 0,
          refutationFalsePositiveCount: 2
        },
        metricGroups: [
          {
            groupBy: 'sourceProfile',
            key: 'project',
            fixtureCount: 1,
            caseIds: ['typescript-positive'],
            metrics: {
              ...head.report.metrics,
              recall: 1,
              precision: 0.5,
              f1: 0.667,
              suspicionRecall: 1,
              proofRecall: 0.75,
              proofPromotionPrecision: 0.5,
              refutationFalseNegativeCount: 0,
              refutationFalsePositiveCount: 2,
              falsePositiveCount: 1
            }
          },
          {
            groupBy: 'language',
            key: 'typescript',
            fixtureCount: 1,
            caseIds: ['typescript-positive'],
            metrics: {
              ...head.report.metrics,
              recall: 1,
              precision: 0.5,
              f1: 0.667,
              suspicionRecall: 1,
              proofRecall: 0.75,
              proofPromotionPrecision: 0.5,
              refutationFalseNegativeCount: 0,
              refutationFalsePositiveCount: 2,
              falsePositiveCount: 1
            }
          },
          {
            groupBy: 'language',
            key: 'python',
            fixtureCount: 1,
            caseIds: ['python-positive'],
            metrics: {
              ...head.report.metrics,
              recall: 1,
              precision: 1,
              f1: 1,
              falsePositiveCount: 0
            }
          }
        ],
        caseResults: head.report.caseResults.map((caseResult) => ({
          ...caseResult,
          agenticStages: [
            {
              stage: 'intent-planning',
              status: 'active',
              count: 2
            },
            {
              stage: 'judge',
              status: 'active',
              count: 1
            }
          ]
        }))
      },
      baseLabel: 'base',
      headLabel: 'head'
    })

    expect(comparison).toContain('## Selection')
    expect(comparison).toContain('| Case set | different |')
    expect(comparison).toContain('Warning: selected case sets differ; aggregate metric deltas are not same-dataset comparable.')
    expect(comparison).toContain('| Base-only cases | typescript-negative |')
    expect(comparison).toContain('| Input tokens | 50 | 15 | -35 |')
    expect(comparison).toContain('| Output tokens | 10 | 5 | -5 |')
    expect(comparison).toContain('| Cost | $0.2000 | $0.00 known; unavailable for 1 case(s) | -0.2 |')
    expect(comparison).toContain('| Cost unavailable cases | 0 | 1 | +1 |')
    expect(comparison).toContain('| Provider error rate | 0.0% | 50.0% | +50.0pp |')
    expect(comparison).toContain('| Provider issue rate | 0.0% | 100.0% | +100.0pp |')
    expect(comparison).toContain('| Provider issue cases | 0 | 1 | +1 |')
    expect(comparison).toContain('| Suspicion recall | 50.0% | 100.0% | +50.0pp |')
    expect(comparison).toContain('| Proof recall | 25.0% | 75.0% | +50.0pp |')
    expect(comparison).toContain('| Proof promotion precision | 100.0% | 50.0% | -50.0pp |')
    expect(comparison).toContain('| Refutation false negatives | 1 | 0 | -1 |')
    expect(comparison).toContain('| Refutation false positives | 0 | 2 | +2 |')
    expect(comparison).toContain('## Context Ledger Kind Deltas')
    expect(comparison).toContain('| file | 0 | 1 | +1 |')
    expect(comparison).toContain('| support-signal-output | 1 | 0 | -1 |')
    expect(comparison).toContain('| tool-result | 1 | 0 | -1 |')
    expect(comparison).toContain('## Agentic Stage Deltas')
    expect(comparison).toContain('| intent-planning | 1 | 2 | +1 |')
    expect(comparison).toContain('| judge | 0 | 1 | +1 |')
    expect(comparison).toContain('| proof-packet | 1 | 0 | -1 |')
    expect(comparison).not.toContain('| aggregate-critic | 0 | 0 | 0 |')
    expect(comparison).not.toContain('| provider-recovery | 0 | 0 | 0 |')
    expect(comparison).toContain('## Metric Group Deltas')
    expect(comparison).toContain(
      '| sourceProfile | project | 2 | 1 | 50.0% | 100.0% | +50.0pp | 100.0% | 50.0% | -50.0pp | 66.7% | 66.7% | 0.0pp | 0 | 1 | +1 |'
    )
    expect(comparison).toContain(
      '| language | typescript | 2 | 1 | 50.0% | 100.0% | +50.0pp | 100.0% | 50.0% | -50.0pp | 66.7% | 66.7% | 0.0pp | 0 | 1 | +1 |'
    )
    expect(comparison).toContain('## Metric Group Proof-Loop Deltas')
    expect(comparison).toContain(
      '| sourceProfile | project | 2 | 1 | 50.0% | 100.0% | +50.0pp | 25.0% | 75.0% | +50.0pp | 100.0% | 50.0% | -50.0pp | 1 | 0 | -1 | 0 | 2 | +2 |'
    )
    expect(comparison).toContain(
      '| language | typescript | 2 | 1 | 50.0% | 100.0% | +50.0pp | 25.0% | 75.0% | +50.0pp | 100.0% | 50.0% | -50.0pp | 1 | 0 | -1 | 0 | 2 | +2 |'
    )
    expect(comparison).toContain('## Metric Group Resource Deltas')
    expect(comparison).toContain(
      '| sourceProfile | project | 2 | 1 | 50 | 15 | -35 | 10 | 5 | -5 | $0.2000 | $0.00 known; unavailable for 1 case(s) | -0.2 | 0 | 1 | +1 |'
    )
    expect(comparison).toContain(
      '| language | typescript | 2 | 1 | 50 | 15 | -35 | 10 | 5 | -5 | $0.2000 | $0.00 known; unavailable for 1 case(s) | -0.2 | 0 | 1 | +1 |'
    )
    expect(comparison).toContain('## Metric Group Coverage Deltas')
    expect(comparison).toContain('| language | python | 0 | 1 | +1 | new |')
    expect(comparison).toContain('| language | typescript | 2 | 1 | -1 | changed |')
    expect(comparison).toContain('| sourceProfile | project | 2 | 1 | -1 | changed |')
    expect(comparison.indexOf('## Selection')).toBeLessThan(
      comparison.indexOf('## Metric Deltas')
    )
  })

  test('fails the gate when product recall is below threshold', () => {
    const cases = parseEvalCases([inlineEvalCases[0]])
    const result = runEvaluation({
      cases,
      outputs: [
        {
          caseId: 'typescript-positive',
          changedLineCount: 50,
          diffHunkCount: 2,
          contextLedger: [],
          // No admitted findings: the runtime-critical expected finding is missed.
          result: {
            status: 'ok',
            reviewReport: reviewReport([])
          }
        }
      ],
      thresholds: {
        minProductRecall: 0.8,
        failOnProviderError: true
      },
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    expect(result.report.metrics.productRecall).toBe(0)
    expect(result.report.regressionGate.passed).toBe(false)
    expect(result.report.regressionGate.reasons).toContain(
      'productRecall below threshold: 0 < 0.8'
    )
  })

  test('fails the gate when suspicion-stage coverage is below threshold', () => {
    const cases = parseEvalCases([inlineEvalCases[0]])
    const result = runEvaluation({
      cases,
      outputs: [
        {
          caseId: 'typescript-positive',
          changedLineCount: 50,
          diffHunkCount: 2,
          contextLedger: [],
          result: {
            status: 'ok',
            reviewReport: reviewReport([admittedFinding()])
          }
        }
      ],
      thresholds: {
        minSuspicionStageCoverage: 1,
        failOnProviderError: true
      },
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    expect(result.report.metrics.suspicionStageCoverage).toBe(0)
    expect(result.report.regressionGate.reasons).toContain(
      'suspicionStageCoverage below threshold: 0 < 1'
    )
  })

  test('only gates judge coverage when finding judging is enabled', () => {
    const cases = parseEvalCases([inlineEvalCases[0]])
    const output = {
      caseId: 'typescript-positive',
      changedLineCount: 50,
      diffHunkCount: 2,
      contextLedger: [],
      result: {
        status: 'ok' as const,
        // One actionable-promoted proof but no judged findings: coverage is 0.
        reviewReport: reviewReport([admittedFinding()], [], 'complete', {}, {
          promotionDecisions: [
            {
              candidateId: 'cand_eval1',
              proofPacketId: 'proof_eval1',
              status: 'actionable',
              reason: 'Proof artifacts admitted the candidate.',
              policy: 'eval-test'
            }
          ]
        })
      }
    }

    const withoutJudge = runEvaluation({
      cases,
      outputs: [output],
      thresholds: { minJudgeCoverage: 1, failOnProviderError: true },
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    expect(withoutJudge.report.regressionGate.reasons).not.toContain(
      'judgeCoverage below threshold: 0 < 1'
    )

    const withJudge = runEvaluation({
      cases,
      outputs: [output],
      thresholds: { minJudgeCoverage: 1, failOnProviderError: true },
      judgeFindingsEnabled: true,
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    expect(withJudge.report.metrics.judgeCoverage).toBe(0)
    expect(withJudge.report.regressionGate.reasons).toContain(
      'judgeCoverage below threshold: 0 < 1'
    )
  })
})
