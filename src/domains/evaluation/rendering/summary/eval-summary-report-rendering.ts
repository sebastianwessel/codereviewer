import { type EvalCase } from '../../corpus/eval-fixture.schema.js'
import { appendMarkdownBulletSection } from '../eval-report-markdown-formatting.js'
import { type EvalReport } from '../../report/eval-report-contracts.js'
import {
  appendEvalSummaryHeader,
  appendEvalSummaryHeadline,
  appendEvalSummaryMetrics,
  appendEvalSummaryRejectionsByReasonAndSeverity,
  appendEvalSummarySelection
} from './eval-summary-headline-metrics-rendering.js'
import {
  appendEvalSummaryRecallByDiffScope,
  appendEvalSummaryRecallByTier
} from './eval-summary-tier-diffscope-rendering.js'
import { appendEvalSummaryMetricGroups } from './eval-summary-metric-group-rendering.js'
import {
  appendEvalSummarySecurityByContextDepth,
  appendEvalSummarySecurityByMechanism
} from './eval-summary-security-rendering.js'
import {
  appendEvalSummaryCases,
  appendEvalSummarySemanticJudgeMatches
} from './eval-summary-case-rendering.js'
import {
  appendEvalSummaryAgenticStageCoverage,
  appendEvalSummaryContextLedgerKinds
} from './eval-summary-coverage-rendering.js'
import {
  appendEvalSummaryGateReasons,
  appendEvalSummaryProviderIssues
} from './eval-summary-health-rendering.js'
import { appendEvalSummaryAttentionNeeded } from './eval-summary-attention-rendering.js'

export const EVAL_REPORT_ARTIFACT_NAME = 'eval-report.json'
export const EVAL_SUMMARY_ARTIFACT_NAME = 'eval-summary.md'
export const EVAL_RECALL_REPORT_ARTIFACT_NAME = 'eval-recall-report.md'

const appendEvalSummaryArtifacts = (
  lines: string[],
  artifactRoot: string
): void => {
  appendMarkdownBulletSection(lines, {
    heading: '## Artifacts',
    rows: [
      `- ${artifactRoot}/${EVAL_REPORT_ARTIFACT_NAME}`,
      `- ${artifactRoot}/${EVAL_SUMMARY_ARTIFACT_NAME}`,
      `- ${artifactRoot}/${EVAL_RECALL_REPORT_ARTIFACT_NAME}`
    ]
  })
}

export const renderEvalSummary = (
  input: {
    readonly cases: readonly EvalCase[]
    readonly report: EvalReport
    readonly artifactRoot?: string
  }
): string => {
  const artifactRoot = input.artifactRoot ?? '.codereviewer/eval'
  const lines: string[] = []

  appendEvalSummaryHeader(lines, input.report)
  appendEvalSummaryHeadline(lines, input.report)
  appendEvalSummarySelection(lines, input.report)
  appendEvalSummaryMetrics(lines, input.report)
  appendEvalSummaryRejectionsByReasonAndSeverity(lines, input.report)
  appendEvalSummaryRecallByTier(lines, input.report)
  appendEvalSummaryRecallByDiffScope(lines, input.report)
  appendEvalSummaryMetricGroups(lines, input.report)
  // Per-mechanism security labels are a secondary breakdown (label accuracy is not
  // a headline goal), rendered after the general aggregate metrics.
  appendEvalSummarySecurityByMechanism(lines, input.report)
  appendEvalSummarySecurityByContextDepth(lines, input.report)
  appendEvalSummaryCases(lines, {
    cases: input.cases,
    report: input.report
  })
  appendEvalSummaryAgenticStageCoverage(lines, input.report)
  appendEvalSummaryContextLedgerKinds(lines, input.report)
  appendEvalSummaryGateReasons(lines, input.report)
  appendEvalSummaryProviderIssues(lines, input.report)
  appendEvalSummarySemanticJudgeMatches(lines, input.report)
  appendEvalSummaryAttentionNeeded(lines, {
    cases: input.cases,
    report: input.report
  })

  appendEvalSummaryArtifacts(lines, artifactRoot)

  return `${lines.join('\n')}`
}
