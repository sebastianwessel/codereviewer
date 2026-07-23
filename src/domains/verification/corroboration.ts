// Corroboration (spec 12). A `confirmed` verdict and a general-review admitted
// finding that describe the same defect are recorded as one observation with
// multiple witnesses. Corroboration raises a CONFIDENCE signal on the finding;
// it NEVER raises severity — severity remains a function of impact only, so this
// module never reads or writes a finding's severity. The signal is returned as a
// separate structure rather than mutated onto the finding, keeping the admitted
// finding contract (and its severity) untouched.

import { normalizeRepositoryRelativePath } from '../../platform/repository-path.js'
import type {
  AdmittedFinding,
  CodeLocation,
  FindingFingerprint
} from '../../shared/contracts/index.js'
import type {
  Claim,
  Verdict
} from '../../shared/contracts/verification/verification.schema.js'
import type {
  CorroborationMatchKind,
  FindingCorroboration
} from './verification-report.js'

export type { CorroborationMatchKind, FindingCorroboration }

export type CorroborateFindingsInput = {
  readonly findings: readonly AdmittedFinding[]
  readonly verdicts: readonly Verdict[]
  // Claims are used to resolve a verdict's location for fuzzy matching (a
  // `Verdict` itself carries only fingerprints, not a location). Without a
  // matching claim, only exact fingerprint matching applies to that verdict.
  readonly claims?: readonly Claim[]
}

const fingerprintKey = (fingerprint: FindingFingerprint): string =>
  `${fingerprint.algorithm}:${fingerprint.value}`

const shareFingerprint = (
  finding: AdmittedFinding,
  verdict: Verdict
): boolean => {
  const findingKeys = new Set(finding.fingerprints.map(fingerprintKey))

  return verdict.fingerprints.some((fingerprint) =>
    findingKeys.has(fingerprintKey(fingerprint))
  )
}

const endLineOf = (location: CodeLocation): number =>
  location.endLine ?? location.startLine

const overlaps = (a: CodeLocation, b: CodeLocation): boolean =>
  normalizeRepositoryRelativePath(a.path) ===
    normalizeRepositoryRelativePath(b.path) &&
  Math.max(a.startLine, b.startLine) <= Math.min(endLineOf(a), endLineOf(b))

/**
 * Marks each finding corroborated by at least one `confirmed` verdict. A verdict
 * corroborates a finding when they share a fingerprint, or (fuzzy) when the
 * verdict's claim location and the finding location cover the same file with
 * overlapping line ranges. Only `confirmed` verdicts corroborate; `refuted` and
 * `uncertain` verdicts never raise confidence.
 */
export const corroborateFindings = (
  input: CorroborateFindingsInput
): readonly FindingCorroboration[] => {
  const claimById = new Map<string, Claim>(
    (input.claims ?? []).map((claim) => [claim.id, claim])
  )
  const confirmed = input.verdicts.filter(
    (verdict) => verdict.status === 'confirmed'
  )

  const corroborations: FindingCorroboration[] = []

  for (const finding of input.findings) {
    const matchKinds = new Set<CorroborationMatchKind>()
    const witnessClaimIds = new Set<string>()

    for (const verdict of confirmed) {
      let matched = false

      if (shareFingerprint(finding, verdict)) {
        matchKinds.add('fingerprint')
        matched = true
      } else {
        const claimLocation = claimById.get(verdict.claimId)?.location

        if (
          claimLocation !== undefined &&
          overlaps(finding.location, claimLocation)
        ) {
          matchKinds.add('fuzzy')
          matched = true
        }
      }

      if (matched) {
        witnessClaimIds.add(verdict.claimId)
      }
    }

    if (witnessClaimIds.size > 0) {
      corroborations.push({
        findingId: finding.id,
        confidence: 'corroborated',
        matchKinds: [...matchKinds],
        witnessClaimIds: [...witnessClaimIds]
      })
    }
  }

  return corroborations
}
