import {
  createMetricsVersionHistory,
  type MetricComparabilityOf,
  type MetricsVersionDivergenceOf,
  type MetricsVersionEntry
} from '../report/versions/metrics-version-history.js'

// Scoring-rule versions for the INTENT-FULFILMENT corpus (spec 23 §Evaluation).
//
// A separate history from the diff reviewer's and from change-impact's, for the
// same reason each of those is separate: they answer different questions. A change
// to how an obligation is joined to an answer-key clause says nothing about whether
// a predicted destination file was a dependent upstream had to repair, and a shared
// history would make a bump on either side refuse comparisons on the other.

export type IntentComparabilityKey =
  // Of the enumerated outstanding obligations, how many the run left on the list a
  // human reads.
  | 'outstandingRecall'
  // The metric spec 23's decision rule is stated on.
  | 'falseSatisfied'
  // How much of what the run reported the answer key covers at all.
  | 'obligationCoverage'
  // Which cases produced an answer, refused, or could not be measured.
  | 'caseCoverage'

export type IntentMetricsVersionDivergence =
  MetricsVersionDivergenceOf<IntentComparabilityKey>
export type IntentMetricComparability =
  MetricComparabilityOf<IntentComparabilityKey>

// Ordered oldest to newest.
export const INTENT_METRICS_VERSION_HISTORY: readonly MetricsVersionEntry<IntentComparabilityKey>[] =
  [
    {
      id: '2026-08-12.intent-clause-anchored',
      affects: 'all',
      note: "First committed scoring rules for the intent-fulfilment corpus. The unit is an ENUMERATED OUTSTANDING OBLIGATION, and a reported obligation is joined to one by the clause of the stated intent both cite, resolved through the hydrated line map. An expectation is a false-satisfied claim when every obligation citing its clause is off the outstanding list, which puts a wrong `not-contradicted` in the numerator on the same footing as a wrong `evidenced`, per spec 23's pre-registration. Nothing precedes this entry, so no figure recorded before it — every one of which came from an instrument under the gitignored `.codereviewer/` tree, joined by positional obligation id or by lexical statement match — may be compared across it."
    }
  ]

const intentMetricsVersions = createMetricsVersionHistory(
  INTENT_METRICS_VERSION_HISTORY
)

export const INTENT_METRICS_VERSION = intentMetricsVersions.currentVersion

export const intentMetricsAffectedBetween =
  intentMetricsVersions.metricsAffectedBetween

export const intentMetricComparability = intentMetricsVersions.metricComparability
