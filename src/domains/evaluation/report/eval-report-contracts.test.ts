import { describe, expect, test } from 'vitest'
import { FINDING_DESCRIPTION_MAX } from '../../../shared/contracts/index.js'
import {
  EvalAgenticStageReportSchema,
  EvalContextLedgerEntrySchema,
  EvalExpectedFindingReportSchema,
  EvalFindingSummaryReportSchema,
  EvalProviderIssueReportSchema,
  EvalReportProvenanceSchema,
  EvalReportSchema
} from './eval-report-contracts.js'

const findingSummary = (description: string) => ({
  findingId: 'find_summary1',
  severity: 'high',
  category: 'bug',
  path: 'src/app.ts',
  line: 4,
  title: 'Incorrect return value',
  description,
  proposedBy: 'review-agent',
  evidenceCount: 1,
  hasFixProposal: true,
  relatedLocationCount: 0,
  dataFlowCount: 0,
  cweCount: 0
})

const missingKeysOf = (result: {
  readonly error?: { readonly issues: readonly { readonly path: PropertyKey[] }[] }
}): readonly string[] =>
  (result.error?.issues ?? []).map((issue) => issue.path.join('.'))

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
        stage: 'refutation',
        status: 'skipped',
        count: 0
      })
    ).toEqual({
      stage: 'refutation',
      status: 'skipped',
      count: 0
    })
  })

  // This is the PRODUCER contract and it carries no sentinel defaults. A report an
  // older build wrote must FAIL here rather than parse into a placeholder: reading
  // across versions is `eval-comparison-view.ts`'s job, in one place, and a default
  // in this layer would hand a caller a measured-looking value nobody measured.
  test('refuses a report that omits a field the producer always writes', () => {
    const missing = missingKeysOf(EvalReportSchema.safeParse({}))

    expect(missing).toContain('metricsVersion')
    expect(missing).toContain('provenance')
    expect(
      missingKeysOf(
        EvalReportProvenanceSchema.safeParse({
          answerKeyDigest: 'a'.repeat(64),
          configHash: 'b'.repeat(64)
        })
      )
    ).toContain('answerKeyDigestByCase')
    expect(
      missingKeysOf(
        EvalExpectedFindingReportSchema.safeParse({
          expectedIndex: 0,
          category: 'bug',
          severity: 'high',
          matchMode: 'semantic-only',
          semanticSummary: 'incorrect return value from changed branch'
        })
      )
    ).toContain('diffScope')
  })

  // The description is what makes an ARCHIVED run re-adjudicable: every judge in
  // this domain decides from it, so a summary without it can only be re-judged by
  // paying for the run again. A cap below the producer's own bound would defeat
  // that -- it would reject or truncate ordinary descriptions rather than guard
  // against anything a finding can actually carry.
  test('carries the finding description at the finding contract\'s own cap', () => {
    expect(
      EvalFindingSummaryReportSchema.parse(
        findingSummary('x'.repeat(FINDING_DESCRIPTION_MAX))
      ).description
    ).toHaveLength(FINDING_DESCRIPTION_MAX)
    expect(
      EvalFindingSummaryReportSchema.safeParse(
        findingSummary('x'.repeat(FINDING_DESCRIPTION_MAX + 1))
      ).success
    ).toBe(false)
    expect(
      missingKeysOf(
        EvalFindingSummaryReportSchema.safeParse({
          ...findingSummary('x'),
          description: undefined
        })
      )
    ).toContain('description')
  })
})
