import type { DriftCheckResult, DriftFinding } from '../../drift/index.js'
import type { StructuredError } from '../../../shared/errors/error-normalizer.js'

export const driftWarningsFor = (
  findings: readonly DriftFinding[]
): readonly string[] =>
  findings
    .filter((finding) => finding.gate === 'warning')
    .map((finding) => `drift:${finding.category}`)

export const createDriftGateError = (
  drift: DriftCheckResult
): StructuredError => ({
  code: 'drift_gate_failed',
  message: 'Review stopped because hard drift findings block the run.',
  category: 'quality-gate',
  recoverable: true,
  exitCode: 1,
  details: {
    errorCount: drift.errorCount,
    warningCount: drift.warningCount
  }
})
