// What a COMPLETED review run is allowed to tell a machine about its gate.
//
// `ReviewReport.qualityGate` is optional by contract (spec 03) because a report
// object can exist for a run that never reached the gate. A run that completed
// is not that case: both admission paths evaluate the gate unconditionally
// (`evaluateQualityGate` returns a result, and the provider workflow's output
// contract requires one), and no configuration disables it. An absent gate on a
// completed report is therefore an internal inconsistency, not a run that
// legitimately has no verdict.
//
// The CLI used to summarize that absence as `qualityGatePassed: true` with exit
// code `0`. That is absence read as clearance, in the optimistic direction, on
// the one surface a pipeline branches on: a run that could not state its gate
// would have reported a passing one and let the change through. The human
// surfaces stopped doing this — `report.md` says "not evaluated for this run" —
// and this is the same rule applied to the machine surface. A limit or a failure
// announces itself rather than producing a plausible answer.
import type {
  QualityGateResult,
  ReviewReport
} from '../shared/contracts/index.js'
import { createStructuredError } from '../shared/errors/error-normalizer.js'

export const qualityGateOfCompletedRun = (
  report: ReviewReport
): QualityGateResult => {
  const gate = report.qualityGate

  if (gate === undefined) {
    // Category `internal` fixes exit code 5 and `recoverable: false` (spec 05):
    // nothing about the run is retryable, and the report on disk is the evidence
    // for the bug report.
    throw createStructuredError({
      code: 'quality_gate_missing',
      message:
        `Run ${report.run.runId} completed without a quality gate result. Every completed run evaluates its gate, so this is an internal inconsistency; the run cannot be reported as passing one.`,
      category: 'internal',
      details: { runId: report.run.runId }
    })
  }

  return gate
}
