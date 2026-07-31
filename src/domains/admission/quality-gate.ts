import { z } from 'zod'
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

export const evaluateQualityGate = (
  input: {
    readonly admittedFindings: readonly AdmittedFinding[]
    readonly thresholds: QualityGateThresholds
  }
): QualityGateResult => {
  const baselineFilteringApplied = input.thresholds.failOnNewOnly === true
  // `unknown` (baseline configured but missing) is treated as new so a missing
  // baseline never silently suppresses a gate failure.
  const gateEligibleFindings = input.admittedFindings.filter(
    (finding) => finding.reporterEligibility !== 'artifact-only'
  )
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

  return {
    passed: failingFindingIds.length === 0,
    failingFindingIds: [...new Set(failingFindingIds)],
    thresholds: {
      maxCritical: input.thresholds.maxCritical ?? null,
      maxHigh: input.thresholds.maxHigh ?? null,
      maxMedium: input.thresholds.maxMedium ?? null,
      failOnProviderError: input.thresholds.failOnProviderError ?? true,
      failOnNewOnly: input.thresholds.failOnNewOnly ?? false
    },
    baselineFilteringApplied
  }
}
