import { z } from 'zod'
import { isActionableFinding } from '../../shared/contracts/index.js'
import type {
  AdmittedFinding,
  QualityGateResult,
  Severity
} from '../../shared/contracts/index.js'

// The schema is the definition and the type is inferred from it. Both used to be
// written out by hand in two domains, and under `exactOptionalPropertyTypes` the
// two shapes were not assignable (`?: number` against `?: number | undefined`), so
// the pipeline reached admission through a cast. One declaration, no cast.
export const QualityGateThresholdsSchema = z.strictObject({
  maxCritical: z.int().min(0).optional(),
  maxHigh: z.int().min(0).optional(),
  maxMedium: z.int().min(0).optional(),
  failOnProviderError: z.boolean().optional(),
  failOnNewOnly: z.boolean().optional()
})

export type QualityGateThresholds = z.infer<typeof QualityGateThresholdsSchema>

const severityThresholdKey: Readonly<
  Partial<Record<Severity, keyof QualityGateThresholds>>
> = {
  critical: 'maxCritical',
  high: 'maxHigh',
  medium: 'maxMedium'
}

// A provider issue this gate treats as a failure: one the run did not recover
// from, meaning some part of the review did not happen. `recovered` is optional
// on the contract, and an issue that does not say must be read as unrecovered --
// the same rule the rest of this gate follows for an unknown baseline status.
// Exported because the review report has to say WHY the gate failed, and the
// gate result cannot tell it: a provider-error failure names no finding, so a
// reader shown `failingFindingIds` alone was told "0 findings cross a threshold".
// The report asks this same predicate rather than keeping its own copy — two
// readings of "unrecovered" would eventually disagree about which run is blocked.
export const isUnrecoveredProviderIssue = (issue: {
  readonly recovered?: boolean | undefined
}): boolean => issue.recovered !== true

/**
 * The deterministic pass/fail for a completed review run.
 *
 * `failOnProviderError` (default `true`) is why `providerIssues` is an input.
 * Without it the gate saw only what survived: a discovery call that failed
 * contributed no candidates, a refutation that failed rejected its candidate
 * unadjudicated, and the gate passed over the smaller set. A provider outage
 * made a change MORE likely to clear the gate than a healthy run would have,
 * and the run exited 0. Findings that were never produced cannot be counted,
 * so the gate has to be told the search was incomplete.
 */
export const evaluateQualityGate = (
  input: {
    readonly admittedFindings: readonly AdmittedFinding[]
    readonly thresholds: QualityGateThresholds
    readonly providerIssues?:
      | readonly { readonly recovered?: boolean | undefined }[]
      | undefined
  }
): QualityGateResult => {
  const baselineFilteringApplied = input.thresholds.failOnNewOnly === true
  // `unknown` (baseline configured but missing) is treated as new so a missing
  // baseline never silently suppresses a gate failure.
  const gateEligibleFindings = input.admittedFindings.filter(isActionableFinding)
  const relevantFindings = baselineFilteringApplied
    ? gateEligibleFindings.filter(
        (finding) =>
          finding.baselineStatus === 'new' ||
          finding.baselineStatus === 'unknown'
      )
    : gateEligibleFindings
  const failingFindingIds: string[] = []

  for (const severity of ['critical', 'high', 'medium'] satisfies readonly Severity[]) {
    const thresholdKey = severityThresholdKey[severity]
    const threshold =
      thresholdKey === undefined ? undefined : input.thresholds[thresholdKey]

    if (typeof threshold !== 'number') {
      continue
    }

    const findings = relevantFindings.filter(
      (finding) => finding.severity === severity
    )

    if (findings.length > threshold) {
      failingFindingIds.push(...findings.map((finding) => finding.id))
    }
  }

  const failOnProviderError = input.thresholds.failOnProviderError ?? true
  const unrecoveredProviderIssues =
    failOnProviderError &&
    (input.providerIssues ?? []).some((issue) =>
      isUnrecoveredProviderIssue(issue)
    )

  return {
    // An unrecovered provider issue fails the gate on its own: it has no
    // finding to name, because the failure is that findings are MISSING.
    passed: failingFindingIds.length === 0 && !unrecoveredProviderIssues,
    failingFindingIds: [...new Set(failingFindingIds)],
    thresholds: {
      maxCritical: input.thresholds.maxCritical ?? null,
      maxHigh: input.thresholds.maxHigh ?? null,
      maxMedium: input.thresholds.maxMedium ?? null,
      failOnProviderError,
      failOnNewOnly: input.thresholds.failOnNewOnly ?? false
    },
    baselineFilteringApplied
  }
}
