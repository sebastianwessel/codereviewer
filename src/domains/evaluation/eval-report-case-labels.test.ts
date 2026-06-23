import { describe, expect, test } from 'vitest'
import {
  agenticStageLabel,
  caseStatus,
  contextLedgerConsideredCount,
  contextLedgerKindLabel,
  contextLedgerTruncatedCount,
  noteForCase,
  providerIssueLabel
} from './eval-report-case-labels.js'

describe('eval report case labels', () => {
  test('formats case status with provider and parse errors taking precedence', () => {
    expect(
      caseStatus({
        providerErrored: true,
        parseValid: true,
        unmatchedExpectedIndexes: [],
        falsePositiveFindingIds: [],
        noFindingZoneFalsePositiveIds: []
      })
    ).toBe('ERROR')
    expect(
      caseStatus({
        providerErrored: false,
        parseValid: true,
        unmatchedExpectedIndexes: [],
        falsePositiveFindingIds: [],
        noFindingZoneFalsePositiveIds: []
      })
    ).toBe('PASS')
    expect(
      caseStatus({
        providerErrored: false,
        parseValid: true,
        unmatchedExpectedIndexes: [0],
        falsePositiveFindingIds: [],
        noFindingZoneFalsePositiveIds: []
      })
    ).toBe('FAIL')
  })

  test('formats provider issue and agentic stage labels', () => {
    expect(providerIssueLabel({ providerIssues: [] })).toBe('-')
    expect(
      providerIssueLabel({
        providerIssues: [
          {
            code: 'timeout',
            recovered: false,
            stage: 'proof',
            message: 'Request exceeded provider timeout.'
          },
          { code: 'budget-exceeded', recovered: true }
        ]
      })
    ).toBe(
      'error:timeout@proof - Request exceeded provider timeout., recovered:budget-exceeded'
    )

    expect(agenticStageLabel({ agenticStages: [] }, 'proof-packet')).toBe('-')
    expect(
      agenticStageLabel(
        {
          agenticStages: [
            { count: 2, stage: 'proof-packet', status: 'completed' }
          ]
        },
        'proof-packet'
      )
    ).toBe('completed 2')
  })

  test('formats context ledger labels and counts', () => {
    const caseResult = {
      contextLedger: [
        { consideredForModelContext: true, kind: 'file', truncated: false },
        { consideredForModelContext: false, kind: 'tool-result', truncated: true },
        { consideredForModelContext: true, kind: 'file', truncated: true }
      ]
    }

    expect(contextLedgerKindLabel({ contextLedger: [] })).toBe('-')
    expect(contextLedgerKindLabel(caseResult)).toBe('file: 2, tool-result: 1')
    expect(contextLedgerConsideredCount(caseResult)).toBe(2)
    expect(contextLedgerTruncatedCount(caseResult)).toBe(2)
  })

  test('formats case notes while filtering non-actionable warnings', () => {
    expect(
      noteForCase({
        artifactOnlyFalsePositiveFindingIds: [],
        artifactOnlyMatchedFindings: [],
        duplicateFindingIds: [],
        falsePositiveFindingIds: [],
        noFindingZoneFalsePositiveIds: [],
        providerErrored: false,
        providerIssues: [],
        unmatchedExpectedIndexes: [],
        warnings: ['config-file-missing']
      })
    ).toBe('-')
    expect(
      noteForCase({
        artifactOnlyFalsePositiveFindingIds: ['artifact-noise'],
        artifactOnlyMatchedFindings: ['artifact-match'],
        duplicateFindingIds: ['duplicate'],
        falsePositiveFindingIds: ['fp1', 'fp2'],
        noFindingZoneFalsePositiveIds: ['nfz'],
        providerErrored: false,
        providerIssues: [{ code: 'timeout', recovered: true }],
        unmatchedExpectedIndexes: [0],
        warnings: ['config-file-missing', 'semantic-judge-unavailable']
      })
    ).toBe(
      'provider recovered 1; missing 1; false positives 2; duplicates 1; no-finding-zone hits 1; artifact-only matched 1; artifact-only noise 1; warnings 1'
    )
  })
})
