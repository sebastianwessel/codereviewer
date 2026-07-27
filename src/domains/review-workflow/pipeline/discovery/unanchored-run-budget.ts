// Spec 19: the bound on the un-anchored discovery pass, and the record of what
// that bound cost.
//
// The bound is load-bearing, not hygiene. Each unit is one discovery call
// (~$0.008 when measured) and a 600-line file at the default 60/40 geometry is
// fifteen units, so an unbounded pass is by far the most expensive thing this
// engine can be asked to do. Both a per-file and a per-run cap are enforced here,
// in code, from configuration.
//
// The counting is the other half of the requirement, and the more easily lost
// one. A pass that quietly reviews eight of a file's fifteen units and says
// nothing about the other seven reads exactly like full coverage — to a reader of
// the report, and to anyone measuring the pass. So every withheld unit is counted
// and the run reports the bound that withheld it. Silent truncation is forbidden.

export type UnanchoredBounds = {
  readonly unitLines: number
  readonly strideLines: number
  readonly maxUnitsPerFile: number
  readonly maxUnitsPerRun: number
}

export type UnanchoredRunSummary = {
  readonly enabled: boolean
  readonly maxUnitsPerFile: number
  readonly maxUnitsPerRun: number
  readonly unitsRequested: number
  readonly unitsGranted: number
  readonly unitsWithheld: number
  // Files that wanted more units than they were allowed. Counted rather than
  // named: a file path is repository content, and this record travels into the
  // run report.
  readonly truncatedFileCount: number
  readonly perFileBoundReached: boolean
  readonly perRunBoundReached: boolean
}

export type UnanchoredRunBudget = {
  /**
   * Reserves up to `requestedUnits` units for one file and returns how many the
   * caller may actually run. A caller MUST review only the granted number.
   */
  readonly claimUnits: (requestedUnits: number) => number
  readonly summary: () => UnanchoredRunSummary
}

const disabledSummary: UnanchoredRunSummary = {
  enabled: false,
  maxUnitsPerFile: 0,
  maxUnitsPerRun: 0,
  unitsRequested: 0,
  unitsGranted: 0,
  unitsWithheld: 0,
  truncatedFileCount: 0,
  perFileBoundReached: false,
  perRunBoundReached: false
}

/**
 * Creates the run-scoped bound for the un-anchored pass. One budget per review
 * run: the per-run cap is meaningless if each task gets its own.
 *
 * `bounds` is absent exactly when the pass is disabled, and the resulting budget
 * grants nothing — so a caller that forgets to check the toggle still cannot
 * spend anything. Claiming is synchronous, which is what makes it safe under the
 * task queue's concurrency: two tasks can never both see the same remaining
 * allowance and both spend it.
 */
export const createUnanchoredRunBudget = (
  bounds: UnanchoredBounds | undefined
): UnanchoredRunBudget => {
  if (bounds === undefined) {
    return {
      claimUnits: () => 0,
      summary: () => disabledSummary
    }
  }

  let unitsRequested = 0
  let unitsGranted = 0
  let truncatedFileCount = 0
  let perFileBoundReached = false
  let perRunBoundReached = false

  return {
    claimUnits: (requestedUnits: number): number => {
      if (requestedUnits <= 0) {
        return 0
      }

      unitsRequested += requestedUnits

      const allowedForFile = Math.min(requestedUnits, bounds.maxUnitsPerFile)
      const remainingForRun = Math.max(0, bounds.maxUnitsPerRun - unitsGranted)
      const granted = Math.min(allowedForFile, remainingForRun)

      unitsGranted += granted

      if (granted < requestedUnits) {
        truncatedFileCount += 1
        perFileBoundReached ||= allowedForFile < requestedUnits
        perRunBoundReached ||= remainingForRun < allowedForFile
      }

      return granted
    },
    summary: (): UnanchoredRunSummary => ({
      enabled: true,
      maxUnitsPerFile: bounds.maxUnitsPerFile,
      maxUnitsPerRun: bounds.maxUnitsPerRun,
      unitsRequested,
      unitsGranted,
      unitsWithheld: unitsRequested - unitsGranted,
      truncatedFileCount,
      perFileBoundReached,
      perRunBoundReached
    })
  }
}

/**
 * Renders the run warnings for a finished un-anchored pass.
 *
 * A warning is emitted only when the bound actually withheld work, and it names
 * the applied bound that did so — that pairing is the requirement: a truncation
 * the reader cannot attribute to a configured limit is not much better than no
 * truncation notice at all. A pass that reviewed everything it derived produces
 * no warning, because nothing went wrong.
 */
export const unanchoredTruncationWarnings = (
  summary: UnanchoredRunSummary
): readonly string[] => {
  if (!summary.enabled || summary.unitsWithheld <= 0) {
    return []
  }

  const boundsHit = [
    ...(summary.perFileBoundReached
      ? [`per-file bound ${summary.maxUnitsPerFile}`]
      : []),
    ...(summary.perRunBoundReached
      ? [`per-run bound ${summary.maxUnitsPerRun}`]
      : [])
  ].join(', ')

  return [
    `unanchored-discovery-truncated: ${summary.unitsWithheld} of ${summary.unitsRequested} units were not reviewed across ${summary.truncatedFileCount} file(s) (${boundsHit})`
  ]
}
