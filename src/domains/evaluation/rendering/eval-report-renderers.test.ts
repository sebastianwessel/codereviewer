import { describe, expect, test } from 'vitest'
import {
  EVAL_RECALL_REPORT_ARTIFACT_NAME,
  EVAL_REPORT_ARTIFACT_NAME,
  EVAL_SUMMARY_ARTIFACT_NAME,
  renderEvalSummary
} from './summary/eval-summary-report-rendering.js'
import { renderEvalComparison } from './comparison/eval-comparison-report-rendering.js'
import { renderEvalRecallReport } from './eval-recall-report-rendering.js'
import {
  emptySecurityContextDepthCounts,
  emptySecurityMechanismCounts
} from '../scoring/metrics.js'
import {
  SecurityContextDepthSchema,
  SecurityMechanismSchema
} from '../corpus/eval-fixture.schema.js'
import { emptySecurityFindingMechanismCounts } from '../scoring/security-mechanism-attribution.js'

const nullSecurityRecordByMechanism = Object.fromEntries(
  SecurityMechanismSchema.options.map((mechanism) => [mechanism, null])
) as Record<(typeof SecurityMechanismSchema.options)[number], number | null>

const zeroSecurityRecordByMechanism = Object.fromEntries(
  SecurityMechanismSchema.options.map((mechanism) => [mechanism, 0])
) as Record<(typeof SecurityMechanismSchema.options)[number], number>

const zeroSecurityRecordByContextDepth = Object.fromEntries(
  SecurityContextDepthSchema.options.map((depth) => [depth, 0])
) as Record<(typeof SecurityContextDepthSchema.options)[number], number>

const summaryInput = {
  cases: [
    {
      id: 'semantic-case',
      language: 'typescript',
      repositoryFixture: 'fixtures/typescript/semantic',
      changedFiles: ['src/app.ts'],
      expectedFindings: [
        {
          category: 'bug',
          severity: 'high',
          semanticSummary: 'descriptor resource is leaked',
          matchMode: 'semantic-only'
        }
      ],
      expectedNoFindingZones: [],
      tags: ['semantic']
    }
  ],
  report: {
    schemaVersion: '1.0',
  metricsVersion: 'test-metrics-version',
    generatedAt: '2026-06-20T00:00:02.000Z',
    fixtureCount: 1,
    selection: {
      fixtureSource: 'default',
      caseFilters: [],
      selectedCaseIds: ['semantic-case']
    },
    provenance: {
      answerKeyDigestByCase: {},
  answerKeyDigest: 'test-answer-key-digest',
      configHash: 'test-config-hash'
    },
    scoring: {
      judgeAgreement: 1,
      judgeTrustworthy: true,
      adjustedPrecisionTrustworthy: true
    },
    caseResults: [
      {
        caseId: 'semantic-case',
        parseValid: true,
        providerErrored: false,
        providerIssues: [],
        agenticStages: [],
        contextLedger: [
          {
            kind: 'tool-result',
            consideredForModelContext: true,
            truncated: false
          },
          {
            kind: 'support-signal-output',
            consideredForModelContext: true,
            truncated: true
          }
        ],
        producedFindings: [
          {
            findingId: 'find_semantic1',
            severity: 'high',
            category: 'bug',
            path: 'src/app.ts',
            line: 12,
            title: 'Descriptor is never closed',
            description: 'The descriptor opened on the changed path is never closed.',
            proposedBy: 'review-agent',
            evidenceCount: 1,
            hasFixProposal: false,
            relatedLocationCount: 0,
            dataFlowCount: 0,
            cweCount: 0
          }
        ],
        expectedFindings: [
          {
            expectedIndex: 0,
            category: 'bug',
            severity: 'high',
            matchMode: 'semantic-only',
            diffScope: 'undetermined',
            semanticSummary: 'descriptor resource is leaked'
          }
        ],
        matchedFindings: [
          {
            expectedIndex: 0,
            findingId: 'find_semantic1',
            semanticReason: 'Both findings describe the leaked descriptor.',
            lineOverlaps: false,
            severityMatches: true,
            producedPath: 'src/app.ts',
            producedStartLine: 12
          }
        ],
        unmatchedExpectedIndexes: [],
        inconclusiveExpectedIndexes: [],
        inconclusiveFindingIds: [],
        inconclusiveMatches: [],
        duplicateFindingIds: [],
        falsePositiveFindingIds: [],
        unlistedRealFindingIds: [],
        genuineFalsePositiveFindingIds: [],
        noFindingZoneFalsePositiveIds: [],
        artifactOnlyFindingIds: [],
        artifactOnlyMatchedFindings: [],
        artifactOnlyFalsePositiveFindingIds: [],
        artifactOnlyUnlistedRealFindingIds: [],
        artifactOnlyGenuineFalsePositiveFindingIds: [],
        refutationResults: [],
        fixOutcomes: [],
        inlineFindingCount: 0,
        warnings: [],
        durationMs: 1,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        costUnavailable: false,
        usageUnavailable: false,
        costUsd: 0
      }
    ],
    metrics: {
      parseValidity: 1,
      rejectionReasonCounts: {},
      rejectionSeverityCounts: {},
      rejectionReasonBySeverityCounts: {},
      lineCheckCount: 0,
      severityCheckCount: 0,
      linePlacementRate: null,
      linePlacementCheckCount: 0,
      recall: 1,
      precision: 1,
      adjustedPrecision: 1,
      f1: 1,
      severityWeightedPrecision: 1,
      severityWeightedRecall: 1,
      severityWeightedF1: 1,
      lineAccuracy: 1,
      severityAccuracy: 1,
      falsePositiveCount: 0,
      genuineFalsePositiveCount: 0,
      unlistedRealFindingCount: 0,
      noFindingZoneFalsePositiveCount: 0,
      actionableRate: 1,
      commentsPerKloc: 0,
      commentsPerDiffHunk: 0,
      incompleteCoverageRate: 0,
      contextMutationRate: 0,
      providerErrorRate: 0,
      providerIssueRate: 0,
      providerIssueCount: 0,
      duplicateFindingCount: 0,
      artifactOnlyRecall: 1,
      artifactOnlyPrecision: 1,
      artifactOnlyFindingCount: 0,
      artifactOnlyMatchedFindingCount: 0,
      artifactOnlyFalsePositiveCount: 0,
      artifactOnlyUnlistedRealCount: 0,
      artifactOnlyGenuineFalsePositiveCount: 0,
      refutationFalseNegativeCount: 0,
      refutationFalsePositiveCount: 0,
      fixJudgmentAccuracy: 0,
      fixFalsePositiveDetectionRate: 0,
      fixProduceRate: 0,
      fixApplyFailureRate: 0,
      fixJudgedFindingCount: 0,
      fixGroundTruthFalsePositiveCount: 0,
      fixRealFindingCount: 0,
      fixAttemptedCount: 0,
      recallByTier: {
        'runtime-critical': 1,
        security: 1,
        logic: 1,
        nit: 1
      },
      judgeAgreement: 1,
      judgeAgreementPairCount: 12,
      plausibilityJudgeAgreementPairCount: 0,
      inconclusiveMatchCount: 0,
      productRecall: 1,
      nitRecall: 1,
      recallByDiffScope: {
        'in-diff': null,
        'out-of-diff': null,
        undetermined: 1
      },
      diffScopeCounts: {
        'in-diff': { expected: 0, matched: 0 },
        'out-of-diff': { expected: 0, matched: 0 },
        undetermined: { expected: 1, matched: 1 }
      },
      securityRecallByMechanism: zeroSecurityRecordByMechanism,
      securityMechanismCounts: emptySecurityMechanismCounts(),
      securityAdjustedPrecisionByMechanism: nullSecurityRecordByMechanism,
      securityFindingMechanismCounts: emptySecurityFindingMechanismCounts(),
      securityMechanismAttributionCounts: {
        expectation: 0,
        cwe: 0,
        unknown: 0
      },
      securityRecallByContextDepth: zeroSecurityRecordByContextDepth,
      securityContextDepthCounts: emptySecurityContextDepthCounts(),
      securityObviousRecall: 0,
      securityHardRecall: 0,
      securityObviousCount: 0,
      securityHardCount: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      usageUnavailableCount: 0,
      costUnavailableCount: 0,
      costUsd: 0,
      durationMs: 1,
      durationUnavailableCount: 0,
      scoringInputTokens: 0,
      scoringCachedInputTokens: 0,
      scoringOutputTokens: 0,
      scoringCostUnavailable: false,
      scoringCostUsd: 0,
      elapsedMs: 1
    },
    metricGroups: [],
    regressionGate: {
      outcome: 'passed',
      reasons: [],
      notEvaluableReasons: [],
      thresholds: {
        failOnProviderError: true
      },
      failingCaseIds: []
    }
  }
} satisfies Parameters<typeof renderEvalSummary>[0]

describe('eval report rendering', () => {
  test('owns eval Markdown renderer entry points and artifact names', () => {
    expect(EVAL_REPORT_ARTIFACT_NAME).toBe('eval-report.json')
    expect(EVAL_SUMMARY_ARTIFACT_NAME).toBe('eval-summary.md')
    expect(EVAL_RECALL_REPORT_ARTIFACT_NAME).toBe('eval-recall-report.md')
    expect(typeof renderEvalSummary).toBe('function')
    expect(typeof renderEvalRecallReport).toBe('function')
    expect(typeof renderEvalComparison).toBe('function')
  })

  test('renders semantic judge match reasons in the summary', () => {
    const summary = renderEvalSummary(summaryInput)

    // A population with no expectation reports `n/a`, never 0.0%: the engine's
    // real out-of-diff result IS 0.0% over a full denominator, so the two must
    // not render alike.
    expect(summary).toContain('| Findings | Recall (in-diff) | n/a (0 checked) |')
    expect(summary).toContain(
      '| Findings | Recall (out-of-diff) | n/a (0 checked) |'
    )
    // An expectation the hunk-span rule cannot place is surfaced rather than
    // folded into either population.
    expect(summary).toContain('## Recall by Diff Scope')
    expect(summary).toContain('| undetermined | 100.0% (1 checked) | 1/1 |')
    expect(summary).toContain('## Semantic Judge Matches')
    expect(summary).toContain('| Judge agreement | 100.0% (12 pairs) |')
    expect(summary).toContain('| Judge trustworthy | yes |')
    expect(summary).toContain('## Context Ledger Kinds')
    expect(summary).toContain('| semantic-case | tool-result: 1, support-signal-output: 1 | 2 | 1 |')
    expect(summary).toContain(
      '| semantic-case | find_semantic1 | expected #0 high bug | Both findings describe the leaked descriptor. |'
    )
    // No security expectation anywhere, so the mechanism table is ABSENT rather
    // than rendered as a wall of 0.0% rows over empty denominators.
    expect(summary).not.toContain('## Security by Mechanism')

    // An unattributed genuine security false positive bounds every mechanism at
    // once, so no rate is published and the summary says why. This is the branch
    // that keeps a vacuous 100% out of a report.
    const boundedOut = renderEvalSummary({
      ...summaryInput,
      report: {
        ...summaryInput.report,
        metrics: {
          ...summaryInput.report.metrics,
          securityMechanismCounts: {
            ...summaryInput.report.metrics.securityMechanismCounts,
            authorization: { expected: 2, matched: 2 }
          },
          securityRecallByMechanism: {
            ...summaryInput.report.metrics.securityRecallByMechanism,
            authorization: 1
          },
          securityFindingMechanismCounts: {
            ...summaryInput.report.metrics.securityFindingMechanismCounts,
            authorization: { matched: 2, genuineFalsePositive: 0 },
            unknown: { matched: 0, genuineFalsePositive: 3 }
          },
          securityMechanismAttributionCounts: {
            expectation: 2,
            cwe: 0,
            unknown: 3
          }
        }
      }
    })

    expect(boundedOut).toContain('| authorization | 100.0% | 2/2 | n/a | 2/2 |')
    expect(boundedOut).toContain(
      '3 genuine security false positive(s) in this run could not be attributed to one'
    )
  })

  // The rule that retired `prompt-injection` is general, and the cost of it not
  // being general is paid by whoever adds the NEXT mechanism: a member with no
  // expectation anywhere would ride into the table as a `0.0%` row and read as a
  // measured blind spot. Asserted over the whole enum rather than over one name,
  // so a mechanism added later is covered without anyone remembering to come
  // back here. `open-redirect` is exactly that member today.
  test('omits every mechanism with an empty denominator from a table that renders others', () => {
    const summary = renderEvalSummary({
      ...summaryInput,
      report: {
        ...summaryInput.report,
        metrics: {
          ...summaryInput.report.metrics,
          securityMechanismCounts: {
            ...summaryInput.report.metrics.securityMechanismCounts,
            authorization: { expected: 2, matched: 1 }
          },
          securityRecallByMechanism: {
            ...summaryInput.report.metrics.securityRecallByMechanism,
            authorization: 0.5
          }
        }
      }
    })

    expect(summary).toContain('## Security by Mechanism')
    expect(summary).toContain('| authorization | 50.0% | 1/2 |')

    for (const mechanism of SecurityMechanismSchema.options) {
      if (mechanism === 'authorization') {
        continue
      }

      expect(summary).not.toContain(`| ${mechanism} |`)
    }
  })

  // Zero scoring spend is a cost like any other and must read like every other
  // cost cell in the same table. It rendered `$0.0000` next to the review cost's
  // `$0.00` because the scoring row re-implemented currency formatting instead
  // of using the shared formatter.
  test('renders zero scoring cost with the same currency convention as review cost', () => {
    const summary = renderEvalSummary(summaryInput)

    expect(summary).toContain('| Health | Review cost | $0.00 |')
    expect(summary).toContain(
      '| Health | Scoring cost (judge, separate from review cost) | $0.00 |'
    )
    expect(summary).not.toContain('$0.0000')
  })

  // An empty dataset gets no table at all, not a header and separator with no
  // body underneath. Every eval table goes through `appendMarkdownTable` for
  // this, so the sections below must vanish rather than render as an empty
  // two-line husk.
  test('omits eval tables whose dataset is empty instead of emitting a headerless body', () => {
    const emptySummary = renderEvalSummary({
      ...summaryInput,
      report: {
        ...summaryInput.report,
        caseResults: []
      }
    })

    expect(emptySummary).not.toContain('## Cases')
    expect(emptySummary).not.toContain('## Context Ledger Kinds')
    expect(emptySummary).not.toContain(
      '| Case | Profile | Status | Provider | Expected |'
    )

    const emptyRecallReport = renderEvalRecallReport({
      reports: [
        {
          label: 'empty',
          report: {
            ...summaryInput.report,
            caseResults: []
          }
        }
      ]
    })

    expect(emptyRecallReport).toContain('## Runs')
    expect(emptyRecallReport).not.toContain('## Expected Findings')
    expect(emptyRecallReport).not.toContain('| Case | # | Sev | Location |')
  })
})
