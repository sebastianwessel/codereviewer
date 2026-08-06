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
import { appendEvalComparisonPairedRecall } from './eval-comparison-paired-recall-rendering.js'
import { metricComparability } from './eval-metrics-versions.js'
import { pairedRecallVerdict } from './eval-paired-recall-verdict.js'
import { type EvalComparisonReport } from './eval-comparison-view.js'

// Stated before any number, because it decides which of the numbers below may be
// read as a difference at all.
const appendEvalComparisonScoringRules = (
  lines: string[],
  input: {
    readonly base: EvalComparisonReport
    readonly head: EvalComparisonReport
    readonly baseLabel: string
    readonly headLabel: string
    readonly comparability: ReturnType<typeof metricComparability>
  }
): void => {
  lines.push('## Scoring Rules')
  lines.push('')
  lines.push('| Report | Metrics version |')
  lines.push('| --- | --- |')
  lines.push(`| Base | ${input.base.metricsVersion} |`)
  lines.push(`| Head | ${input.head.metricsVersion} |`)
  lines.push('')

  const { divergence } = input.comparability

  if (divergence.kind === 'same') {
    return
  }

  if (divergence.kind === 'all') {
    lines.push(
      `Warning: NO metric may be compared across these reports -- ${divergence.reason}. Every delta below reads "not comparable".`
    )
    lines.push('')
    return
  }

  lines.push(
    `Warning: ${divergence.reason}. These metrics are not comparable and their deltas are suppressed: ${[
      ...divergence.affected
    ]
      .sort((left, right) => left.localeCompare(right))
      .join(', ')}. Every other metric is unaffected by the change and is compared normally.`
  )
  lines.push('')
}

export const renderEvalComparison = (
  input: {
    readonly base: EvalComparisonReport
    readonly head: EvalComparisonReport
    readonly baseLabel?: string
    readonly headLabel?: string
  }
): string => {
  const baseLabel = input.baseLabel ?? 'base'
  const headLabel = input.headLabel ?? 'head'

  // Refuse to diff runs whose SHARED cases were scored against different
  // expectations. This one is fatal and stays fatal: when the answer key moved
  // underneath the comparison, no metric on either side means what it says, so
  // there is nothing honest left to render. It is the incident that produced an
  // archived run still advertising 78.8% recall against a key that had since
  // changed. A different case SELECTION is not this -- comparing a filtered run
  // against a full one is ordinary work, warned about further down.
  const divergedCases = casesWithDivergedAnswerKeys(
    input.base.provenance?.answerKeyDigestByCase ?? {},
    input.head.provenance?.answerKeyDigestByCase ?? {}
  )

  if (divergedCases.length > 0) {
    throw new Error(
      `Refusing to compare evaluation runs whose shared cases were scored against different expectations: ${divergedCases.join(', ')}. Re-run both sides against the current answer key before comparing.`
    )
  }

  // A metrics-version difference is NOT fatal, and used to be. Refusing the
  // whole report made the honest partial comparison impossible: the 2026-08-03
  // bump changes which findings are credited unlisted-real and therefore moves
  // exactly three metrics, while recall, raw precision, line placement and
  // severity accuracy are untouched. Comparability is per metric, derived from
  // the declared scoring-rule history, and every refused metric says so where it
  // would otherwise have printed a number.
  const comparability = metricComparability(
    input.base.metricsVersion,
    input.head.metricsVersion
  )
  const comparisonInput = {
    base: input.base,
    head: input.head,
    comparability
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
  appendEvalComparisonScoringRules(lines, {
    baseLabel,
    headLabel,
    ...comparisonInput
  })
  appendEvalComparisonGate(lines, comparisonInput)
  appendEvalComparisonSelection(lines, selection)
  appendEvalComparisonPairedRecall(
    lines,
    pairedRecallVerdict({
      base: input.base,
      head: input.head,
      baseLabel,
      headLabel,
      comparability
    })
  )
  appendEvalComparisonMetricDeltas(lines, comparisonInput)

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
    const groupInput = {
      pairs: metricGroupPairs,
      reports: { base: input.base, head: input.head },
      comparability
    }
    appendMetricGroupQualityDeltas(lines, groupInput)
    appendMetricGroupResourceDeltas(lines, groupInput)
    appendMetricGroupProofLoopDeltas(lines, groupInput)
  }

  appendEvalComparisonCaseTransitions(lines, {
    caseIds,
    baseStatus,
    headStatus
  })

  return lines.join('\n')
}
