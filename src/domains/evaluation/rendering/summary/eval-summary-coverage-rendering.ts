import { z } from 'zod'
import {
  appendMarkdownTable,
  escapeMarkdownCell
} from '../eval-report-markdown-formatting.js'
import {
  agenticStageLabel,
  contextLedgerConsideredCount,
  contextLedgerKindLabel,
  contextLedgerTruncatedCount
} from '../eval-report-case-labels.js'
import { EvalCaseReportSchema, type EvalReport } from '../../report/eval-report-contracts.js'

const formatEvalSummaryAgenticStageRow = (
  caseResult: z.infer<typeof EvalCaseReportSchema>
): string =>
  [
    '|',
    escapeMarkdownCell(caseResult.caseId),
    '|',
    agenticStageLabel(caseResult, 'refutation'),
    '|',
    agenticStageLabel(caseResult, 'fix'),
    '|',
    agenticStageLabel(caseResult, 'provider-recovery'),
    '|'
  ].join(' ')

export const appendEvalSummaryAgenticStageCoverage = (
  lines: string[],
  report: EvalReport
): void => {
  appendMarkdownTable(lines, {
    heading: '## Agentic Stage Coverage',
    header: '| Case | Refutation | Fix | Provider recovery |',
    alignment: '| --- | --- | --- | --- |',
    rows: report.caseResults
      .filter((caseResult) => (caseResult.agenticStages ?? []).length > 0)
      .map(formatEvalSummaryAgenticStageRow)
  })
}

const formatEvalSummaryContextLedgerRow = (
  caseResult: z.infer<typeof EvalCaseReportSchema>
): string =>
  `| ${escapeMarkdownCell(caseResult.caseId)} | ${escapeMarkdownCell(contextLedgerKindLabel(caseResult))} | ${contextLedgerConsideredCount(caseResult)} | ${contextLedgerTruncatedCount(caseResult)} |`

export const appendEvalSummaryContextLedgerKinds = (
  lines: string[],
  report: EvalReport
): void => {
  appendMarkdownTable(lines, {
    heading: '## Context Ledger Kinds',
    header: '| Case | Kinds | Considered | Truncated |',
    alignment: '| --- | --- | ---: | ---: |',
    rows: report.caseResults
      .filter((caseResult) => caseResult.contextLedger.length > 0)
      .map(formatEvalSummaryContextLedgerRow)
  })
}
