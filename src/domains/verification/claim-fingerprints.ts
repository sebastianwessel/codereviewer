// Derives the fingerprints a `Verdict` carries so it can be matched back to a
// general-review finding and across runs (spec 12 "Verdict" / "Corroboration").
// A `prior-finding` claim carries its origin finding's fingerprints as
// `fingerprint:<algorithm>` evidence refs (see `prior-findings-provider.ts`);
// reusing them lets a `confirmed`/`refuted` verdict line up with that finding.
// Any claim without carried fingerprints gets a stable synthesized fingerprint
// so the `Verdict.fingerprints` contract (at least one) always holds.

import {
  fingerprintKey,
  FindingFingerprintSchema,
  type FindingFingerprint
} from '../../shared/contracts/findings/finding.schema.js'
import type { Claim } from '../../shared/contracts/verification/verification.schema.js'
import { sha256 } from '../../shared/hash/hash.js'

const FINGERPRINT_REF_PREFIX = 'fingerprint:'

/**
 * The evidence refs that carry a finding's fingerprints onto a claim.
 *
 * This is the WRITE side of the `fingerprint:<algorithm>` ref format that
 * `fingerprintsForClaim` below reads back. Both live here so the prefix has one
 * owner: a claim provider that spelled the key itself would silently stop
 * round-tripping the moment the prefix changed, and the verdict would then be
 * matched to no finding at all rather than fail.
 */
export const fingerprintEvidenceRefs = (
  fingerprints: readonly FindingFingerprint[]
): readonly { readonly key: string; readonly value: string }[] =>
  fingerprints.map((fingerprint) => ({
    key: `${FINGERPRINT_REF_PREFIX}${fingerprint.algorithm}`,
    value: fingerprint.value
  }))

const synthesizedFingerprint = (claim: Claim): FindingFingerprint => ({
  algorithm: 'v1-claim-id',
  value: sha256(`verification-claim:${claim.id}`).slice(0, 32)
})

export const fingerprintsForClaim = (claim: Claim): FindingFingerprint[] => {
  const carried = (claim.evidenceRefs ?? [])
    .filter((ref) => ref.key.startsWith(FINGERPRINT_REF_PREFIX))
    .map((ref) => {
      const parsed = FindingFingerprintSchema.safeParse({
        algorithm: ref.key.slice(FINGERPRINT_REF_PREFIX.length),
        value: ref.value
      })

      return parsed.success ? parsed.data : undefined
    })
    .filter((fingerprint): fingerprint is FindingFingerprint => fingerprint !== undefined)

  return carried.length > 0 ? carried : [synthesizedFingerprint(claim)]
}

// Re-exported so this module stays the verification domain's one import site for
// fingerprint identity, while the definition lives beside the type it keys.
export { fingerprintKey }
