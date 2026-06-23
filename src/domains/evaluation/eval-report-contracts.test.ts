import { describe, expect, test } from 'vitest'
import {
  EvalAgenticStageReportSchema,
  EvalContextLedgerEntrySchema,
  EvalProviderIssueReportSchema,
  EvalReportSchema
} from './eval-report-contracts.js'

describe('eval report contracts', () => {
  test('keeps provider issue visibility and scoring metadata in the report contract', () => {
    const issue = EvalProviderIssueReportSchema.parse({
      code: 'provider_timeout',
      stage: 'review_task',
      recovered: true,
      message: 'Request timed out after retry budget was exhausted.'
    })

    expect(issue).toEqual({
      code: 'provider_timeout',
      stage: 'review_task',
      recovered: true,
      message: 'Request timed out after retry budget was exhausted.'
    })
    expect(EvalReportSchema.shape.scoring).toBeDefined()
    expect(EvalReportSchema.shape.caseResults.element.shape.providerIssues).toBeDefined()
    expect(EvalReportSchema.shape.caseResults.element.shape.agenticStages).toBeDefined()
    expect(EvalReportSchema.shape.caseResults.element.shape.contextLedger).toBeDefined()
    expect(
      EvalContextLedgerEntrySchema.parse({
        kind: 'tool-result',
        consideredForModelContext: true,
        truncated: false
      })
    ).toEqual({
      kind: 'tool-result',
      consideredForModelContext: true,
      truncated: false
    })
    expect(
      EvalAgenticStageReportSchema.parse({
        stage: 'judge',
        status: 'skipped',
        count: 0
      })
    ).toEqual({
      stage: 'judge',
      status: 'skipped',
      count: 0
    })
  })
})
