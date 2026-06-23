import { describe, expect, test } from 'vitest'
import { renderEvalSummary } from './eval-summary-report-rendering.js'

describe('eval summary report rendering module', () => {
  test('exports the focused summary report renderer', () => {
    expect(typeof renderEvalSummary).toBe('function')
  })

  test('renders model discovery diagnostics for dropped suspicions', () => {
    const summary = renderEvalSummary({
      cases: [
        {
          id: 'discovery-case',
          language: 'typescript',
          repositoryFixture: 'fixtures/discovery',
          changedFiles: ['src/app.ts'],
          expectedFindings: [],
          expectedNoFindingZones: [],
          tags: []
        }
      ],
      report: {
        schemaVersion: '1.0',
        generatedAt: '2026-06-20T00:00:02.000Z',
        fixtureCount: 1,
        selection: {
          fixtureSource: 'default',
          caseFilters: [],
          selectedCaseIds: ['discovery-case']
        },
        scoring: {
          semanticMatcher: 'deterministic'
        },
        caseResults: [
          {
            caseId: 'discovery-case',
            parseValid: true,
            providerErrored: false,
            providerIssues: [],
            agenticStages: [],
            contextLedger: [],
            expectedFindings: [],
            matchedFindings: [],
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
            modelSuspicionIds: [],
            modelTaskDiagnostics: [
              {
                taskId: 'task_discovery1',
                taskKind: 'dependency-cluster',
                round: 1,
                paths: ['src/app.ts'],
                evidenceCount: 1,
                reviewContextCount: 1,
                reviewIntentCount: 1,
                verificationQuestionCount: 2,
                suggestionCount: 2,
                convertedCandidateCount: 0,
                selectedCandidateCount: 0,
                budgetDroppedCandidateCount: 0,
                modelSuspicionCount: 0,
                proofPacketCount: 0,
                zeroCandidateReason: 'all-suggestions-dropped',
                droppedSuspicionReasons: {
                  'schema-invalid': 1,
                  'missing-required-field': 1,
                  'path-outside-task': 1,
                  'missing-task-evidence': 0,
                  'duplicate-input-candidate': 0,
                  'unsupported-truncation-claim': 0
                },
                schemaInvalidSuggestionIssueCounts: {
                  'category:invalid_value': 1,
                  'path:custom': 1
                }
              }
            ],
            proofPackets: [],
            refutationResults: [],
            promotionDecisions: [],
            inlineFindingCount: 0,
            warnings: [],
            durationMs: 1,
            inputTokens: 0,
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
          trustedDeterministicFindingCount: 2,
          suspicionRecall: 1,
          proofRecall: 1,
          proofPromotionPrecision: 1,
          refutationFalseNegativeCount: 0,
          refutationFalsePositiveCount: 0,
          staticDuplicateDemotionCount: 0,
          investigationToolReadCount: 0,
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
          suspicionStageCoverage: 1,
          judgeCoverage: 1,
          inputTokens: 0,
          outputTokens: 0,
          costUnavailableCount: 0,
          costUsd: 0,
          durationMs: 1
        },
        metricGroups: [],
        regressionGate: {
          passed: true,
          reasons: [],
          thresholds: {},
          failingCaseIds: []
        }
      } as unknown as Parameters<typeof renderEvalSummary>[0]['report']
    })

    expect(summary).toContain('## Model Discovery Diagnostics')
    expect(summary).toContain('| Trusted deterministic findings | 2 |')
    expect(summary).toContain(
      '| discovery-case | task_discovery1 | dependency-cluster | 2 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 2 | all-suggestions-dropped | schema-invalid: 1, missing-required-field: 1, path-outside-task: 1 | category:invalid_value: 1, path:custom: 1 |'
    )
  })

  test('links promotion decisions to active refutations by proof packet', () => {
    const summary = renderEvalSummary({
      cases: [
        {
          id: 'refutation-case',
          language: 'typescript',
          repositoryFixture: 'fixtures/refutation',
          changedFiles: ['src/app.ts'],
          expectedFindings: [],
          expectedNoFindingZones: [],
          tags: []
        }
      ],
      report: {
        schemaVersion: '1.0',
        generatedAt: '2026-06-20T00:00:02.000Z',
        fixtureCount: 1,
        selection: {
          fixtureSource: 'default',
          caseFilters: [],
          selectedCaseIds: ['refutation-case']
        },
        scoring: {
          semanticMatcher: 'deterministic'
        },
        caseResults: [
          {
            caseId: 'refutation-case',
            parseValid: true,
            providerErrored: false,
            providerIssues: [],
            agenticStages: [],
            contextLedger: [],
            expectedFindings: [],
            matchedFindings: [],
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
            modelSuspicionIds: [],
            modelTaskDiagnostics: [],
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
                status: 'actionable',
                reason:
                  'Proof artifacts were assembled; active refutation is required before admission.'
              }
            ],
            inlineFindingCount: 0,
            warnings: [],
            durationMs: 1,
            inputTokens: 0,
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
          suspicionRecall: 1,
          proofRecall: 1,
          proofPromotionPrecision: 1,
          refutationFalseNegativeCount: 0,
          refutationFalsePositiveCount: 0,
          staticDuplicateDemotionCount: 0,
          investigationToolReadCount: 0,
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
          suspicionStageCoverage: 1,
          judgeCoverage: 1,
          inputTokens: 0,
          outputTokens: 0,
          costUnavailableCount: 0,
          costUsd: 0,
          durationMs: 1
        },
        metricGroups: [],
        regressionGate: {
          passed: true,
          reasons: [],
          thresholds: {},
          failingCaseIds: []
        }
      } as unknown as Parameters<typeof renderEvalSummary>[0]['report']
    })

    expect(summary).toContain(
      '- cand_eval1 actionable (proof proof_eval1, active refutation refute_eval1) - Proof artifacts were assembled; active refutation is required before admission.'
    )
    expect(summary).not.toContain(
      '- cand_eval1 actionable (proof proof_eval1, no refutation)'
    )
  })
})
