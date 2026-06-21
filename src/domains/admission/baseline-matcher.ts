import {
  AdmittedFindingSchema,
  type AdmittedFinding,
  type BaselineStatus,
  type FindingFingerprint
} from '../../shared/contracts/index.js'

export type BaselineFingerprintRecord = {
  readonly fingerprints: readonly FindingFingerprint[]
}

export type BaselineMatchResult = {
  readonly admittedFindings: readonly AdmittedFinding[]
  readonly resolvedBaselineFingerprints: readonly FindingFingerprint[]
  readonly warnings: readonly string[]
}

const fingerprintKey = (fingerprint: FindingFingerprint): string =>
  `${fingerprint.algorithm}:${fingerprint.value}`

// Baseline entries whose fingerprints no longer appear among admitted findings
// are considered resolved (fixed since the baseline was recorded).
export const resolveBaselineFingerprints = (
  baselineFingerprints: readonly BaselineFingerprintRecord[],
  admittedFindings: readonly AdmittedFinding[]
): readonly FindingFingerprint[] => {
  const currentKeys = new Set(
    admittedFindings.flatMap((finding) =>
      finding.fingerprints.map(fingerprintKey)
    )
  )

  return baselineFingerprints
    .flatMap((entry) => entry.fingerprints)
    .filter((fingerprint) => !currentKeys.has(fingerprintKey(fingerprint)))
}

const withBaselineStatus = (
  finding: AdmittedFinding,
  baselineStatus: BaselineStatus
): AdmittedFinding =>
  AdmittedFindingSchema.parse({
    ...finding,
    baselineStatus
  })

export const matchBaselineFindings = (
  input: {
    readonly admittedFindings: readonly AdmittedFinding[]
    readonly baselineFingerprints?: readonly BaselineFingerprintRecord[]
    readonly baselineConfigured: boolean
  }
): BaselineMatchResult => {
  // Baseline data is indeterminate when a configured baseline file is absent:
  // findings cannot be classified as new vs existing, so they are `unknown`.
  const baselineIndeterminate =
    input.baselineConfigured && input.baselineFingerprints === undefined
  const warnings = baselineIndeterminate ? ['baseline-missing'] : []
  const baselineFingerprints = input.baselineFingerprints ?? []
  const baselineKeys = new Set(
    baselineFingerprints.flatMap((entry) => entry.fingerprints.map(fingerprintKey))
  )
  const admittedFindings = input.admittedFindings.map((finding) =>
    withBaselineStatus(
      finding,
      baselineIndeterminate
        ? 'unknown'
        : finding.fingerprints.some((fingerprint) =>
              baselineKeys.has(fingerprintKey(fingerprint))
            )
          ? 'existing'
          : 'new'
    )
  )
  const resolvedBaselineFingerprints = resolveBaselineFingerprints(
    baselineFingerprints,
    input.admittedFindings
  )

  return {
    admittedFindings,
    resolvedBaselineFingerprints,
    warnings
  }
}

