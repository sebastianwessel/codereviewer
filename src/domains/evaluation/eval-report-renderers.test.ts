import { describe, expect, test } from 'vitest'
import {
  EVAL_RECALL_REPORT_ARTIFACT_NAME,
  EVAL_REPORT_ARTIFACT_NAME,
  EVAL_SUMMARY_ARTIFACT_NAME,
  renderEvalSummary
} from './eval-summary-report-rendering.js'
import { renderEvalComparison } from './eval-comparison-report-rendering.js'
import { renderEvalRecallReport } from './eval-recall-report-rendering.js'

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
        generatedAt: '2026-06-20T00:00:02.000Z',
        fixtureCount: 1,
        selection: {
          fixtureSource: 'default',
          caseFilters: [],
          selectedCaseIds: ['semantic-case']
        },
        scoring: {
          semanticMatcher: 'semantic-judge'
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
                semanticSummary: 'descriptor resource is leaked'
              }
            ],
            matchedFindings: [
              {
                expectedIndex: 0,
                findingId: 'find_semantic1',
                semanticScore: 1,
                semanticReason: 'Both findings describe the leaked descriptor.',
                lineOverlaps: false,
                severityMatches: true
              }
            ],
            unmatchedExpectedIndexes: [],
            duplicateFindingIds: [],
            duplicateFindings: [],
            falsePositiveFindingIds: [],
            falsePositiveFindings: [],
            noFindingZoneFalsePositiveIds: [],
            artifactOnlyFindingIds: [],
            artifactOnlyMatchedFindings: [],
            artifactOnlyFalsePositiveFindingIds: [],
            artifactOnlyFalsePositiveFindings: [],
            refutationResults: [],
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
          recall: 1,
          precision: 1,
          f1: 1,
          severityWeightedPrecision: 1,
          severityWeightedRecall: 1,
          severityWeightedF1: 1,
          lineAccuracy: 1,
          severityAccuracy: 1,
          falsePositiveCount: 0,
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
          trustedDeterministicFindingCount: 0,
          refutationFalseNegativeCount: 0,
          refutationFalsePositiveCount: 0,
          recallByTier: {
            'runtime-critical': 1,
            security: 1,
            logic: 1,
            nit: 1
          },
          precisionByTier: {
            'runtime-critical': 1,
            security: 1,
            logic: 1,
            nit: 1
          },
          productRecall: 1,
          nitRecall: 1,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          costUnavailableCount: 0,
          costUsd: 0,
          durationMs: 1
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

    expect(summary).toContain('## Semantic Judge Matches')
    expect(summary).toContain('## Context Ledger Kinds')
    expect(summary).toContain('| semantic-case | tool-result: 1, support-signal-output: 1 | 2 | 1 |')
    expect(summary).toContain(
      '| semantic-case | find_semantic1 | expected #0 high bug | Both findings describe the leaked descriptor. |'
    )
  })
})
