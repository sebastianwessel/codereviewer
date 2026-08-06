// Changed-side attribution: the single most important correctness property of
// analyzer ingestion (spec 15, Mechanism 2).
//
// AN ANALYZER ARTIFACT DESCRIBES A WHOLE REPOSITORY. A review describes a change.
// Handing the first to the second unattributed would report every alert a scanner
// ever raised as though this change had caused it — a flood of pre-existing
// repository debt that would destroy the engine's precision and, worse, would train
// a reader to ignore the section it appears in.
//
// So an alert is reported only when the change can be shown to be implicated in it,
// by one of two positive tests over the run's changed new-side line ranges:
//
//   `changed-line` — the alert's own primary location is on a changed line.
//   `changed-flow` — a step of its data flow, or one of its related locations, is
//                    on a changed line: the change declares, feeds, or removes a
//                    barrier on the path the alert traces, even where the reported
//                    sink is untouched older code.
//
// WHAT THIS CANNOT CATCH, stated plainly because a silent limit is the failure this
// repository keeps finding: a change that exposes an existing vulnerable path
// WITHOUT appearing anywhere on that path. Removing an authorization wrapper in an
// unrelated module, widening a route pattern, relaxing a build or deployment
// setting, or upgrading a dependency can each make a pre-existing alert newly
// reachable while the analyzer's own locations sit entirely in unchanged code. Those
// are not reported, and no heuristic here pretends otherwise — the alternative is
// blaming a change for every alert in every file it can reach transitively, which
// is the flood this gate exists to prevent. The count of alerts held back is
// reported so the omission is visible rather than assumed.

import type { RepositoryRelativePath } from '../../shared/contracts/index.js'
import type {
  AnalyzerAlert,
  AttributedAnalyzerAlert
} from './contracts.js'

// The new-side line spans this run considers changed.
export type ChangedLineRange = {
  readonly path: RepositoryRelativePath
  readonly startLine: number
  readonly endLine: number
  readonly changeKind?: 'new' | 'modified' | 'deleted' | undefined
}

export type AttributionResult = {
  readonly attributed: readonly AttributedAnalyzerAlert[]
  // Alerts with no changed-side cause. Counted, never silently discarded.
  readonly preExistingCount: number
}

// Paths are compared after normalization by the caller; the map is keyed exactly.
type ChangedRangesByPath = ReadonlyMap<string, readonly ChangedLineRange[]>

/**
 * Index the run's changed ranges by path.
 *
 * `deleted` ranges are excluded: they describe old-side lines that no longer exist,
 * and an analyzer scanned the post-change tree. Matching a new-side alert line
 * against a deleted old-side span would attribute by coincidence of numbering.
 */
export const indexChangedRanges = (
  ranges: readonly ChangedLineRange[]
): ChangedRangesByPath => {
  const byPath = new Map<string, ChangedLineRange[]>()

  for (const range of ranges) {
    if (range.changeKind === 'deleted') {
      continue
    }

    // A zero endLine is how an empty span is represented upstream; treat it as the
    // start line rather than as a range that can never match.
    const normalized: ChangedLineRange = {
      ...range,
      endLine: Math.max(range.startLine, range.endLine)
    }
    const existing = byPath.get(range.path)

    if (existing === undefined) {
      byPath.set(range.path, [normalized])
      continue
    }

    existing.push(normalized)
  }

  return byPath
}

const intersectingChangedLine = (
  location: {
    readonly path: string
    readonly startLine: number
    readonly endLine?: number | undefined
  },
  changedRanges: ChangedRangesByPath
): number | undefined => {
  const ranges = changedRanges.get(location.path)

  if (ranges === undefined) {
    return undefined
  }

  const locationEnd = Math.max(location.startLine, location.endLine ?? location.startLine)

  for (const range of ranges) {
    if (location.startLine <= range.endLine && locationEnd >= range.startLine) {
      // The changed line the attribution rests on, so a reader can check it.
      return Math.max(location.startLine, range.startLine)
    }
  }

  return undefined
}

/**
 * Attribute normalized alerts to the change under review.
 *
 * Order is deliberate: an alert whose own location is changed is `changed-line`
 * even when its flow also touches changed code, because the stronger claim is the
 * one worth reporting.
 *
 * With NO changed ranges (an explicit-file run, or a diff that produced none) every
 * alert is unattributable and nothing is reported. That is the honest answer: with
 * nothing known to have changed, no alert can be shown to be caused by the change,
 * and reporting them all would be exactly the pre-existing-debt flood.
 */
export const attributeAlertsToChange = (input: {
  readonly alerts: readonly AnalyzerAlert[]
  readonly changedRanges: readonly ChangedLineRange[]
}): AttributionResult => {
  const changedRanges = indexChangedRanges(input.changedRanges)
  const attributed: AttributedAnalyzerAlert[] = []
  let preExistingCount = 0

  for (const alert of input.alerts) {
    const primaryLine = intersectingChangedLine(alert.location, changedRanges)

    if (primaryLine !== undefined) {
      attributed.push({
        alert,
        attribution: 'changed-line',
        attributedPath: alert.location.path,
        attributedLine: primaryLine
      })
      continue
    }

    const flowLocations = [
      ...alert.dataFlow.flatMap((flow) => flow.steps.map((step) => step.location)),
      ...alert.relatedLocations.map((related) => related.location)
    ]
    const flowHit = flowLocations
      .map((location) => ({
        location,
        line: intersectingChangedLine(location, changedRanges)
      }))
      .find((entry): entry is { location: typeof entry.location; line: number } =>
        entry.line !== undefined
      )

    if (flowHit !== undefined) {
      attributed.push({
        alert,
        attribution: 'changed-flow',
        attributedPath: flowHit.location.path,
        attributedLine: flowHit.line
      })
      continue
    }

    preExistingCount += 1
  }

  return { attributed, preExistingCount }
}

// Ranks attributed alerts for the `maxAlerts` cap. Highest producer-stated security
// severity first, then the level band, then a stable id order so a run is
// reproducible. The cap is a bound on packet size; when it binds, what it keeps
// should be what a reviewer would have looked at first.
const levelRank: Readonly<Record<AnalyzerAlert['level'], number>> = {
  error: 3,
  warning: 2,
  note: 1,
  none: 0
}

export const rankAttributedAlerts = (
  alerts: readonly AttributedAnalyzerAlert[]
): readonly AttributedAnalyzerAlert[] =>
  [...alerts].sort((left, right) => {
    const severityDelta =
      (right.alert.securitySeverity ?? -1) - (left.alert.securitySeverity ?? -1)

    if (severityDelta !== 0) {
      return severityDelta
    }

    const levelDelta = levelRank[right.alert.level] - levelRank[left.alert.level]

    if (levelDelta !== 0) {
      return levelDelta
    }

    return left.alert.id.localeCompare(right.alert.id)
  })
