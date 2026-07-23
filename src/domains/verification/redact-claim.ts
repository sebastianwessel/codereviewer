// Shared claim redaction for the verification claim providers. A claim's free
// text fields (title, detail, question, source label, and evidence ref values)
// can carry content copied from an external file or a prior run's finding text,
// so every provider redacts the same fields before the claim is handed to the
// `verify_claim` agent. `id`, `kind`, `location`, and evidence ref keys are
// structural, not free text, and are left untouched.

import type { Claim } from '../../shared/contracts/verification/verification.schema.js'

export const redactClaim = (
  claim: Claim,
  redact: (value: string) => string
): Claim => ({
  ...claim,
  title: redact(claim.title),
  detail: redact(claim.detail),
  source: redact(claim.source),
  question: redact(claim.question),
  ...(claim.evidenceRefs === undefined
    ? {}
    : {
        evidenceRefs: claim.evidenceRefs.map((ref) => ({
          ...ref,
          value: redact(ref.value)
        }))
      })
})
