// The adjudication policy: which divergences are submitted, which survive, and
// what the report is able to say about the ones that did not.
//
// It is a FILTER over the deterministic core's output and never a source of
// divergences: it cannot add one, cannot change one, and cannot alter a statement
// or a cited peer. The only thing an adjudication does to a divergence is decide
// whether it is reported at all, and attach the reason it was.
//
// Every path out of this module that is not an explicit `convention` verdict
// removes the divergence from the report, which is one direction on purpose. Spec
// 24 orders firing rate before recall and fixes a kill criterion on false alarms;
// a layer that resolves its own failures towards reporting would be optimising the
// metric the spec deprioritises against the one it gates on.

import type {
  ConformanceAdjudicationInput,
  ConformanceAdjudicationRunner
} from './conformance-adjudication.js'
import type {
  ConformanceAdjudicationRecord,
  ConformanceAdjudicationSummary,
  ConformanceDivergence
} from './conformance-report.js'

export type AdjudicateDivergencesInput = {
  readonly changeAttributed: readonly ConformanceDivergence[]
  readonly preExisting: readonly ConformanceDivergence[]
  readonly adjudicationInputsById: ReadonlyMap<
    string,
    ConformanceAdjudicationInput
  >
  readonly adjudicate: ConformanceAdjudicationRunner
  readonly maxAdjudications: number
  readonly signal?: AbortSignal | undefined
}

export type AdjudicateDivergencesResult = {
  readonly changeAttributed: readonly ConformanceDivergence[]
  readonly preExisting: readonly ConformanceDivergence[]
  readonly summary: ConformanceAdjudicationSummary
}

/** The summary of spec 24's deterministic baseline arm: no call, no filtering. */
export const deterministicAdjudicationSummary = (): ConformanceAdjudicationSummary => ({
  mode: 'deterministic',
  requestedCount: 0,
  conventionCount: 0,
  incidentalCount: 0,
  undeterminedCount: 0,
  failedCount: 0,
  unadjudicatedCount: 0
})

/**
 * Adjudicates the reported divergences, keeping only the ones judged a convention.
 *
 * Change-attributed divergences are submitted before pre-existing ones, so when the
 * bound runs out it is always the findings the change did not cause that go
 * unjudged.
 *
 * Calls are sequential. One call per divergence against a bound of a few dozen is
 * not where this capability's latency lives, and a concurrent version would need a
 * limiter, an error-aggregation rule and a decision about ordering — three things
 * to get right in exchange for nothing measured.
 */
export const adjudicateDivergences = async (
  input: AdjudicateDivergencesInput
): Promise<AdjudicateDivergencesResult> => {
  const ordered = [...input.changeAttributed, ...input.preExisting]
  const submitted = ordered.slice(0, input.maxAdjudications)
  const conventions = new Map<string, ConformanceAdjudicationRecord>()
  let incidentalCount = 0
  let undeterminedCount = 0
  let failedCount = 0

  for (const divergence of submitted) {
    const adjudicationInput = input.adjudicationInputsById.get(divergence.id)

    if (adjudicationInput === undefined) {
      // No packet means no call was possible, which is a defect in the caller
      // rather than an answer. Counted as a failure so it is visible, and the
      // divergence is dropped like every other unjudged one.
      failedCount += 1
      continue
    }

    let adjudication

    try {
      adjudication = await input.adjudicate(adjudicationInput, input.signal)
    } catch {
      // A provider failure is not a verdict. Spec 24 requires failure to be
      // recoverable, so the run continues and the divergence is not reported.
      failedCount += 1
      continue
    }

    if (adjudication.verdict === 'convention') {
      // The narrowed branch is the only one that has a `reason` at all, which is
      // what makes an `undetermined` verdict unable to reach a divergence entry.
      conventions.set(divergence.id, {
        verdict: 'convention',
        reason: adjudication.reason
      })
      continue
    }

    if (adjudication.verdict === 'incidental') {
      incidentalCount += 1
      continue
    }

    undeterminedCount += 1
  }

  const keep = (
    divergences: readonly ConformanceDivergence[]
  ): readonly ConformanceDivergence[] =>
    divergences.flatMap((divergence) => {
      const adjudication = conventions.get(divergence.id)

      return adjudication === undefined ? [] : [{ ...divergence, adjudication }]
    })

  return {
    changeAttributed: keep(input.changeAttributed),
    preExisting: keep(input.preExisting),
    summary: {
      mode: 'model',
      requestedCount: submitted.length,
      conventionCount: conventions.size,
      incidentalCount,
      undeterminedCount,
      failedCount,
      unadjudicatedCount: ordered.length - submitted.length
    }
  }
}
