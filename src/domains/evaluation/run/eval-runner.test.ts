import { describe, expect, test } from 'vitest'
import type {
  AdmittedFinding,
  EvidenceRecord,
  FindingProvenance,
  ReviewReport
} from '../../../shared/contracts/index.js'
import { parseEvalCases } from '../corpus/eval-fixture.schema.js'
import { type EvalReport } from '../report/eval-report-contracts.js'
import { evalJudgeCalibrationSet } from '../judging/eval-judge-calibration.js'
import { evalPlausibilityCalibrationSet } from '../judging/eval-plausibility-calibration.js'
import type {
  EvalCaseFileReader,
  EvalPlausibilityJudge,
  EvalPlausibilityJudgeInput,
  EvalPlausibilityJudgeResult
} from '../judging/eval-plausibility-judge.js'
import type { EvalSemanticJudge } from '../judging/eval-matcher.js'
import { renderEvalComparison } from '../rendering/comparison/eval-comparison-report-rendering.js'
import { renderEvalRecallReport } from '../rendering/eval-recall-report-rendering.js'
import { renderEvalSummary } from '../rendering/summary/eval-summary-report-rendering.js'
import { runEvaluation } from './eval-runner.js'

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
    excludedFileCount: 0,
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

// Widens a report literal to the producer contract before handing it to the
// comparison, which reads through the tolerant comparison view. Without this the
// literal is checked against the VIEW, which models only what comparison
// renders, and a real report field it does not model reads as an excess
// property.
const evalReportForComparison = (report: EvalReport): EvalReport => report

// One report as a single-run comparison arm. `eval compare` takes a SET of runs
// per arm, and a single-run arm is just the smallest one.
const comparisonArm = (report: EvalReport, label: string) => [
  { label, report }
]

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
      generatedAt: '2026-06-20T00:00:02.000Z',
      // A fixed thunk, not the real monotonic clock: this test snapshots the
      // whole report, and `elapsedMs` would otherwise vary run to run (it
      // measures genuine wall-clock time), making the snapshot flaky.
      evaluationElapsedMs: () => 42
    })

    expect(result.artifactName).toBe('eval-report.json')
    expect(result.report.scoring).toEqual({
      judgeAgreement: 1,
      judgeTrustworthy: true,
      adjustedPrecisionTrustworthy: true,
      // Recorded so the precision bracket can say "upper bound not measured"
      // instead of republishing the lower bound as if a judge had confirmed it.
      plausibilityJudged: false
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
      outcome: 'failed',
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
      costUnavailable: true
    })
    // Absent, not 0: the run reported tokens but no cost, so writing 0 would
    // state a measurement nobody took.
    expect(result.report.caseResults[0]).not.toHaveProperty('costUsd')

    const summary = renderEvalSummary({ cases, report: result.report })
    expect(summary).toContain('| Input tokens | 12 |')
    expect(summary).toContain('| Output tokens | 8 |')
    expect(summary).toContain(
      '| Review cost | $0.00 known; unavailable for 1 case(s) |'
    )
  })

  // The judge and plausibility judge make real provider calls (matching, plus
  // their own calibration passes), but until this test's underlying fix,
  // NOTHING read their `response.usage`, so that spend was counted nowhere and
  // every published cost figure understated the run's true provider spend.
  // `evaluationScoringCost` stands in for the CLI's usage-recorder-backed
  // thunk (see cli/index.ts), and this proves the run folds it into its OWN
  // metric rather than the review-only `costUsd`/`inputTokens`/`outputTokens`.
  test('reports judge/plausibility-judge spend as its own metric, separate from review cost', async () => {
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
            reviewReport: reviewReport([admittedFinding()])
          }
        }
      ],
      generatedAt: '2026-06-20T00:00:02.000Z',
      evaluationScoringCost: () => ({
        warnings: [],
        costUsd: 0.075,
        inputTokens: 900,
        outputTokens: 150,
        cachedInputTokens: 30
      })
    })

    // Judge spend is its own number...
    expect(result.report.metrics.scoringCostUsd).toBe(0.075)
    expect(result.report.metrics.scoringInputTokens).toBe(900)
    expect(result.report.metrics.scoringOutputTokens).toBe(150)
    expect(result.report.metrics.scoringCachedInputTokens).toBe(30)
    expect(result.report.metrics.scoringCostUnavailable).toBe(false)
    // ...that never leaks into the review-only figures, which come solely
    // from the case's review report (costUsd 0.1, inputTokens/outputTokens 0
    // per the shared `reviewReport` fixture default).
    expect(result.report.metrics.costUsd).toBe(0.1)
    expect(result.report.metrics.inputTokens).toBe(0)
    expect(result.report.metrics.outputTokens).toBe(0)

    // Repeated on every metric group, exactly like judge reliability: one run
    // produced every group's numbers.
    for (const group of result.report.metricGroups) {
      expect(group.metrics.scoringCostUsd).toBe(0.075)
    }

    const summary = renderEvalSummary({ cases, report: result.report })
    expect(summary).toContain(
      '| Scoring cost (judge, separate from review cost) | $0.0750 |'
    )
    expect(summary).toContain(
      '| Scoring input tokens (judge + plausibility judge) | 900 |'
    )
  })

  // `durationMs` sums only each case's review time, so it cannot answer how
  // long the run actually took (judge calls, calibration, and orchestration
  // overhead are invisible to it). `elapsedMs` is the monotonic wall clock for
  // the WHOLE run and must be injectable, exactly like the CLI's `now` seam,
  // so a saved report stays deterministic in tests.
  test('reports a monotonic whole-run elapsed time distinct from summed review duration', async () => {
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
            reviewReport: reviewReport([admittedFinding()])
          }
        }
      ],
      generatedAt: '2026-06-20T00:00:02.000Z',
      // Deliberately far from the case's own review durationMs (1000, per the
      // shared `reviewReport` fixture default) so the two numbers cannot be
      // confused for one another.
      evaluationElapsedMs: () => 987
    })

    expect(result.report.metrics.elapsedMs).toBe(987)
    expect(result.report.metrics.durationMs).toBe(1000)
    expect(result.report.metrics.elapsedMs).not.toBe(
      result.report.metrics.durationMs
    )
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

  test('surfaces the review report’s discovery telemetry per case', async () => {
    // Spec 27. The eval report is the only artefact a comparison script reads, so
    // a counter that stops at the review report answers nothing about a paid run.
    // Recorded per case so an A/B can be paired case by case, and at the
    // resolution of hundreds of discovery calls rather than dozens of
    // expectations.
    const cases = parseEvalCases([inlineEvalCases[0]])
    const discovery = {
      totals: {
        callCount: 3,
        rawFindingCount: 5,
        rawFindingsPerCall: [3, 2, 0],
        candidateCount: 2,
        droppedCount: 3,
        suppressedByIdCount: 0,
        suppressedByLocationCount: 0,
        cappedByLimitCount: 0,
        contextOverflowSplitCount: 0,
        mergeCallCount: 0,
        mergeGroupCount: 0,
        mergedAwayCount: 0
      },
      tasks: []
    }
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
              { discovery }
            )
          }
        }
      ],
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    expect(result.report.caseResults[0]?.discovery).toEqual(discovery)
    // Raw findings and admitted findings are different quantities, and the whole
    // point of recording both is that the gap between them is visible.
    expect(result.report.caseResults[0]?.discovery?.totals.rawFindingCount).toBe(5)
    expect(result.report.caseResults[0]?.matchedFindings).toHaveLength(1)
  })

  test('records no discovery telemetry for a case whose provider errored', async () => {
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
            status: 'provider-error',
            code: 'provider_unavailable',
            message: 'The provider refused the request.'
          }
        }
      ],
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    // No call was issued, so nothing is claimed — not a recorded zero.
    expect(result.report.caseResults[0]?.discovery).toBeUndefined()
  })

  // A provider-errored case surfaced no usage and no timing, so its cost and
  // duration are UNKNOWN. Publishing them as an exact $0.00 for 0ms understated
  // whichever arm errored more — usually the more expensive one — in the very
  // figures capability-withdrawal rules are decided on.
  test('reports an errored case cost as unavailable rather than as a confident zero', async () => {
    const cases = parseEvalCases(inlineEvalCases)
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
            status: 'provider-error',
            code: 'provider_unavailable',
            message: 'The provider refused the request.'
          }
        }
      ],
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    const erroredCase = result.report.caseResults.find(
      (caseResult) => caseResult.caseId === 'typescript-negative'
    )
    expect(erroredCase?.providerErrored).toBe(true)
    expect(erroredCase?.costUnavailable).toBe(true)
    expect(erroredCase).not.toHaveProperty('costUsd')
    expect(erroredCase).not.toHaveProperty('durationMs')

    // The totals carry only the case that actually reported them...
    expect(result.report.metrics.costUsd).toBe(0.1)
    expect(result.report.metrics.durationMs).toBe(1000)
    // ...and say so, so neither is read as the run's exact spend.
    expect(result.report.metrics.costUnavailableCount).toBe(1)
    expect(result.report.metrics.durationUnavailableCount).toBe(1)

    const summary = renderEvalSummary({ cases, report: result.report })
    expect(summary).toContain(
      '| Review cost | $0.1000 known; unavailable for 1 case(s) |'
    )
    expect(summary).toContain(
      '| Duration (summed review time) | 1.0s known; unavailable for 1 case(s) |'
    )
  })

  // The same defect as the cost one above, one field over: a case that surfaced
  // no usage record contributed 0 input/cached/output tokens, so a run's token
  // totals silently understated themselves in exactly the arm that errored more.
  test('reports an errored case token usage as unavailable rather than as confident zeros', async () => {
    const cases = parseEvalCases(inlineEvalCases)
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
            reviewReport: reviewReport([admittedFinding()], [], 'complete', {
              inputTokens: 120,
              cachedInputTokens: 40,
              outputTokens: 30
            })
          }
        },
        {
          caseId: 'typescript-negative',
          changedLineCount: 10,
          diffHunkCount: 1,
          contextLedger: [],
          result: {
            status: 'provider-error',
            code: 'provider_unavailable',
            message: 'The provider refused the request.'
          }
        }
      ],
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    const erroredCase = result.report.caseResults.find(
      (caseResult) => caseResult.caseId === 'typescript-negative'
    )
    // Omitted, never written as 0: no usage record was ever surfaced for this
    // case, so every token count is a measurement nobody took.
    expect(erroredCase?.usageUnavailable).toBe(true)
    expect(erroredCase).not.toHaveProperty('inputTokens')
    expect(erroredCase).not.toHaveProperty('cachedInputTokens')
    expect(erroredCase).not.toHaveProperty('outputTokens')

    // The totals carry only the case that actually reported usage...
    expect(result.report.metrics.inputTokens).toBe(120)
    expect(result.report.metrics.cachedInputTokens).toBe(40)
    expect(result.report.metrics.outputTokens).toBe(30)
    // ...and one count covers all three, because they are surfaced together.
    expect(result.report.metrics.usageUnavailableCount).toBe(1)

    const summary = renderEvalSummary({ cases, report: result.report })
    expect(summary).toContain(
      '| Input tokens | 120 known; unavailable for 1 case(s) |'
    )
    expect(summary).toContain(
      '| Output tokens | 30 known; unavailable for 1 case(s) |'
    )
  })

  // Cost availability and usage availability are two questions. A provider run
  // that surfaced usage but had no price for its model knows every token count
  // and no cost, and collapsing the two would mark real measurements unknown.
  test('keeps known token usage known when only the cost could not be priced', async () => {
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
              { inputTokens: 12, outputTokens: 8, costUsd: undefined }
            )
          }
        }
      ],
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    expect(result.report.caseResults[0]).toMatchObject({
      costUnavailable: true,
      usageUnavailable: false,
      inputTokens: 12,
      outputTokens: 8
    })
    expect(result.report.metrics.costUnavailableCount).toBe(1)
    expect(result.report.metrics.usageUnavailableCount).toBe(0)
  })

  // THE GATE CANNOT PASS ON A FLOOR.
  //
  // `costUsd` sums only the cases whose cost was measured, so with an unmeasured
  // case it is a floor. A floor at or below the threshold does not establish
  // that the run was under budget, and reporting that as a pass puts this
  // repository's recurring defect class inside the one place meant to catch it.
  // Note there is no provider error here at all: the refusal is about a missing
  // measurement, not about a case that failed.
  test('refuses a cost threshold it cannot evaluate instead of reporting a pass', async () => {
    const cases = parseEvalCases(inlineEvalCases)
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
            reviewReport: reviewReport([], ['cost-unavailable'], 'complete', {
              costUsd: undefined
            })
          }
        }
      ],
      thresholds: { maxCostUsd: 5, failOnProviderError: true },
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    // The premise: a partial total that sits under the threshold.
    expect(result.report.metrics.costUsd).toBe(0.1)
    expect(result.report.metrics.costUnavailableCount).toBe(1)

    expect(result.report.regressionGate.outcome).toBe('not-evaluable')
    // Not a failure either: no threshold was breached and no case is to blame.
    expect(result.report.regressionGate.reasons).toEqual([])
    expect(result.report.regressionGate.failingCaseIds).toEqual([])
    expect(result.report.regressionGate.notEvaluableReasons).toEqual([
      'costUsd not evaluable against threshold 5: 0.1 is a known-only total, unmeasured for 1 case(s), so the run\'s true total may be on either side of the threshold'
    ])
  })

  // The artifact a human reads must not require inference. "Under budget" and
  // "budget not evaluable" are different claims and must LOOK different.
  test('renders a refused gate distinguishably from a genuine pass', async () => {
    const cases = parseEvalCases(inlineEvalCases)
    const runWithSecondCase = async (
      secondCaseReport: ReviewReport
    ): Promise<EvalReport> =>
      (
        await runEvaluation({
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
              result: { status: 'ok', reviewReport: secondCaseReport }
            }
          ],
          thresholds: { maxCostUsd: 5, failOnProviderError: true },
          generatedAt: '2026-06-20T00:00:02.000Z'
        })
      ).report

    const refused = await runWithSecondCase(
      reviewReport([], ['cost-unavailable'], 'complete', { costUsd: undefined })
    )
    const passed = await runWithSecondCase(reviewReport([]))

    expect(refused.regressionGate.outcome).toBe('not-evaluable')
    expect(passed.regressionGate.outcome).toBe('passed')
    expect(passed.regressionGate.notEvaluableReasons).toEqual([])

    const refusedSummary = renderEvalSummary({ cases, report: refused })
    const passedSummary = renderEvalSummary({ cases, report: passed })

    expect(refusedSummary).toContain('Gate: NOT EVALUABLE')
    expect(passedSummary).toContain('Gate: PASS')
    expect(refusedSummary).toContain('## Gate Thresholds Not Evaluable')
    expect(refusedSummary).toContain(
      '- costUsd not evaluable against threshold 5'
    )
    // A genuine pass says nothing about unevaluable thresholds, because it has
    // none — the section is absent rather than empty.
    expect(passedSummary).not.toContain('## Gate Thresholds Not Evaluable')
  })

  // The refusal must not have made the gate permissive. Unknown spend can only
  // ADD to a total, so a floor already above the threshold is a decided breach
  // whatever the unknowns hold, and it still fails.
  test('fails a cost threshold the known-only total already exceeds', async () => {
    const cases = parseEvalCases(inlineEvalCases)
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
            reviewReport: reviewReport([], ['cost-unavailable'], 'complete', {
              costUsd: undefined
            })
          }
        }
      ],
      thresholds: { maxCostUsd: 0.05, failOnProviderError: true },
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    expect(result.report.metrics.costUnavailableCount).toBe(1)
    expect(result.report.regressionGate.outcome).toBe('failed')
    expect(result.report.regressionGate.reasons).toEqual([
      'costUsd above threshold: 0.1 > 0.05'
    ])
    expect(result.report.regressionGate.notEvaluableReasons).toEqual([])
  })

  // A decided failure outranks a refusal. The unevaluable threshold is still
  // RECORDED — it is a fact about the run — but it does not soften the verdict.
  test('reports a decided failure as failed even when another threshold is not evaluable', async () => {
    const cases = parseEvalCases(inlineEvalCases)
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
            reviewReport: reviewReport(
              [admittedFinding({ id: 'find_noise1' })],
              ['cost-unavailable'],
              'complete',
              { costUsd: undefined }
            )
          }
        }
      ],
      thresholds: {
        maxCostUsd: 5,
        maxFalsePositiveCount: 0,
        failOnProviderError: true
      },
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    expect(result.report.regressionGate.outcome).toBe('failed')
    expect(result.report.regressionGate.reasons).toContain(
      'falsePositiveCount above threshold: 1 > 0'
    )
    expect(result.report.regressionGate.notEvaluableReasons).toHaveLength(1)
  })

  // Duration is unknown only when there is no review report at all, so this
  // needs the provider error the cost tests deliberately avoided.
  // `failOnProviderError` is off so the refusal is not masked by the error
  // itself — which is exactly the reading this outcome exists to preserve: an
  // infrastructure problem must not be reported as a quality verdict.
  test('refuses a duration threshold it cannot evaluate', async () => {
    const cases = parseEvalCases(inlineEvalCases)
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
            status: 'provider-error',
            code: 'provider_unavailable',
            message: 'The provider refused the request.'
          }
        }
      ],
      thresholds: { maxDurationMs: 60_000, failOnProviderError: false },
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    expect(result.report.metrics.durationMs).toBe(1000)
    expect(result.report.metrics.durationUnavailableCount).toBe(1)
    expect(result.report.regressionGate.outcome).toBe('not-evaluable')
    expect(result.report.regressionGate.reasons).toEqual([])
    expect(result.report.regressionGate.notEvaluableReasons).toEqual([
      'durationMs not evaluable against threshold 60000: 1000 is a known-only total, unmeasured for 1 case(s), so the run\'s true total may be on either side of the threshold'
    ])
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

  // Spec 06 item 0.4: without a per-severity rejection tally, "is the model
  // over-calling severity" is confounded by the admission floor deleting every
  // model-origin `low` candidate before anyone downstream can observe it. This
  // exercises the real admission-gate-to-report path: a rejected candidate
  // that carries its own severity (an admission-floor rejection) and one that
  // does not (a refutation-stage rejection, which does not yet thread severity
  // through its own contract) must both be tallied, the latter under `unknown`
  // rather than silently dropped.
  test('tallies rejected candidates by severity and by reason x severity', async () => {
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
                    candidateId: 'cand_below_threshold1',
                    status: 'rejected',
                    reason: 'below-threshold',
                    message: 'Candidate severity is below configured admission threshold.',
                    severity: 'low'
                  },
                  {
                    candidateId: 'cand_refuted1',
                    status: 'rejected',
                    reason: 'refuted',
                    message: 'Refutation found a contradiction.'
                  }
                ]
              }
            )
          }
        }
      ],
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    expect(result.report.metrics.rejectionReasonCounts).toEqual({
      'below-threshold': 1,
      refuted: 1
    })
    expect(result.report.metrics.rejectionSeverityCounts).toEqual({
      low: 1,
      unknown: 1
    })
    expect(result.report.metrics.rejectionReasonBySeverityCounts).toEqual({
      'below-threshold': { low: 1 },
      refuted: { unknown: 1 }
    })

    const summary = renderEvalSummary({ cases, report: result.report })
    expect(summary).toContain('Rejected candidates by severity')
    expect(summary).toContain('low 1, unknown 1')
    expect(summary).toContain('## Rejections by Reason and Severity')
    expect(summary).toContain('| below-threshold | low | 1 |')
    expect(summary).toContain('| refuted | unknown | 1 |')
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
      outcome: 'passed',
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
    expect(result.report.regressionGate.outcome).toBe('failed')
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
    // Precision is published as its bracket, and with no plausibility judge the
    // upper bound is NOT MEASURED rather than equal to the lower bound.
    expect(summary).toContain(
      '| sourceProfile | benchmark-semantic | 1 | 100.0% | 100.0% to not measured (no plausibility judge) | 100.0% | n/a (0 checked) | 0 |'
    )
    expect(summary).toContain(
      '| language | typescript | 2 | 100.0% | 100.0% to not measured (no plausibility judge) | 100.0% | 100.0% (1 checked) | 0 |'
    )
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
      adjustedPrecisionTrustworthy: true,
      plausibilityJudged: false
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
        severityMatches: true,
        producedPath: 'src/other.ts',
        producedStartLine: 99
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
    // linePlacementRate (item 0.3) is a DIFFERENT, diagnostic-only measurement:
    // unlike lineAccuracy it DOES score this path-semantic match, because it
    // declares a lineRange. The finding landed at line 90 against a declared
    // [4, 4] range -- far outside even the 3-line tolerance -- so it is
    // checked but not counted accurate. This is exactly the case lineAccuracy
    // structurally cannot see: line placement on path-semantic matches was
    // completely unmeasured before this metric existed.
    expect(semanticOnlyRun.report.metrics.linePlacementCheckCount).toBe(1)
    expect(semanticOnlyRun.report.metrics.linePlacementRate).toBe(0)

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
    // linePlacementRate's denominator is broader (2: the path-semantic AND the
    // path-line expectation that both declare a lineRange) while lineAccuracy's
    // stays at 1 (only the path-line one) -- proving the two metrics are
    // genuinely independent measurements, not the same number rendered twice.
    expect(mixedRun.report.metrics.linePlacementCheckCount).toBe(2)
    expect(mixedRun.report.metrics.linePlacementRate).toBe(0.5)
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

    expect(result.report.regressionGate.outcome).toBe('passed')
    expect(result.report.scoring).toEqual({
      judgeTrustworthy: true,
      adjustedPrecisionTrustworthy: true,
      plausibilityJudged: false
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
        // This fixture carries no reviewed diff, so the hunk-span rule has
        // nothing to place the expectation against.
        diffScope: 'undetermined',
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

  test('stores the diff scope of every expectation and splits recall by it', async () => {
    // Two expectations in the same case: one inside a hunk of the reviewed
    // diff, one in a file the diff never touches. The reviewer finds the
    // in-diff one only, which is the shape the corpus measures repeatedly --
    // and blended recall (50%) says nothing about either population on its own.
    const cases = parseEvalCases([
      {
        id: 'diff-scope-case',
        language: 'typescript',
        repositoryFixture: 'fixtures/typescript/positive',
        changedFiles: ['src/app.ts'],
        diff: `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,6 +1,6 @@
 export const run = () => {
-  const value = computeSafely()
+  const value = compute()
   return value
 }
`,
        expectedFindings: [
          {
            category: 'bug',
            severity: 'high',
            path: 'src/app.ts',
            lineRange: [4, 4],
            matchMode: 'path-semantic',
            semanticSummary: 'incorrect return value from changed branch'
          },
          {
            category: 'bug',
            severity: 'high',
            path: 'src/legacy.ts',
            lineRange: [40, 42],
            matchMode: 'path-semantic',
            semanticSummary: 'pre-existing unchecked cast in untouched code'
          }
        ],
        expectedNoFindingZones: [],
        tags: ['positive', 'typescript']
      }
    ])

    const result = await runEvaluation({
      cases,
      judge: acceptingJudge,
      outputs: [
        {
          caseId: 'diff-scope-case',
          changedLineCount: 2,
          diffHunkCount: 1,
          contextLedger: [],
          result: {
            status: 'ok',
            reviewReport: reviewReport([admittedFinding()])
          }
        }
      ],
      generatedAt: '2026-06-20T00:00:02.000Z'
    })

    // Stored per expectation on the scored artefact, so no consumer has to
    // re-derive the split and no two consumers can derive it differently.
    expect(
      result.report.caseResults[0]?.expectedFindings.map(
        (expected) => expected.diffScope
      )
    ).toEqual(['in-diff', 'out-of-diff'])

    expect(result.report.metrics.recall).toBe(0.5)
    expect(result.report.metrics.recallByDiffScope['in-diff']).toBe(1)
    expect(result.report.metrics.recallByDiffScope['out-of-diff']).toBe(0)
    expect(result.report.metrics.recallByDiffScope.undetermined).toBeNull()
    expect(result.report.metrics.diffScopeCounts).toEqual({
      'in-diff': { expected: 1, matched: 1 },
      'out-of-diff': { expected: 1, matched: 0 },
      undetermined: { expected: 0, matched: 0 }
    })

    const summary = renderEvalSummary({ cases, report: result.report })

    // Reported ALONGSIDE the blended figure, never instead of it.
    expect(summary).toContain('| Findings | Recall (all tiers) | 50.0% |')
    expect(summary).toContain('| Findings | Recall (in-diff) | 100.0% (1 checked) |')
    expect(summary).toContain('| Findings | Recall (out-of-diff) | 0.0% (1 checked) |')
    expect(summary).toContain('| in-diff | 100.0% (1 checked) | 1/1 |')
    expect(summary).toContain('| out-of-diff | 0.0% (1 checked) | 0/1 |')

    // A comparison must be able to move the two populations independently, or a
    // change that trades one for the other reads as flat.
    const miss = await runEvaluation({
      cases,
      judge: rejectingJudge,
      outputs: [
        {
          caseId: 'diff-scope-case',
          changedLineCount: 2,
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
    const comparison = renderEvalComparison({
      base: comparisonArm(miss.report, 'base'),
      head: comparisonArm(result.report, 'head')
    })

    expect(comparison).toContain(
      '| Recall (in-diff) | 0.0% (1 checked) | 100.0% (1 checked) | +100.0pp |'
    )
    expect(comparison).toContain(
      '| Recall (out-of-diff) | 0.0% (1 checked) | 0.0% (1 checked) | 0.0pp |'
    )

    // A side that measured a population not at all is `n/a`, and its delta is
    // suppressed: differencing a missing population against a measured one
    // produces a number that looks like a regression and is not one.
    const negativeOnly = await runEvaluation({
      cases: parseEvalCases([inlineEvalCases[1]]),
      outputs: [
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
      generatedAt: '2026-06-20T00:00:04.000Z'
    })

    expect(
      renderEvalComparison({
        base: comparisonArm(negativeOnly.report, 'base'),
        head: comparisonArm(result.report, 'head')
      })
    ).toContain(
      '| Recall (in-diff) | n/a (0 checked) | 100.0% (1 checked) | n/a |'
    )
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
      base: comparisonArm(evalReportForComparison({
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
      }), 'base'),
      head: comparisonArm(evalReportForComparison({
        ...head.report,
        // This test's subject is selection-status and metric-group rendering
        // when the two runs cover DIFFERENT case sets -- a scenario spec 06
        // deliberately renders as a warning rather than refusing outright.
        // `head` really did select fewer cases than `base`, so its genuine
        // answer-key digest legitimately differs; pin it to `base`'s here so
        // this test keeps exercising that selection-mismatch warning path
        // rather than tripping the (separately tested) hard provenance
        // refusal that a real differing digest now triggers.
        provenance: base.report.provenance,
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
      }), 'head')
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
      '| sourceProfile | project | 2 | 1 | 50.0% | 100.0% | +50.0pp | 100.0% to not measured (no plausibility judge) | 50.0% to not measured (no plausibility judge) | -50.0pp | unknown (not recorded) | 66.7% | 66.7% | 0.0pp | 0 | 1 | +1 |'
    )
    expect(comparison).toContain(
      '| language | typescript | 2 | 1 | 50.0% | 100.0% | +50.0pp | 100.0% to not measured (no plausibility judge) | 50.0% to not measured (no plausibility judge) | -50.0pp | unknown (not recorded) | 66.7% | 66.7% | 0.0pp | 0 | 1 | +1 |'
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
      '| sourceProfile | project | 2 | 1 | 50 | 15 | -35 | 10 | 5 | -5 | 0 | 0 | 0 | $0.2000 | $0.00 known; unavailable for 1 case(s) | -0.2 | 0 | 1 | +1 |'
    )
    expect(comparison).toContain(
      '| language | typescript | 2 | 1 | 50 | 15 | -35 | 10 | 5 | -5 | 0 | 0 | 0 | $0.2000 | $0.00 known; unavailable for 1 case(s) | -0.2 | 0 | 1 | +1 |'
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

    // Per-mechanism precision (spec 15). Matched findings inherit the mechanism
    // of the expectation they matched, so authorization and injection each have
    // a real denominator; ssrf was never reported, so its denominator is empty
    // and its rate is null rather than a vacuous 100%.
    expect(metrics.securityFindingMechanismCounts.authorization).toEqual({
      matched: 1,
      genuineFalsePositive: 0
    })
    expect(metrics.securityFindingMechanismCounts.ssrf).toEqual({
      matched: 0,
      genuineFalsePositive: 0
    })
    expect(metrics.securityAdjustedPrecisionByMechanism.authorization).toBe(1)
    expect(metrics.securityAdjustedPrecisionByMechanism.ssrf).toBeNull()
    expect(metrics.securityMechanismAttributionCounts).toEqual({
      expectation: 2,
      cwe: 0,
      unknown: 0
    })

    const summary = renderEvalSummary({ cases, report: result.report })
    expect(summary).toContain('## Security by Mechanism')
    expect(summary).toContain('| authorization | 100.0% | 1/1 | 100.0% | 1/1 |')
    expect(summary).toContain('| injection | 100.0% | 1/1 | 100.0% | 1/1 |')
    // Reported but never matched: recall is a real 0.0% over a real denominator,
    // while precision has nothing in its denominator and says so.
    expect(summary).toContain('| ssrf | 0.0% | 0/1 | n/a | 0/0 |')
    expect(summary).toContain(
      'no genuine security false positive was left unattributed'
    )
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
    expect(result.report.regressionGate.outcome).toBe('failed')
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
    expect(summary).toContain(
      '| Precision (raw to adjusted bracket) | 50.0% to 100.0% |'
    )
    expect(summary).toContain('| Precision (upper bound, adjusted) | 100.0% |')
    expect(summary).toContain('| Genuine false positives | 0 |')
    expect(summary).toContain('| Unmatched but plausible | 1 |')
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
