import { casesWithDivergedAnswerKeys } from './eval-report-provenance.js'
import {
  appendEvalComparisonGate,
  appendEvalComparisonSelection,
  selectionStatus
} from './eval-comparison-gate-selection-rendering.js'
import {
  appendEvalComparisonCaseTransitions,
  caseStatusById
} from './eval-comparison-case-transition-rendering.js'
import {
  appendMetricGroupCoverageDeltas,
  appendMetricGroupProofLoopDeltas,
  appendMetricGroupQualityDeltas,
  appendMetricGroupResourceDeltas,
  comparableMetricGroups,
  metricGroupCoverageDeltas
} from './eval-comparison-metric-group-rendering.js'
import { appendEvalComparisonMetricDeltas } from './eval-comparison-aggregate-metric-rendering.js'
import {
  agenticStageCounts,
  appendAgenticStageDeltas,
  appendContextLedgerKindDeltas,
  contextLedgerKindCounts
} from './eval-comparison-context-stage-rendering.js'
import { type EvalReport } from './eval-report-contracts.js'

export const renderEvalComparison = (
  input: {
    readonly base: EvalReport
    readonly head: EvalReport
    readonly baseLabel?: string
    readonly headLabel?: string
  }
): string => {
  const baseLabel = input.baseLabel ?? 'base'
  const headLabel = input.headLabel ?? 'head'

  // Refuse to diff runs scored by different rules. A metrics-version change
  // means identical review output would produce different numbers, so a delta
  // across the boundary measures the scoring change rather than the engine --
  // and it looks exactly like a real regression or win. Failing loudly is the
  // only safe behaviour: this repository has already published a result that was
  // scored against a stale answer key, and nothing in the artifact revealed it.
  if (input.base.metricsVersion !== input.head.metricsVersion) {
    throw new Error(
      `Refusing to compare evaluation runs scored by different rules: ${baseLabel} used metrics version "${input.base.metricsVersion}" and ${headLabel} used "${input.head.metricsVersion}". Re-run both sides with the current build before comparing.`
    )
  }

  // Refuse the same way across a differing answer-key digest. A metrics-version
  // match only proves the two runs computed metrics the same WAY; it says
  // nothing about whether they were scored against the same WHAT. Diffing two
  // reports whose expected-finding content differs looks exactly like a real
  // regression or win, and this project has already published a recall figure
  // (78.8%) that was silently scored against an answer key that had since
  // changed underneath it -- the exact class of failure this guards against,
  // reusing the metricsVersion guard above rather than inventing a second
  // comparability check.
  // Refuse only when the cases BOTH runs scored were scored against different
  // expectations. A different case selection also changes the aggregate digest,
  // but comparing a filtered run against a full one is ordinary work that this
  // report already warns about further down -- refusing it too would make the
  // guard blunt enough that someone would reasonably delete it. What must never
  // pass silently is the shared cases having moved underneath the comparison,
  // which is what produced an archived run still advertising 78.8% recall
  // against an answer key that had since changed.
  const divergedCases = casesWithDivergedAnswerKeys(
    input.base.provenance.answerKeyDigestByCase,
    input.head.provenance.answerKeyDigestByCase
  )

  if (divergedCases.length > 0) {
    throw new Error(
      `Refusing to compare evaluation runs whose shared cases were scored against different expectations: ${divergedCases.join(', ')}. Re-run both sides against the current answer key before comparing.`
    )
  }
  const baseStatus = caseStatusById(input.base)
  const headStatus = caseStatusById(input.head)
  const selection = selectionStatus({
    base: input.base,
    head: input.head
  })
  const caseIds = [...new Set([...baseStatus.keys(), ...headStatus.keys()])].sort(
    (left, right) => left.localeCompare(right)
  )
  const lines: string[] = []

  lines.push('# Evaluation Comparison')
  lines.push('')
  lines.push(`Base: ${baseLabel}`)
  lines.push(`Head: ${headLabel}`)
  lines.push('')
  appendEvalComparisonGate(lines, input)
  appendEvalComparisonSelection(lines, selection)
  appendEvalComparisonMetricDeltas(lines, input)

  const baseContextKindCounts = contextLedgerKindCounts(input.base)
  const headContextKindCounts = contextLedgerKindCounts(input.head)
  appendContextLedgerKindDeltas(lines, {
    base: baseContextKindCounts,
    head: headContextKindCounts
  })

  const baseStageCounts = agenticStageCounts(input.base)
  const headStageCounts = agenticStageCounts(input.head)
  appendAgenticStageDeltas(lines, {
    base: baseStageCounts,
    head: headStageCounts
  })

  const metricGroupPairs = comparableMetricGroups({
    base: input.base,
    head: input.head
  })
  const metricGroupCoverage = metricGroupCoverageDeltas({
    base: input.base,
    head: input.head
  })

  appendMetricGroupCoverageDeltas(lines, metricGroupCoverage)

  if (metricGroupPairs.length > 0) {
    appendMetricGroupQualityDeltas(lines, metricGroupPairs)
    appendMetricGroupResourceDeltas(lines, metricGroupPairs)
    appendMetricGroupProofLoopDeltas(lines, metricGroupPairs)
  }

  appendEvalComparisonCaseTransitions(lines, {
    caseIds,
    baseStatus,
    headStatus
  })

  return lines.join('\n')
}
