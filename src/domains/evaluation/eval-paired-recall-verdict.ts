import {
  collectArmOutcomes,
  compareArms,
  type PairedComparison,
  type PairedScoredRun
} from './eval-significance.js'
import { type EvalComparisonReport } from './eval-comparison-view.js'
import { type MetricComparability } from './eval-metrics-versions.js'

// THE PRIMARY VERDICT FOR A RECALL DIFFERENCE.
//
// Run-level mean ± standard deviation over three seeds is a weak instrument. An
// sd from n=3 is barely an estimate: the two most recent figures on this corpus
// (0.96pp and 2.89pp) carry 95% intervals of roughly [0.50, 6.04] and
// [1.50, 18.17], which overlap almost entirely. Deciding a few-point recall
// difference with that is deciding it with noise.
//
// The sharper instrument was already built and simply was not wired in. Both
// arms score the SAME expectations, so pairing on the expectation removes the
// between-run variance the arms share, and the discordant pairs -- expectations
// one arm found and the other missed -- carry all the information. That is
// McNemar's test, and it needs no extra provider spend because the per-
// expectation outcome is already in every report.
//
// So the paired test is what `eval compare` reports as the verdict for recall.
// Run-level deltas stay in the report as context, not as the decision rule.

// Conventional two-sided threshold. It is a reporting convention, not a decision
// on its own: this project's own rule (docs/05-quality/comparing-runs.md) also
// requires precision not to degrade and the cost to be defensible.
export const PAIRED_SIGNIFICANCE_ALPHA = 0.05

export type PairedRecallVerdict =
  | {
      readonly status: 'unavailable'
      readonly reason: string
    }
  | {
      readonly status: 'available'
      readonly comparison: PairedComparison
      readonly significant: boolean
      readonly direction: 'improved' | 'regressed' | 'unchanged'
    }

// A run can only take part if it recorded, for every case, both the expectations
// it scored and the matches it made. Absence is refused rather than read as an
// empty set: an arm silently missing its expectations would score 0% recall and
// look like a catastrophic regression.
const expectationIndexes = (
  findings: readonly { readonly expectedIndex?: number | undefined }[]
): readonly { readonly expectedIndex: number }[] | undefined => {
  const indexes: { readonly expectedIndex: number }[] = []

  for (const finding of findings) {
    if (finding.expectedIndex === undefined) {
      return undefined
    }

    indexes.push({ expectedIndex: finding.expectedIndex })
  }

  return indexes
}

const asPairedScoredRun = (
  report: EvalComparisonReport,
  label: string
): PairedScoredRun | string => {
  const caseResults = report.caseResults

  if (caseResults === undefined) {
    return `${label} records no case results`
  }

  const runCases: PairedScoredRun['caseResults'][number][] = []

  for (const caseResult of caseResults) {
    const { expectedFindings, matchedFindings } = caseResult

    if (expectedFindings === undefined || matchedFindings === undefined) {
      return `${label} case ${caseResult.caseId} does not record its expected or matched findings`
    }

    const expected = expectationIndexes(expectedFindings)
    const matched = expectationIndexes(matchedFindings)

    if (expected === undefined || matched === undefined) {
      return `${label} case ${caseResult.caseId} records a finding without an expectation index`
    }

    runCases.push({
      caseId: caseResult.caseId,
      expectedFindings: expected,
      matchedFindings: matched
    })
  }

  return {
    metricsVersion: report.metricsVersion,
    // Only ever read by the pooling guard, which is vacuous for a single-run
    // arm. Cross-run answer-key divergence is caught by the comparison's own
    // per-case digest refusal before this module is reached.
    provenance: {
      answerKeyDigest: report.provenance?.answerKeyDigest ?? 'unrecorded'
    },
    caseResults: runCases
  }
}

export const pairedRecallVerdict = (
  input: {
    readonly base: EvalComparisonReport
    readonly head: EvalComparisonReport
    readonly baseLabel: string
    readonly headLabel: string
    readonly comparability: MetricComparability
  }
): PairedRecallVerdict => {
  const recallRefusal = input.comparability.refusalReason('recall')

  if (recallRefusal !== undefined) {
    return {
      status: 'unavailable',
      reason: `recall is not comparable across these reports: ${recallRefusal}`
    }
  }

  const base = asPairedScoredRun(input.base, input.baseLabel)
  const head = asPairedScoredRun(input.head, input.headLabel)

  if (typeof base === 'string') {
    return { status: 'unavailable', reason: base }
  }

  if (typeof head === 'string') {
    return { status: 'unavailable', reason: head }
  }

  const comparison = compareArms(
    collectArmOutcomes([base]),
    collectArmOutcomes([head])
  )

  if (comparison.expectationCount === 0) {
    return {
      status: 'unavailable',
      reason: 'the two reports share no expectation, so nothing can be paired'
    }
  }

  return {
    status: 'available',
    comparison,
    significant:
      comparison.pValue !== undefined &&
      comparison.pValue < PAIRED_SIGNIFICANCE_ALPHA,
    direction:
      comparison.delta > 0
        ? 'improved'
        : comparison.delta < 0
          ? 'regressed'
          : 'unchanged'
  }
}
