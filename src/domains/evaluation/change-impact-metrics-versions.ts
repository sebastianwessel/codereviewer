import {
  createMetricsVersionHistory,
  type MetricComparabilityOf,
  type MetricsVersionDivergenceOf,
  type MetricsVersionEntry
} from './metrics-version-history.js'

// Scoring-rule versions for the CHANGE-IMPACT corpus (spec 22 §Evaluation).
//
// A separate history from the diff reviewer's, for the same reason the corpus is
// separate and the report artefact is separate: the two answer different
// questions. A bump to how expectations are matched to findings inside a diff
// says nothing about whether a predicted destination file was a dependent
// upstream had to repair, and a shared history would make every bump on either
// side refuse comparisons on the other.
//
// The mechanism — ordered entries, per-key blast radius, "unknown version means
// nothing is comparable" — is `metrics-version-history.ts` and is reused, not
// re-implemented.

// Every figure this scorer publishes. Comparability is expressed per key so a
// future bump can record that it moved, say, only the adjudicated arm.
export type ChangeImpactComparabilityKey =
  // Recall of the deterministic reference list, per reachability class and per
  // contamination split. One key: the arm's matching rule is one rule.
  | 'referenceRecall'
  // Recall of the files adjudication actually reports.
  | 'adjudicatedRecall'
  // The pre-registered decision rule's denominator: of the proven dependents the
  // reference list itself contains, how many survive adjudication.
  | 'adjudicatedRecallWithinReferenceList'
  // Raw precision, which on this corpus is a LOWER BOUND only.
  | 'precisionLowerBound'
  // What adjudication removed relative to the reference list.
  | 'adjudicationDelta'
  // Which cases produced an answer at all, and which are unmeasured.
  | 'caseCoverage'

export type ChangeImpactMetricsVersionDivergence =
  MetricsVersionDivergenceOf<ChangeImpactComparabilityKey>
export type ChangeImpactMetricComparability =
  MetricComparabilityOf<ChangeImpactComparabilityKey>

// Ordered oldest to newest.
export const CHANGE_IMPACT_METRICS_VERSION_HISTORY: readonly MetricsVersionEntry<ChangeImpactComparabilityKey>[] =
  [
    {
      id: '2026-08-06.impact-destination-file',
      affects: 'all',
      note: 'First scoring rules for the change-impact corpus. The unit is the destination FILE: a prediction counts when the corpus\'s proven-broken dependent is that file. Three arms are scored — the deterministic reference list, the adjudicated subset, and the difference — and recall is reported per reachability class and per contamination split, never pooled. Nothing precedes this entry, so nothing may be compared across it.'
    },
    {
      id: '2026-08-06.adjudication-tier-attribution',
      // Recall and precision are untouched: the same predictions produce the same
      // hits. What changed is arm 3, which no longer publishes one "removed by
      // adjudication" figure at all.
      affects: ['adjudicationDelta'],
      note: 'Arm 3 is split by TIER and carries no pooled total. Previously it reported one set of removal counts over every fully adjudicated case; a case in which the model was never called contributed its deterministic-tier removals to that total indistinguishably, which is how the voided 2026-08-06 measurement was read as a judge rejecting everything. The delta now reports two disjoint groups — cases that spent no model call, and cases that spent at least one — and a pre-bump removal figure may not be compared against either, because it is their sum.'
    }
  ]

const changeImpactMetricsVersions = createMetricsVersionHistory(
  CHANGE_IMPACT_METRICS_VERSION_HISTORY
)

export const CHANGE_IMPACT_METRICS_VERSION =
  changeImpactMetricsVersions.currentVersion

export const changeImpactMetricsAffectedBetween =
  changeImpactMetricsVersions.metricsAffectedBetween

export const changeImpactMetricComparability =
  changeImpactMetricsVersions.metricComparability
