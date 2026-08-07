import {
  createMetricsVersionHistory,
  type MetricComparabilityOf,
  type MetricsVersionDivergenceOf,
  type MetricsVersionEntry
} from './metrics-version-history.js'
import { type EvalMetrics } from '../../scoring/metrics.js'

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
//
// The DERIVATION lives in `metrics-version-history.ts`, generic over the key
// type, because the change-impact corpus (spec 22) needs the same discipline
// over a different metric set. This file declares the diff reviewer's history
// and nothing else. The two histories are deliberately separate: a bump to the
// diff reviewer's matching rules says nothing about a change-impact figure, and
// a shared history would make every bump on either side refuse comparisons on
// the other.

// Keys comparability is expressed over: every metric in the report contract,
// plus the non-metric report dimensions a comparison can render. `discovery`
// is such a dimension -- it lives on `caseResults[].discovery`, not in
// `EvalMetrics`, but it is recorded per run and a bump can make it
// unrecoverable exactly like a metric.
export type EvalComparabilityKey = keyof EvalMetrics | 'discovery'

export type MetricsVersionDivergence =
  MetricsVersionDivergenceOf<EvalComparabilityKey>
export type MetricComparability = MetricComparabilityOf<EvalComparabilityKey>

// Ordered oldest to newest. Every id this repository has ever written into a
// report appears here; the ordering is what lets the affected set be computed
// for any pair, not only for adjacent versions.
export const EVAL_METRICS_VERSION_HISTORY: readonly MetricsVersionEntry<EvalComparabilityKey>[] =
  [
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
    },
    {
      id: '2026-08-06.unmeasured-case-cost-and-duration',
      affects: ['costUnavailableCount', 'durationUnavailableCount'],
      note: 'A provider-errored case stopped being scored as costing exactly $0.00 for 0ms. Its cost and duration were never measured -- the call failed before any usage or timing was surfaced -- so it is now counted as unavailable instead of contributing a confident zero. `costUnavailableCount` therefore counts a strictly larger population than before and is not comparable across this boundary; `durationUnavailableCount` did not exist earlier and reads as absent rather than 0. `costUsd` and `durationMs` are unaffected: the cases now excluded from those sums contributed 0 to them before.'
    },
    {
      id: '2026-08-06.unmeasured-case-token-usage',
      affects: ['usageUnavailableCount'],
      note: 'The same fix applied to token usage: a case that surfaced no usage record (a provider-errored case, or a provider run whose usage never arrived) no longer contributes 0 input/cached/output tokens. `usageUnavailableCount` is new and reads as absent rather than 0 in any earlier report, so nothing is known about that population before this boundary. `inputTokens`, `cachedInputTokens` and `outputTokens` are declared unaffected for a reason a reader should not have to infer: their VALUES are identical for identical engine output, because every case now excluded from the sums contributed exactly 0 to it before. The gate change that landed with this entry -- `regressionGate` gaining a third `not-evaluable` outcome when `maxCostUsd`/`maxDurationMs` is compared against a known-only total -- affects no metric at all: it changes what the run REPORTS about itself, not what any metric computes, so it is deliberately absent from `affects` rather than declared `all`.'
    },
    {
      id: '2026-08-07.open-redirect-mechanism',
      affects: [
        'securityAdjustedPrecisionByMechanism',
        'securityFindingMechanismCounts'
      ],
      note: 'The security mechanism vocabulary gained `open-redirect` (CWE-601), and CWE-601 stopped resolving to `ssrf`. The REMAP is the part that changes a number: an unmatched genuine security false positive tagged CWE-601 used to land in the `ssrf` precision denominator and now lands in `open-redirect`, so for identical engine output the two per-mechanism precision structures differ and neither may be compared across this boundary. Everything else is declared unaffected deliberately rather than by omission. `securityRecallByMechanism` and `securityMechanismCounts` gain a key whose value is 0 and {expected: 0, matched: 0}: they are computed from expectation labels only, no committed expectation carries the new label, and a new empty row changes no existing row\'s value -- claiming a break there would refuse a comparison the evidence supports. `securityMechanismAttributionCounts` is unchanged: a CWE-601 finding was attributed from its CWE tag before and still is, only into a different bucket. Nothing outside the security dimension reads the mechanism enum. One consequence is not a metric change but is worth knowing: `EvalReportSchema` is exhaustive over the enum, so a report archived before this boundary no longer parses as a PRODUCER report; `eval compare` is unaffected because it reads through the tolerant comparison view, which models no per-mechanism metric.'
    }
  ]

const evalMetricsVersions = createMetricsVersionHistory(
  EVAL_METRICS_VERSION_HISTORY
)

export const EVAL_METRICS_VERSION = evalMetricsVersions.currentVersion

// Metrics that cannot be compared between two reports scored under `baseId` and
// `headId`. Order-insensitive: comparing an older head against a newer base
// crosses the same boundaries.
export const metricsAffectedBetween =
  evalMetricsVersions.metricsAffectedBetween

export const metricComparability = evalMetricsVersions.metricComparability
