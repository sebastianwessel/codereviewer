import { describe, expect, test } from 'vitest'
import {
  EVAL_RECALL_REPORT_ARTIFACT_NAME,
  EVAL_REPORT_ARTIFACT_NAME,
  EVAL_SUMMARY_ARTIFACT_NAME,
  renderEvalSummary
} from './eval-summary-report-rendering.js'
import { renderEvalComparison } from './eval-comparison-report-rendering.js'
import { renderEvalRecallReport } from './eval-recall-report-rendering.js'
import {
  emptySecurityContextDepthCounts,
  emptySecurityMechanismCounts
} from './metrics.js'
import {
  SecurityContextDepthSchema,
  SecurityMechanismSchema
} from './eval-fixture.schema.js'

const zeroSecurityRecordByMechanism = Object.fromEntries(
  SecurityMechanismSchema.options.map((mechanism) => [mechanism, 0])
) as Record<(typeof SecurityMechanismSchema.options)[number], number>

const zeroSecurityRecordByContextDepth = Object.fromEntries(
  SecurityContextDepthSchema.options.map((depth) => [depth, 0])
) as Record<(typeof SecurityContextDepthSchema.options)[number], number>

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
    const summary = renderEvalSummary({
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
            duplicateFindings: [],
            falsePositiveFindingIds: [],
            falsePositiveFindings: [],
            unlistedRealFindingIds: [],
            unlistedRealFindings: [],
            genuineFalsePositiveFindingIds: [],
            noFindingZoneFalsePositiveIds: [],
            artifactOnlyFindingIds: [],
            artifactOnlyMatchedFindings: [],
            artifactOnlyFalsePositiveFindingIds: [],
            artifactOnlyFalsePositiveFindings: [],
            refutationResults: [],
            fixOutcomes: [],
            inlineFindingCount: 0,
            warnings: [],
            durationMs: 1,
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            costUnavailable: false,
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
          securityRecallByContextDepth: zeroSecurityRecordByContextDepth,
          securityContextDepthCounts: emptySecurityContextDepthCounts(),
          securityObviousRecall: 0,
          securityHardRecall: 0,
          securityObviousCount: 0,
          securityHardCount: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          costUnavailableCount: 0,
          costUsd: 0,
          durationMs: 1,
          scoringInputTokens: 0,
          scoringCachedInputTokens: 0,
          scoringOutputTokens: 0,
          scoringCostUnavailable: false,
          scoringCostUsd: 0,
          elapsedMs: 1
        },
        metricGroups: [],
        regressionGate: {
          passed: true,
          reasons: [],
          thresholds: {
            failOnProviderError: true
          },
          failingCaseIds: []
        }
      }
    })

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
  })
})
