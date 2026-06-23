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
