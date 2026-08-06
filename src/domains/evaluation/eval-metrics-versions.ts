import { type EvalMetrics } from './metrics.js'

// WHICH METRICS SURVIVE A SCORING-RULE CHANGE.
//
// `metricsVersion` records the rules a report's numbers were computed under. A
// bump means identical review output would produce different numbers -- but a
// bump almost never touches EVERY number. The 2026-08-03 window fix, for
// instance, changes which unmatched findings are credited unlisted-real and so
// moves exactly `adjustedPrecision`, `unlistedRealFindingCount` and
// `genuineFalsePositiveCount`; it cannot touch `recall`, raw `precision`, line
// placement or severity accuracy, because none of those read a plausibility
// verdict.
//
// Treating the version as all-or-nothing therefore destroyed the honest partial
// comparison: a maintainer who wanted to know whether recall moved across an
// engine change was told to re-run both sides, which for an expensive corpus
// means the comparison simply does not happen. This module makes per-metric
// comparability a derived property of the version metadata instead: each entry
// declares what it changed, and the affected set for any two versions is the
// union of the entries between them.
//
// THE FALLBACK IS ALWAYS "NOTHING IS COMPARABLE". An entry whose blast radius
// is not known declares `'all'`, and a version id absent from this history
// (a future build read by an older engine, or a report predating versioning)
// also yields `'all'`. Guessing narrow would publish a delta measured across a
// ruler change, which is the failure this whole mechanism exists to prevent.

// Keys comparability is expressed over: every metric in the report contract,
// plus the non-metric report dimensions a comparison can render. `discovery`
// is such a dimension -- it lives on `caseResults[].discovery`, not in
// `EvalMetrics`, but it is recorded per run and a bump can make it
// unrecoverable exactly like a metric.
export type EvalComparabilityKey = keyof EvalMetrics | 'discovery'

type MetricsVersionEntry = {
  readonly id: string
  // Metrics this version changed for IDENTICAL review output, or `'all'` when
  // the change was broad enough that no metric can be assumed to survive it.
  readonly affects: 'all' | readonly EvalComparabilityKey[]
  readonly note: string
}

// Ordered oldest to newest. Every id this repository has ever written into a
// report appears here; the ordering is what lets the affected set be computed
// for any pair, not only for adjacent versions.
export const EVAL_METRICS_VERSION_HISTORY: readonly MetricsVersionEntry[] = [
  {
    id: 'pre-2026-07-26',
    affects: 'all',
    note: 'Sentinel for reports written before scoring rules were versioned at all; nothing is known about how their numbers were computed.'
  },
  {
    id: '2026-07-26.max-cardinality-matching',
    affects: 'all',
    note: 'Expectation-to-finding assignment became maximum-cardinality rather than first-acceptable, and the model category taxonomy was unified (race and deadlock resolve to bug), which shifts tier resolution. Both change WHICH expectations match, so no match-derived metric survives the boundary.'
  },
  {
    id: '2026-07-27.plausibility-restatement-collapse',
    affects: [
      'adjustedPrecision',
      'unlistedRealFindingCount',
      'genuineFalsePositiveCount'
    ],
    note: 'The plausibility judge stopped crediting a finding that merely restates a defect already counted in the same file. It reclassifies unmatched findings only, so it moves the unlisted-real/genuine-false-positive split and the precision upper bound, and nothing else.'
  },
  {
    id: '2026-07-31.diff-scope-recall',
    affects: ['recallByDiffScope', 'diffScopeCounts'],
    note: 'Per-expectation diff scope was added. An older report carries no classification, so it reads back as entirely `undetermined` and its in/out-of-diff figures are absent rather than zero. Blended `recall` is unchanged by the addition.'
  },
  {
    id: '2026-07-31.no-trusted-rule-metric',
    affects: [],
    note: 'Removed `trustedDeterministicFindingCount`, a permanently-zero metric with no producer, together with the admission carve-outs it justified. The removed metric is not part of the current contract, and no surviving metric changed how it is computed; the carve-out removal changes review OUTPUT, which is the engine change a comparison exists to measure.'
  },
  {
    id: '2026-08-01.discovery-telemetry',
    affects: ['discovery'],
    note: 'Per-case discovery counters began being recorded. A report saved earlier cannot recover them -- the run is over and its debug log was off -- so pooling one would read "no discovery calls" where the truth is "not recorded". No `EvalMetrics` value changed.'
  },
  {
    id: '2026-08-03.plausibility-source-window',
    affects: [
      'adjustedPrecision',
      'unlistedRealFindingCount',
      'genuineFalsePositiveCount'
    ],
    note: 'The plausibility judge stopped being shown a blind prefix of an oversized file and now fails closed when the window cannot hold the cited line. For identical review output this changes which findings are credited unlisted-real, hence the precision upper bound and the two counts behind it.'
  }
]

// The rules the current build scores under: the newest declared entry. Deriving
// it from the history rather than declaring it twice is what stops a bump from
// landing without a recorded blast radius.
const latestEntry = EVAL_METRICS_VERSION_HISTORY.at(-1)

if (latestEntry === undefined) {
  throw new Error('The evaluation metrics-version history must not be empty.')
}

export const EVAL_METRICS_VERSION = latestEntry.id

export type MetricsVersionDivergence =
  | { readonly kind: 'same' }
  | {
      // No metric may be compared. Either a version id is not in the declared
      // history, or a version between the two declared an unbounded change.
      readonly kind: 'all'
      readonly reason: string
    }
  | {
      readonly kind: 'partial'
      readonly affected: ReadonlySet<EvalComparabilityKey>
      readonly reason: string
    }

const indexOfVersion = (id: string): number =>
  EVAL_METRICS_VERSION_HISTORY.findIndex((entry) => entry.id === id)

// Metrics that cannot be compared between two reports scored under `baseId` and
// `headId`. Order-insensitive: comparing an older head against a newer base
// crosses the same boundaries.
export const metricsAffectedBetween = (
  baseId: string,
  headId: string
): MetricsVersionDivergence => {
  if (baseId === headId) {
    return { kind: 'same' }
  }

  const baseIndex = indexOfVersion(baseId)
  const headIndex = indexOfVersion(headId)

  if (baseIndex === -1 || headIndex === -1) {
    const unknownIds = [
      ...(baseIndex === -1 ? [baseId] : []),
      ...(headIndex === -1 ? [headId] : [])
    ]

    return {
      kind: 'all',
      reason: `metrics version ${unknownIds.join(' and ')} is not in the declared scoring-rule history, so nothing is known about what it changed`
    }
  }

  const lowerIndex = Math.min(baseIndex, headIndex)
  const upperIndex = Math.max(baseIndex, headIndex)
  const crossed = EVAL_METRICS_VERSION_HISTORY.slice(lowerIndex + 1, upperIndex + 1)
  const unbounded = crossed.find((entry) => entry.affects === 'all')

  if (unbounded !== undefined) {
    return {
      kind: 'all',
      reason: `scoring rules changed in ${unbounded.id}: ${unbounded.note}`
    }
  }

  const affected = new Set<EvalComparabilityKey>()

  for (const entry of crossed) {
    if (entry.affects === 'all') {
      continue
    }

    for (const key of entry.affects) {
      affected.add(key)
    }
  }

  return {
    kind: 'partial',
    affected,
    reason: `scoring rules changed between ${baseId} and ${headId} (${crossed
      .map((entry) => entry.id)
      .join(', ')})`
  }
}

export type MetricComparability = {
  readonly divergence: MetricsVersionDivergence
  // The reason this key may not be compared, or `undefined` when it may.
  readonly refusalReason: (key: EvalComparabilityKey) => string | undefined
  readonly refusedKeys: (
    keys: readonly EvalComparabilityKey[]
  ) => readonly EvalComparabilityKey[]
}

export const metricComparability = (
  baseVersion: string,
  headVersion: string
): MetricComparability => {
  const divergence = metricsAffectedBetween(baseVersion, headVersion)
  const refusalReason = (key: EvalComparabilityKey): string | undefined => {
    if (divergence.kind === 'same') {
      return undefined
    }

    if (divergence.kind === 'all') {
      return divergence.reason
    }

    return divergence.affected.has(key) ? divergence.reason : undefined
  }

  return {
    divergence,
    refusalReason,
    refusedKeys: (keys) => keys.filter((key) => refusalReason(key) !== undefined)
  }
}
