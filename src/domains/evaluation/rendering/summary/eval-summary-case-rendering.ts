import type { z } from 'zod'
import type { EvalCase } from '../../corpus/eval-fixture.schema.js'
import {
  appendMarkdownTable,
  escapeMarkdownCell
} from '../eval-report-markdown-formatting.js'
import { caseStatus, noteForCase, providerIssueLabel } from '../eval-report-case-labels.js'
import type { EvalCaseReportSchema, EvalReport } from '../../report/eval-report-contracts.js'

export const findCase = (
  cases: readonly EvalCase[],
  caseId: string
): EvalCase | undefined => cases.find((evalCase) => evalCase.id === caseId)

export const expectedLabelForMatch = (
  caseResult: z.infer<typeof EvalCaseReportSchema>,
  expectedIndex: number
): string => {
  const expected = caseResult.expectedFindings.find(
    (finding) => finding.expectedIndex === expectedIndex
  )

  return expected === undefined
    ? `expected #${expectedIndex}`
    : `expected #${expectedIndex} ${expected.severity} ${expected.category}`
}

const formatEvalSummaryCaseRow = (
  caseResult: z.infer<typeof EvalCaseReportSchema>,
  evalCase: EvalCase | undefined
): string => {
  const expectedCount = evalCase?.expectedFindings.length ?? 0
  return [
    '|',
    escapeMarkdownCell(caseResult.caseId),
    '|',
    escapeMarkdownCell(evalCase?.sourceProfile ?? 'project'),
    '|',
    caseStatus(caseResult),
    '|',
    escapeMarkdownCell(providerIssueLabel(caseResult)),
    '|',
    String(expectedCount),
    '|',
    String(caseResult.matchedFindings.length),
    '|',
    String(caseResult.inlineFindingCount),
    '|',
    String(caseResult.artifactOnlyFindingIds.length),
    '|',
    String(caseResult.falsePositiveFindingIds.length),
    '|',
    String(caseResult.duplicateFindingIds.length),
    '|',
    escapeMarkdownCell(noteForCase(caseResult)),
    '|'
  ].join(' ')
}

export const appendEvalSummaryCases = (
  lines: string[],
  input: {
    readonly cases: readonly EvalCase[]
    readonly report: EvalReport
  }
): void => {
  appendMarkdownTable(lines, {
    heading: '## Cases',
    header:
      '| Case | Profile | Status | Provider | Expected | Matched | Inline | Artifact-only | False positives | Duplicates | Notes |',
    alignment:
      '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    rows: input.report.caseResults.map((caseResult) =>
      formatEvalSummaryCaseRow(
        caseResult,
        findCase(input.cases, caseResult.caseId)
      )
    )
  })
}

type EvalSummarySemanticJudgeMatchRow = {
  readonly caseResult: z.infer<typeof EvalCaseReportSchema>
  readonly match: z.infer<typeof EvalCaseReportSchema>['matchedFindings'][number]
  readonly reason: string
}

const formatEvalSummarySemanticJudgeMatchRow = (
  row: EvalSummarySemanticJudgeMatchRow
): string =>
  `| ${escapeMarkdownCell(row.caseResult.caseId)} | ${escapeMarkdownCell(row.match.findingId)} | ${escapeMarkdownCell(expectedLabelForMatch(row.caseResult, row.match.expectedIndex))} | ${escapeMarkdownCell(row.reason)} |`

export const appendEvalSummarySemanticJudgeMatches = (
  lines: string[],
  report: EvalReport
): void => {
  // Every match is a judge decision, so `semanticReason` is always present.
  const semanticJudgeMatches = report.caseResults.flatMap((caseResult) =>
    [...caseResult.matchedFindings, ...caseResult.artifactOnlyMatchedFindings].map(
      (match) => ({ caseResult, match, reason: match.semanticReason })
    )
  )

  appendMarkdownTable(lines, {
    heading: '## Semantic Judge Matches',
    header: '| Case | Finding | Expected | Reason |',
    alignment: '| --- | --- | --- | --- |',
    rows: semanticJudgeMatches.map(formatEvalSummarySemanticJudgeMatchRow)
  })
}
