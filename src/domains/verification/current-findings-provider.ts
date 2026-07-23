// The `current-findings` claim source (spec 12). It turns THIS run's admitted
// findings at or above the fix lane's `minSeverity` into `current-finding` claims
// so the shared `investigate_claim` agent can judge each one real vs false
// positive and, when real, propose an apply-checked fix. It mirrors
// `prior-findings-provider.ts`, but reads the run's in-memory admitted findings
// rather than a report file.
//
// Each claim carries the finding's location and fingerprints (so a verdict can be
// matched back to the finding and to corroboration), and the claim id is a pure
// function of the finding id (`currentFindingClaimId`) so the fix lane can map an
// outcome back to its finding deterministically without trusting redacted claim
// text.

import {
  type Severity,
  severityMeetsThreshold
} from '../../shared/contracts/config/config.schema.js'
import type { AdmittedFinding } from '../../shared/contracts/findings/finding.schema.js'
import {
  ClaimSchema,
  type Claim
} from '../../shared/contracts/verification/verification.schema.js'
import { createRedactor } from '../../shared/redaction/redactor.js'
import { sha256 } from '../../shared/hash/hash.js'
import { truncateForContract } from '../../shared/text/truncate.js'
import { MAX_CLAIMS_PER_PROVIDER, type ClaimProvider } from './contracts.js'
import { redactClaim } from './redact-claim.js'

const CLAIM_QUESTION_MAX = 500
const CLAIM_DETAIL_MAX = 2000

/**
 * Deterministic claim id for a `current-finding` claim derived from a finding id.
 * Shared with the fix lane so an outcome can be mapped back to its finding
 * without depending on (redacted) claim contents.
 */
export const currentFindingClaimId = (findingId: string): string =>
  `claim_${sha256(`current-finding:${findingId}`).slice(0, 24)}`

const claimFromAdmittedFinding = (finding: AdmittedFinding): Claim =>
  ClaimSchema.parse({
    id: currentFindingClaimId(finding.id),
    kind: 'current-finding',
    title: finding.title,
    detail: truncateForContract(finding.description, CLAIM_DETAIL_MAX),
    location: finding.location,
    source: 'current-finding',
    question: truncateForContract(
      `Is this a real defect; if so, what is the minimal fix: ${finding.title}?`,
      CLAIM_QUESTION_MAX
    ),
    evidenceRefs: finding.fingerprints.map((fingerprint) => ({
      key: `fingerprint:${fingerprint.algorithm}`,
      value: fingerprint.value
    }))
  })

export type CurrentFindingsProviderConfig = {
  readonly findings: readonly AdmittedFinding[]
  readonly minSeverity: Severity
}

/**
 * The admitted findings the fix lane runs on: those at or above `minSeverity`.
 * Shared with `fix-run.ts` so the lane's early exit and the claims it gathers can
 * never disagree about which findings are eligible.
 */
export const eligibleCurrentFindings = (
  findings: readonly AdmittedFinding[],
  minSeverity: Severity
): readonly AdmittedFinding[] =>
  findings.filter((finding) =>
    severityMeetsThreshold(finding.severity, minSeverity)
  )

/**
 * Builds the `current-findings` provider over this run's admitted findings. Only
 * findings at or above `minSeverity` become claims (the fix lane runs on exactly
 * the findings that can block the pipeline by default). Gathering is synchronous
 * and cannot fail — the findings are already in memory — so it never contributes
 * a provider-failure warning.
 */
export const createCurrentFindingsProvider = (
  config: CurrentFindingsProviderConfig
): ClaimProvider => {
  const redactor = createRedactor()

  return {
    id: 'current-findings',
    gather: async () =>
      eligibleCurrentFindings(config.findings, config.minSeverity)
        .slice(0, MAX_CLAIMS_PER_PROVIDER)
        .map((finding) =>
          redactClaim(claimFromAdmittedFinding(finding), redactor.redact)
        )
  }
}
