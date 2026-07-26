import { describe, expect, test } from 'vitest'
import type {
  AdmittedFinding,
  EvidenceRecord,
  FindingProvenance,
  ReviewReport
} from '../../shared/contracts/index.js'
import { parseEvalCases } from './eval-fixture.schema.js'
import { evalJudgeCalibrationSet } from './eval-judge-calibration.js'
import { evalPlausibilityCalibrationSet } from './eval-plausibility-calibration.js'
import type {
  EvalCaseFileReader,
  EvalPlausibilityJudge,
  EvalPlausibilityJudgeInput,
  EvalPlausibilityJudgeResult
} from './eval-plausibility-judge.js'
import type { EvalSemanticJudge } from './eval-matcher.js'
import {
  renderEvalComparison,
  renderEvalRecallReport,
  renderEvalSummary,
  runEvaluation
} from './eval-runner.js'

// Hermetic judge: answers the committed calibration set exactly as a human
// labeled it (so the run reports a trustworthy judge) and accepts every pair the
// deterministic gates let through.
const acceptingJudge: EvalSemanticJudge = async (input) => {
  const calibrationPair = evalJudgeCalibrationSet.find(
    (pair) =>
      pair.expectedSummary === input.expectedSummary &&
      pair.findingTitle === input.findingTitle
  )

  return calibrationPair === undefined
    ? { match: true, reason: 'Both summaries describe the same defect.' }
    : { match: calibrationPair.expectedMatch, reason: 'Calibration pair.' }
}

const rejectingJudge: EvalSemanticJudge = async (input) => {
  const calibrationPair = evalJudgeCalibrationSet.find(
    (pair) =>
      pair.expectedSummary === input.expectedSummary &&
      pair.findingTitle === input.findingTitle
  )

  return calibrationPair === undefined
    ? { match: false, reason: 'The summaries describe different defects.' }
    : { match: calibrationPair.expectedMatch, reason: 'Calibration pair.' }
}

// A plausibility judge that answers its own committed calibration set correctly
// (so the run stays trustworthy) and defers every other finding to `decide`,
// which decides the finding-under-test. Records every input it was asked about.
const plausibilityJudgeDeciding = (
  decide: (input: EvalPlausibilityJudgeInput) => EvalPlausibilityJudgeResult,
  calls?: EvalPlausibilityJudgeInput[]
): EvalPlausibilityJudge => async (input) => {
  calls?.push(input)
  const calibrationPair = evalPlausibilityCalibrationSet.find(
    (pair) =>
      pair.findingTitle === input.findingTitle &&
      pair.findingDescription === input.findingDescription
  )

  return calibrationPair === undefined
    ? decide(input)
    : { plausible: calibrationPair.isGenuine, reason: 'Calibration pair.' }
}

const constantSourceReader: EvalCaseFileReader = async () =>
  'const value = compute()\n'

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
  fixProposal: {
    summary: 'Return the computed value from the changed branch.',
    evidenceIds: ['ev_eval1'],
    safety: 'manual-review'
  },
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
  rejectedFindings: reportOverrides.rejectedFindings ?? [],
  evidence: reportOverrides.evidence ?? [evidence],
  refutationResults: [],
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
  test('validates fixture samples and returns a deterministic eval report', async () => {
    const cases = parseEvalCases(inlineEvalCases)
    const result = await runEvaluation({
      cases,
      judge: acceptingJudge,
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
      judgeAgreement: 1,
      judgeTrustworthy: true,
      adjustedPrecisionTrustworthy: true
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

  test('preserves token usage and renders unavailable cost explicitly', async () => {
    const cases = parseEvalCases([inlineEvalCases[0]])
    const result = await runEvaluation({
      cases,
      judge: acceptingJudge,
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

  test('scores artifact-only findings separately from actionable eval metrics', async () => {
    const cases = parseEvalCases([inlineEvalCases[0]])
    const result = await runEvaluation({
      cases,
      judge: acceptingJudge,
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

  test('derives refutation metrics and surfaces refutation results in case reports', async () => {
    const cases = parseEvalCases([inlineEvalCases[0]])
    const result = await runEvaluation({
      cases,
      judge: acceptingJudge,
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
                rejectedFindings: [
                  {
                    candidateId: 'cand_rejected1',
                    status: 'rejected',
                    reason: 'refuted',
                    message: 'Refutation found a contradiction.'
                  }
                ],
                refutationResults: [
                  {
                    id: 'refute_eval1',
                    candidateId: 'cand_eval1',
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
                ]
              }
            )
          }
        }
      ],
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    // One expected finding matched, so the rejected finding is not an unmatched
    // false negative, and the single proved refutation matches the admitted
    // finding, so there is no refutation false positive.
    expect(result.report.metrics).toMatchObject({
      refutationFalseNegativeCount: 0,
      refutationFalsePositiveCount: 0
    })
    expect(result.report.caseResults[0]?.refutationResults).toEqual([
      {
        id: 'refute_eval1',
        candidateId: 'cand_eval1',
        verdict: 'proved'
      }
    ])
    expect(
      result.report.caseResults[0]?.agenticStages.find(
        (stage) => stage.stage === 'refutation'
      )
    ).toEqual({ stage: 'refutation', status: 'active', count: 1 })

    const summary = renderEvalSummary({ cases, report: result.report })
    expect(summary).toContain('## Agentic Stage Coverage')
    expect(summary).toContain('Refutation results:')
    expect(summary).toContain('- refute_eval1 candidate cand_eval1 verdict proved')
  })

  test('keeps artifact-only noise out of normal false-positive counts', async () => {
    const cases = parseEvalCases([inlineEvalCases[1]])
    const result = await runEvaluation({
      cases,
      judge: acceptingJudge,
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

  test('records malformed fixture, provider error, and incomplete coverage outcomes', async () => {
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
    const result = await runEvaluation({
      cases,
      judge: acceptingJudge,
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

  test('records selection metadata and grouped metrics for comparison', async () => {
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
    const result = await runEvaluation({
      cases,
      judge: acceptingJudge,
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
            // Semantic-only group: nothing declares a line to check, so the rate
            // is undefined rather than a vacuous 1.
            lineAccuracy: null
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
    expect(summary).toContain('| sourceProfile | benchmark-semantic | 1 | 100.0% | 100.0% | 100.0% | n/a (0 checked) | 0 |')
    expect(summary).toContain('| language | typescript | 2 | 100.0% | 100.0% | 100.0% | 100.0% (1 checked) | 0 |')
  })

  test('scores semantic-only paraphrases through the judge and records its reason', async () => {
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

    const rejected = await runEvaluation({
      cases,
      judge: rejectingJudge,
      outputs,
      generatedAt: '2026-06-20T00:00:02.000Z'
    })
    const judged = await runEvaluation({
      cases,
      outputs,
      generatedAt: '2026-06-20T00:00:02.000Z',
      judge: async (input) =>
        input.findingTitle === 'File handle stays open'
          ? {
              match: true,
              reason: 'Both findings describe the same leaked descriptor.'
            }
          : acceptingJudge(input)
    })

    expect(rejected.report.metrics.recall).toBe(0)
    expect(judged.report.metrics.recall).toBe(1)
    expect(judged.report.scoring).toEqual({
      judgeAgreement: 1,
      judgeTrustworthy: true,
      adjustedPrecisionTrustworthy: true
    })
    expect(judged.report.metrics.judgeAgreementPairCount).toBe(
      evalJudgeCalibrationSet.length
    )
    expect(judged.report.caseResults[0]?.matchedFindings).toEqual([
      {
        expectedIndex: 0,
        findingId: 'find_paraphrase1',
        semanticReason: 'Both findings describe the same leaked descriptor.',
        lineOverlaps: false,
        severityMatches: true
      }
    ])
  })

  test('counts only path-line expectations that declare a line toward line accuracy', async () => {
    // Only `path-line` expectations are scored for line overlap, so only they
    // may enter the denominator. A `path-semantic` expectation that still
    // carries a `lineRange` -- the shape every real-repository corpus finding
    // uses -- can never be credited, and counting it reported a rate of 0 that
    // read as failed line placement rather than an inapplicable metric.
    const expectedFinding = (
      overrides: Record<string, unknown>
    ): Record<string, unknown> => ({
      category: 'bug',
      severity: 'high',
      path: 'src/app.ts',
      semanticSummary: 'changed branch returns a stale total to its callers',
      ...overrides
    })
    const evalCase = (
      id: string,
      expected: Record<string, unknown>
    ): Record<string, unknown> => ({
      id,
      language: 'typescript',
      repositoryFixture: 'fixtures/typescript/positive',
      changedFiles: ['src/app.ts'],
      expectedFindings: [expectedFinding(expected)],
      expectedNoFindingZones: [],
      tags: ['line-accuracy']
    })
    const outputFor = (caseId: string, startLine: number) => {
      const slug = caseId.replace(/[^a-z0-9]/gu, '')

      return {
        caseId,
        changedLineCount: 10,
        diffHunkCount: 1,
        contextLedger: [],
        result: {
          status: 'ok' as const,
          reviewReport: reviewReport([
            admittedFinding({
              id: `find_${slug}`,
              title: 'Stale total returned',
              description: 'The changed branch returns a stale total.',
              location: { path: 'src/app.ts', startLine, side: 'new' },
              fingerprints: [{ algorithm: 'test', value: slug }]
            })
          ])
        }
      }
    }

    const corpusShapedCase = evalCase('path-semantic-with-line', {
      lineRange: [4, 4],
      matchMode: 'path-semantic'
    })

    // The corpus shape on its own: matched, but nothing about its line is
    // scored, so the metric is undefined rather than zero.
    const semanticOnlyCases = parseEvalCases([corpusShapedCase])
    const semanticOnlyRun = await runEvaluation({
      cases: semanticOnlyCases,
      judge: acceptingJudge,
      outputs: [outputFor('path-semantic-with-line', 90)],
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    expect(semanticOnlyRun.report.metrics.recall).toBe(1)
    expect(semanticOnlyRun.report.metrics.lineCheckCount).toBe(0)
    // A rate over an empty denominator is vacuously 1, and serialising that 1
    // into report.json reads as perfect placement to any consumer that does not
    // also read the count. Null cannot be misread.
    expect(semanticOnlyRun.report.metrics.lineAccuracy).toBeNull()
    expect(
      renderEvalSummary({
        cases: semanticOnlyCases,
        report: semanticOnlyRun.report
      })
    ).toContain('| Line accuracy | n/a (0 checked) |')

    const mixedRun = await runEvaluation({
      cases: parseEvalCases([
        corpusShapedCase,
        // Declares a line and is scored against it.
        evalCase('path-line-with-line', { lineRange: [4, 4] }),
        // Explicitly `path-line` but declares no line: `lineRulePasses` would
        // credit it unconditionally, so it must stay out of the denominator.
        evalCase('path-line-without-line', { matchMode: 'path-line' })
      ]),
      judge: acceptingJudge,
      outputs: [
        outputFor('path-semantic-with-line', 90),
        outputFor('path-line-with-line', 4),
        outputFor('path-line-without-line', 90)
      ],
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    expect(mixedRun.report.metrics.recall).toBe(1)
    expect(mixedRun.report.metrics.lineCheckCount).toBe(1)
    expect(mixedRun.report.metrics.lineAccuracy).toBe(1)
  })


  test('excludes inconclusive pairs from recall and precision and warns about them', async () => {
    const cases = parseEvalCases([inlineEvalCases[0]])
    const result = await runEvaluation({
      cases,
      judge: async (input) => {
        if (input.findingTitle === 'Incorrect return value') {
          throw new Error('judge provider exploded')
        }

        return acceptingJudge(input)
      },
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
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    // The undecided pair leaves BOTH denominators: it is neither a missed
    // expected finding nor a false positive.
    expect(result.report.metrics).toMatchObject({
      recall: 1,
      precision: 1,
      productRecall: 1,
      falsePositiveCount: 0,
      inconclusiveMatchCount: 1
    })
    expect(result.report.caseResults[0]).toMatchObject({
      matchedFindings: [],
      unmatchedExpectedIndexes: [],
      falsePositiveFindingIds: [],
      duplicateFindingIds: [],
      inconclusiveExpectedIndexes: [0],
      inconclusiveFindingIds: ['find_eval1'],
      inconclusiveMatches: [
        {
          expectedIndex: 0,
          findingId: 'find_eval1',
          code: 'provider_error'
        }
      ]
    })
    expect(result.report.caseResults[0]?.warnings).toContain(
      'eval-inconclusive-match:1'
    )
    expect(result.report.caseResults[0]?.providerIssues).toEqual([
      expect.objectContaining({
        code: 'provider_error',
        stage: 'eval_semantic_judge',
        recovered: false
      })
    ])

    const summary = renderEvalSummary({ cases, report: result.report })
    expect(summary).toContain('| Inconclusive matches | 1 |')
    expect(summary).toContain('Inconclusive judge decisions:')
    expect(summary).toContain(
      '- find_eval1 vs expected #0 high bug undecided (provider_error); excluded from recall and precision'
    )
  })

  test('fails loudly when a case with expected findings has no judge', async () => {
    const cases = parseEvalCases([inlineEvalCases[0]])

    await expect(
      runEvaluation({
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
        generatedAt: '2026-06-20T00:00:02.000Z'
      })
    ).rejects.toMatchObject({
      code: 'eval_semantic_judge_missing',
      category: 'config',
      exitCode: 2
    })
  })

  test('scores a negative-only fixture set offline without a judge', async () => {
    const cases = parseEvalCases([inlineEvalCases[1]])
    const result = await runEvaluation({
      cases,
      outputs: [
        {
          caseId: 'typescript-negative',
          changedLineCount: 10,
          diffHunkCount: 1,
          contextLedger: [],
          result: {
            status: 'ok',
            reviewReport: reviewReport([])
          }
        }
      ],
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    expect(result.report.regressionGate.passed).toBe(true)
    expect(result.report.scoring).toEqual({
      judgeTrustworthy: true,
      adjustedPrecisionTrustworthy: true
    })
    expect(result.report.metrics.judgeAgreementPairCount).toBe(0)
    expect(result.report.metrics.plausibilityJudgeAgreementPairCount).toBe(0)
    expect(result.report.metrics.adjustedPrecision).toBe(1)
  })

  test('marks a run untrustworthy when judge agreement is below the minimum', async () => {
    const cases = parseEvalCases([inlineEvalCases[1]])
    const result = await runEvaluation({
      cases,
      // Flips every near-miss calibration pair: the exact failure mode of a
      // vocabulary-overlap heuristic.
      judge: async (input) => {
        const calibrationPair = evalJudgeCalibrationSet.find(
          (pair) =>
            pair.expectedSummary === input.expectedSummary &&
            pair.findingTitle === input.findingTitle
        )

        return {
          match:
            calibrationPair !== undefined && calibrationPair.kind === 'near-miss'
              ? !calibrationPair.expectedMatch
              : (calibrationPair?.expectedMatch ?? true),
          reason: 'Decided from shared vocabulary.'
        }
      },
      outputs: [
        {
          caseId: 'typescript-negative',
          changedLineCount: 10,
          diffHunkCount: 1,
          contextLedger: [],
          result: {
            status: 'ok',
            reviewReport: reviewReport([])
          }
        }
      ],
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    expect(result.report.scoring.judgeTrustworthy).toBe(false)
    expect(result.report.scoring.judgeAgreement).toBeLessThan(0.9)

    const summary = renderEvalSummary({ cases, report: result.report })
    expect(summary).toContain('| Judge trustworthy | no |')
  })

  test('records expected finding details and renders per-expected recall report', async () => {
    const cases = parseEvalCases(inlineEvalCases)
    const hit = await runEvaluation({
      cases,
      judge: acceptingJudge,
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
    const miss = await runEvaluation({
      cases,
      judge: acceptingJudge,
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

  test('renders eval comparison selection status and mismatch warning before metrics', async () => {
    const cases = parseEvalCases(inlineEvalCases)
    const base = await runEvaluation({
      cases,
      judge: acceptingJudge,
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
    const head = await runEvaluation({
      cases: headCases,
      judge: acceptingJudge,
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
                    stage: 'refutation',
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
              stage: 'refutation',
              status: 'active',
              count: 2
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
    expect(comparison).toContain('| Refutation false negatives | 1 | 0 | -1 |')
    expect(comparison).toContain('| Refutation false positives | 0 | 2 | +2 |')
    expect(comparison).not.toContain('| Suspicion recall ')
    expect(comparison).not.toContain('| Proof recall ')
    expect(comparison).not.toContain('| Proof promotion precision ')
    expect(comparison).toContain('## Context Ledger Kind Deltas')
    expect(comparison).toContain('| file | 0 | 1 | +1 |')
    expect(comparison).toContain('| support-signal-output | 1 | 0 | -1 |')
    expect(comparison).toContain('| tool-result | 1 | 0 | -1 |')
    expect(comparison).toContain('## Agentic Stage Deltas')
    expect(comparison).toContain('| refutation | 1 | 2 | +1 |')
    expect(comparison).not.toContain('| intent-planning ')
    expect(comparison).not.toContain('| proof-packet ')
    expect(comparison).not.toContain('| judge ')
    expect(comparison).not.toContain('| aggregate-critic ')
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
      '| sourceProfile | project | 2 | 1 | 1 | 0 | -1 | 0 | 2 | +2 |'
    )
    expect(comparison).toContain(
      '| language | typescript | 2 | 1 | 1 | 0 | -1 | 0 | 2 | +2 |'
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

  test('scores the fix lane over real and false-positive findings and shows the fix stage', async () => {
    const cases = parseEvalCases([inlineEvalCases[0]])
    const noiseFinding = admittedFinding({
      id: 'find_noise1',
      title: 'Unused import statement',
      description: 'The imported symbol is never referenced in this module.',
      location: {
        path: 'src/app.ts',
        startLine: 50,
        side: 'new'
      },
      fingerprints: [{ algorithm: 'test', value: 'noise1' }]
    })
    const result = await runEvaluation({
      cases,
      judge: acceptingJudge,
      outputs: [
        {
          caseId: 'typescript-positive',
          changedLineCount: 50,
          diffHunkCount: 2,
          contextLedger: [],
          // The fix lane judged the matched finding real and produced an
          // apply-checked fix; it judged the unmatched noise finding a false
          // positive with no fix.
          fixOutcomes: [
            {
              findingId: 'find_eval1',
              findingJudgment: 'real',
              fixProduced: true,
              applyCheck: 'passed'
            },
            {
              findingId: 'find_noise1',
              findingJudgment: 'false-positive',
              fixProduced: false,
              applyCheck: 'not-attempted'
            }
          ],
          result: {
            status: 'ok',
            reviewReport: reviewReport([admittedFinding(), noiseFinding])
          }
        }
      ],
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    // find_eval1 is ground-truth real (matched), find_noise1 is ground-truth
    // false positive (unmatched, unique location).
    expect(result.report.caseResults[0]?.matchedFindings).toEqual([
      expect.objectContaining({ expectedIndex: 0, findingId: 'find_eval1' })
    ])
    expect(result.report.caseResults[0]?.falsePositiveFindingIds).toEqual([
      'find_noise1'
    ])

    expect(result.report.metrics).toMatchObject({
      // Both judgments agree with ground truth: 2/2.
      fixJudgmentAccuracy: 1,
      fixJudgedFindingCount: 2,
      // The single ground-truth false positive was caught: 1/1.
      fixFalsePositiveDetectionRate: 1,
      fixGroundTruthFalsePositiveCount: 1,
      // The single real finding received an apply-checked fix: 1/1.
      fixProduceRate: 1,
      fixRealFindingCount: 1,
      // One fix attempted (passed), none failed: 0/1.
      fixApplyFailureRate: 0,
      fixAttemptedCount: 1
    })

    expect(result.report.caseResults[0]?.fixOutcomes).toHaveLength(2)
    expect(
      result.report.caseResults[0]?.agenticStages.find(
        (stage) => stage.stage === 'fix'
      )
    ).toEqual({ stage: 'fix', status: 'active', count: 2 })

    const summary = renderEvalSummary({ cases, report: result.report })
    expect(summary).toContain('| Fix judgment accuracy | 100.0% (2 judged) |')
    expect(summary).toContain(
      '| Fix false-positive detection rate | 100.0% (1 false positives) |'
    )
    expect(summary).toContain('| Fix produce rate | 100.0% (1 real) |')
    expect(summary).toContain('| Fix apply failure rate | 0.0% (1 attempted) |')
    expect(summary).toContain('## Agentic Stage Coverage')
    expect(summary).toContain('| Case | Refutation | Fix | Provider recovery |')
  })

  test('joins security labels to the match result for per-mechanism and obvious/hard recall', async () => {
    // Four expected findings: three labelled security (two matched, one missed)
    // plus one non-security bug (matched). Path-line matching makes the joins
    // deterministic without depending on judge greediness.
    const cases = parseEvalCases([
      {
        id: 'security-labeled',
        language: 'typescript',
        repositoryFixture: 'fixtures/typescript/security',
        changedFiles: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
        expectedFindings: [
          {
            category: 'security',
            severity: 'high',
            path: 'src/a.ts',
            lineRange: [1, 1],
            semanticSummary: 'permission check uses AND where it must use OR',
            securityMechanism: 'authorization',
            contextDepth: 'local'
          },
          {
            category: 'security',
            severity: 'high',
            path: 'src/b.ts',
            lineRange: [1, 1],
            semanticSummary: 'query built by concatenating a caller value',
            securityMechanism: 'injection',
            contextDepth: 'local'
          },
          {
            category: 'security',
            severity: 'high',
            path: 'src/c.ts',
            lineRange: [1, 1],
            semanticSummary: 'fetches a caller-supplied url without host validation',
            securityMechanism: 'ssrf',
            contextDepth: 'cross-file'
          },
          {
            category: 'bug',
            severity: 'high',
            path: 'src/d.ts',
            lineRange: [1, 1],
            semanticSummary: 'off-by-one in the changed loop bound'
          }
        ],
        expectedNoFindingZones: [],
        tags: ['security']
      }
    ])
    const findingOnPath = (
      path: string,
      id: string,
      fingerprint: string
    ): AdmittedFinding =>
      admittedFinding({
        id,
        category: 'security',
        location: { path, startLine: 1, side: 'new' },
        fingerprints: [{ algorithm: 'test', value: fingerprint }]
      })
    const result = await runEvaluation({
      cases,
      judge: acceptingJudge,
      outputs: [
        {
          caseId: 'security-labeled',
          changedLineCount: 40,
          diffHunkCount: 4,
          contextLedger: [],
          result: {
            status: 'ok',
            // src/c.ts (the ssrf finding) is deliberately never reported.
            reviewReport: reviewReport([
              findingOnPath('src/a.ts', 'find_authz', 'authz'),
              findingOnPath('src/b.ts', 'find_injection', 'injection'),
              admittedFinding({
                id: 'find_bug',
                category: 'bug',
                location: { path: 'src/d.ts', startLine: 1, side: 'new' },
                fingerprints: [{ algorithm: 'test', value: 'bug' }]
              })
            ])
          }
        }
      ],
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    const metrics = result.report.metrics
    // The non-security bug is matched but never touches a security denominator:
    // security expected total is 3, not 4.
    expect(metrics.recallByTier.security).toBe(0.666667)
    expect(metrics.securityMechanismCounts.authorization).toEqual({
      expected: 1,
      matched: 1
    })
    expect(metrics.securityMechanismCounts.injection).toEqual({
      expected: 1,
      matched: 1
    })
    expect(metrics.securityMechanismCounts.ssrf).toEqual({
      expected: 1,
      matched: 0
    })
    expect(metrics.securityRecallByMechanism.authorization).toBe(1)
    expect(metrics.securityRecallByMechanism.injection).toBe(1)
    expect(metrics.securityRecallByMechanism.ssrf).toBe(0)
    // Two local (both matched) obvious; one cross-file (missed) hard.
    expect(metrics.securityObviousRecall).toBe(1)
    expect(metrics.securityObviousCount).toBe(2)
    expect(metrics.securityHardRecall).toBe(0)
    expect(metrics.securityHardCount).toBe(1)
    expect(metrics.securityContextDepthCounts.local).toEqual({
      expected: 2,
      matched: 2
    })
    expect(metrics.securityContextDepthCounts['cross-file']).toEqual({
      expected: 1,
      matched: 0
    })

    const summary = renderEvalSummary({ cases, report: result.report })
    expect(summary).toContain('## Security by Mechanism')
    expect(summary).toContain('| authorization | 100.0% | 1/1 |')
    expect(summary).toContain('| injection | 100.0% | 1/1 |')
    expect(summary).toContain('| ssrf | 0.0% | 0/1 |')
    expect(summary).toContain('## Security by Context Depth')
    expect(summary).toContain('| local | 100.0% | 2/2 |')
    expect(summary).toContain('| cross-file | 0.0% | 0/1 |')
    expect(summary).toContain('| Security obvious recall | 100.0% (2 expected) |')
    expect(summary).toContain('| Security hard recall | 0.0% (1 expected) |')
  })

  test('fails the gate when product recall is below threshold', async () => {
    const cases = parseEvalCases([inlineEvalCases[0]])
    const result = await runEvaluation({
      cases,
      judge: acceptingJudge,
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

  // A matched finding plus one unmatched finding: raw precision 1/2 = 0.5.
  const positiveWithNoiseOutput = (
    noiseTitle: string,
    noiseDescription: string
  ) => ({
    caseId: 'typescript-positive' as const,
    changedLineCount: 50,
    diffHunkCount: 2,
    contextLedger: [],
    result: {
      status: 'ok' as const,
      reviewReport: reviewReport([
        admittedFinding(),
        admittedFinding({
          id: 'find_noise1',
          title: noiseTitle,
          description: noiseDescription,
          location: { path: 'src/app.ts', startLine: 40, side: 'new' },
          fingerprints: [{ algorithm: 'test', value: 'noise1' }]
        })
      ])
    }
  })

  test('reclassifies a plausible unmatched finding as unlisted-real and lifts adjusted precision', async () => {
    const cases = parseEvalCases([inlineEvalCases[0]])
    const calls: EvalPlausibilityJudgeInput[] = []
    const result = await runEvaluation({
      cases,
      judge: acceptingJudge,
      plausibilityJudge: plausibilityJudgeDeciding(
        () => ({ plausible: true, reason: 'A real bug the fixture omitted.' }),
        calls
      ),
      readFindingSource: constantSourceReader,
      outputs: [
        positiveWithNoiseOutput(
          'Unlisted genuine defect',
          'A genuine bug the fixture did not list as expected.'
        )
      ],
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    expect(result.report.metrics).toMatchObject({
      precision: 0.5,
      adjustedPrecision: 1,
      falsePositiveCount: 1,
      genuineFalsePositiveCount: 0,
      unlistedRealFindingCount: 1
    })
    expect(result.report.metrics.adjustedPrecision).toBeGreaterThan(
      result.report.metrics.precision
    )
    expect(result.report.caseResults[0]).toMatchObject({
      falsePositiveFindingIds: ['find_noise1'],
      unlistedRealFindingIds: ['find_noise1'],
      genuineFalsePositiveFindingIds: []
    })
    // The matched finding is never sent to the plausibility judge; the unmatched
    // one is.
    expect(calls.some((call) => call.findingTitle === 'Unlisted genuine defect')).toBe(
      true
    )
    expect(calls.every((call) => call.findingTitle !== 'Incorrect return value')).toBe(
      true
    )
    expect(result.report.scoring.adjustedPrecisionTrustworthy).toBe(true)
    expect(result.report.metrics.plausibilityJudgeAgreement).toBe(1)

    const summary = renderEvalSummary({ cases, report: result.report })
    expect(summary).toContain('| Adjusted precision | 100.0% |')
    expect(summary).toContain('| Genuine false positives | 0 |')
    expect(summary).toContain('| Unlisted real findings | 1 |')
    expect(summary).toContain(
      'Real but unlisted findings (credited by plausibility judge):'
    )
  })

  test('keeps a spurious unmatched finding a genuine false positive with adjusted precision equal to raw precision', async () => {
    const cases = parseEvalCases([inlineEvalCases[0]])
    const result = await runEvaluation({
      cases,
      judge: acceptingJudge,
      plausibilityJudge: plausibilityJudgeDeciding(() => ({
        plausible: false,
        reason: 'The finding misreads the code.'
      })),
      readFindingSource: constantSourceReader,
      outputs: [
        positiveWithNoiseOutput(
          'Spurious style nit',
          'A taste preference not supported by the shown code.'
        )
      ],
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    expect(result.report.metrics).toMatchObject({
      precision: 0.5,
      adjustedPrecision: 0.5,
      genuineFalsePositiveCount: 1,
      unlistedRealFindingCount: 0
    })
    expect(result.report.caseResults[0]).toMatchObject({
      genuineFalsePositiveFindingIds: ['find_noise1'],
      unlistedRealFindingIds: []
    })
  })

  test('fails closed when the plausibility judge throws: genuine false positive plus warning, never credited as real', async () => {
    const cases = parseEvalCases([inlineEvalCases[0]])
    const result = await runEvaluation({
      cases,
      judge: acceptingJudge,
      // Throws only for the finding-under-test; calibration pairs still score, so
      // the plausibility calibration remains measurable.
      plausibilityJudge: plausibilityJudgeDeciding(() => {
        throw new Error('plausibility provider exploded')
      }),
      readFindingSource: constantSourceReader,
      outputs: [
        positiveWithNoiseOutput(
          'Undecidable finding',
          'A finding whose plausibility judge call fails.'
        )
      ],
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    expect(result.report.metrics).toMatchObject({
      precision: 0.5,
      adjustedPrecision: 0.5,
      genuineFalsePositiveCount: 1,
      unlistedRealFindingCount: 0
    })
    expect(result.report.caseResults[0]?.unlistedRealFindingIds).toEqual([])
    expect(result.report.caseResults[0]?.genuineFalsePositiveFindingIds).toEqual([
      'find_noise1'
    ])
    expect(result.report.caseResults[0]?.warnings).toContain(
      'eval-plausibility-fail-closed:1'
    )
    expect(result.report.caseResults[0]?.providerIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: 'eval_plausibility_judge',
          recovered: false
        })
      ])
    )
  })

})
