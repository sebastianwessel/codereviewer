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
import {
  type EvalComparisonReport,
  type EvalComparisonRun
} from './eval-comparison-view.js'

// An arm is a SET of runs. Within one arm every run must have been scored by the
// same rules against the same answer key, for the same reason the significance
// module refuses to pool across either: the runs share a per-expectation
// denominator, so a heterogeneous arm computes a rate over a population that
// never existed. Across ARMS both differences are legitimate and handled
// elsewhere -- comparing two scoring versions is exactly what `## Scoring Rules`
// is for.
const armMetricsVersion = (
  runs: readonly EvalComparisonRun[],
  armLabel: string
): string => {
  const versions = [...new Set(runs.map((run) => run.report.metricsVersion))]

  if (versions.length > 1) {
    throw new Error(
      `Refusing to compare: the ${armLabel} arm mixes scoring rules across its runs (metrics versions ${versions.sort().join(', ')}). Every run in one arm must have been scored by the same rules.`
    )
  }

  return versions[0] ?? 'unrecorded'
}

// Stated before any number, because it decides which of the numbers below may be
// read as a difference at all.
const appendEvalComparisonScoringRules = (
  lines: string[],
  input: {
    readonly base: readonly EvalComparisonRun[]
    readonly head: readonly EvalComparisonRun[]
    readonly comparability: ReturnType<typeof metricComparability>
  }
): void => {
  lines.push('## Scoring Rules')
  lines.push('')
  lines.push('| Arm | Report | Metrics version |')
  lines.push('| --- | --- | --- |')

  for (const [armLabel, runs] of [
    ['Base', input.base],
    ['Head', input.head]
  ] as const) {
    for (const run of runs) {
      lines.push(`| ${armLabel} | ${run.label} | ${run.report.metricsVersion} |`)
    }
  }

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

// Every base run against every head run, so a divergence hiding in the third
// run of an arm is found rather than missed by only checking one representative.
const divergedCasesAcrossArms = (
  base: readonly EvalComparisonRun[],
  head: readonly EvalComparisonRun[]
): readonly string[] => {
  const diverged = new Set<string>()

  for (const baseRun of base) {
    for (const headRun of head) {
      for (const caseId of casesWithDivergedAnswerKeys(
        baseRun.report.provenance?.answerKeyDigestByCase ?? {},
        headRun.report.provenance?.answerKeyDigestByCase ?? {}
      )) {
        diverged.add(caseId)
      }
    }
  }

  return [...diverged].sort((left, right) => left.localeCompare(right))
}

// Run-level context sections read ONE report per side. With several runs per arm
// there is no single report to read: averaging them would publish numbers no run
// produced, and picking one would be an arbitrary choice presented as a result.
// The paired verdict above needs neither, because it adjudicates per expectation
// across every run.
const appendMultiRunContextNotice = (
  lines: string[],
  input: {
    readonly base: readonly EvalComparisonRun[]
    readonly head: readonly EvalComparisonRun[]
  }
): void => {
  lines.push('## Run-Level Context')
  lines.push('')
  lines.push(
    `Omitted: the base arm holds ${input.base.length} run(s) and the head arm ${input.head.length}. Gate status, selection status, metric deltas, context-ledger and agentic-stage counts, metric-group deltas and case transitions are per-report views. This command does not average reports, and reading one run per arm would present an arbitrary choice as a result. Compare a single run per arm to see them, or read the paired verdict above, which uses every run.`
  )
  lines.push('')
}

// Everything below the verdict: context for a difference the verdict has already
// adjudicated, never the decision rule for one.
const appendRunLevelContext = (
  lines: string[],
  input: {
    readonly base: EvalComparisonReport
    readonly head: EvalComparisonReport
    readonly comparability: ReturnType<typeof metricComparability>
  }
): void => {
  const baseStatus = caseStatusById(input.base)
  const headStatus = caseStatusById(input.head)
  const caseIds = [...new Set([...baseStatus.keys(), ...headStatus.keys()])].sort(
    (left, right) => left.localeCompare(right)
  )

  appendEvalComparisonGate(lines, input)
  appendEvalComparisonSelection(
    lines,
    selectionStatus({ base: input.base, head: input.head })
  )
  appendEvalComparisonMetricDeltas(lines, input)
  appendContextLedgerKindDeltas(lines, {
    base: contextLedgerKindCounts(input.base),
    head: contextLedgerKindCounts(input.head)
  })
  appendAgenticStageDeltas(lines, {
    base: agenticStageCounts(input.base),
    head: agenticStageCounts(input.head)
  })

  const metricGroupPairs = comparableMetricGroups({
    base: input.base,
    head: input.head
  })

  appendMetricGroupCoverageDeltas(
    lines,
    metricGroupCoverageDeltas({ base: input.base, head: input.head })
  )

  if (metricGroupPairs.length > 0) {
    const groupInput = {
      pairs: metricGroupPairs,
      reports: { base: input.base, head: input.head },
      comparability: input.comparability
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
}

export const renderEvalComparison = (
  input: {
    readonly base: readonly EvalComparisonRun[]
    readonly head: readonly EvalComparisonRun[]
  }
): string => {
  if (input.base.length === 0 || input.head.length === 0) {
    throw new Error(
      'Refusing to compare: each arm needs at least one report.'
    )
  }

  // Refuse to diff runs whose SHARED cases were scored against different
  // expectations. This one is fatal and stays fatal: when the answer key moved
  // underneath the comparison, no metric on either side means what it says, so
  // there is nothing honest left to render. It is the incident that produced an
  // archived run still advertising 78.8% recall against a key that had since
  // changed. A different case SELECTION is not this -- comparing a filtered run
  // against a full one is ordinary work, warned about further down.
  const divergedCases = divergedCasesAcrossArms(input.base, input.head)

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
    armMetricsVersion(input.base, 'base'),
    armMetricsVersion(input.head, 'head')
  )
  const lines: string[] = []

  lines.push('# Evaluation Comparison')
  lines.push('')
  lines.push(`Base: ${input.base.map((run) => run.label).join(', ')}`)
  lines.push(`Head: ${input.head.map((run) => run.label).join(', ')}`)
  lines.push('')
  appendEvalComparisonScoringRules(lines, {
    base: input.base,
    head: input.head,
    comparability
  })
  appendEvalComparisonPairedRecall(
    lines,
    pairedRecallVerdict({
      base: input.base,
      head: input.head,
      comparability
    })
  )

  const singleBase = input.base.length === 1 ? input.base[0] : undefined
  const singleHead = input.head.length === 1 ? input.head[0] : undefined

  if (singleBase === undefined || singleHead === undefined) {
    appendMultiRunContextNotice(lines, input)

    return lines.join('\n')
  }

  appendRunLevelContext(lines, {
    base: singleBase.report,
    head: singleHead.report,
    comparability
  })

  return lines.join('\n')
}
