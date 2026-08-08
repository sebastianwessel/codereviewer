import { z } from 'zod'
import {
  appendMarkdownBulletSection,
  appendMarkdownTable,
  escapeMarkdownCell
} from '../eval-report-markdown-formatting.js'
import { caseStatus, providerIssueLabel } from '../eval-report-case-labels.js'
import { EvalCaseReportSchema, type EvalReport } from '../../report/eval-report-contracts.js'

export const appendEvalSummaryGateReasons = (
  lines: string[],
  report: EvalReport
): void => {
  appendMarkdownBulletSection(lines, {
    heading: '## Gate Reasons',
    rows: report.regressionGate.reasons.map((reason) => `- ${reason}`)
  })
  // Its own section, never merged into "Gate Reasons": a threshold the gate
  // could not evaluate is not a threshold the run breached, and a reader must be
  // able to tell "under budget" from "budget not evaluable" at a glance.
  appendMarkdownBulletSection(lines, {
    heading: '## Gate Thresholds Not Evaluable',
    rows: report.regressionGate.notEvaluableReasons.map(
      (reason) => `- ${reason}`
    )
  })
}

const formatEvalSummaryProviderIssueRow = (
  caseResult: z.infer<typeof EvalCaseReportSchema>
): string =>
  `| ${escapeMarkdownCell(caseResult.caseId)} | ${caseStatus(caseResult)} | ${escapeMarkdownCell(providerIssueLabel(caseResult))} |`

export const appendEvalSummaryProviderIssues = (
  lines: string[],
  report: EvalReport
): void => {
  const providerIssueCases = report.caseResults.filter(
    (caseResult) => caseResult.providerIssues.length > 0
  )

  appendMarkdownTable(lines, {
    heading: '## Provider Issues',
    header: '| Case | Status | Provider issue |',
    alignment: '| --- | --- | --- |',
    rows: providerIssueCases.map(formatEvalSummaryProviderIssueRow)
  })
}
