import { readFile } from 'node:fs/promises'
import { resolveExistingPathInsideRoot } from '../../platform/path-service.js'
import type { VerificationPriorFindingsProviderSchema } from '../../shared/contracts/config/config.schema.js'
import { ReviewReportSchema } from '../../shared/contracts/report/review-report.schema.js'
import type { AdmittedFinding } from '../../shared/contracts/findings/finding.schema.js'
import {
  ClaimSchema,
  type Claim
} from '../../shared/contracts/verification/verification.schema.js'
import { createRedactor } from '../../shared/redaction/redactor.js'
import { sha256 } from '../../shared/hash/hash.js'
import { truncateForContract } from '../../shared/text/truncate.js'
import type { z } from 'zod'
import { MAX_CLAIMS_PER_PROVIDER, type ClaimProvider } from './contracts.js'
import { redactClaim } from './redact-claim.js'

type PriorFindingsConfig = z.infer<typeof VerificationPriorFindingsProviderSchema>

const isEnoent = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'ENOENT'

const CLAIM_QUESTION_MAX = 500
const CLAIM_DETAIL_MAX = 2000

const claimFromAdmittedFinding = (finding: AdmittedFinding): Claim =>
  ClaimSchema.parse({
    id: `claim_${sha256(`prior-finding:${finding.id}`).slice(0, 24)}`,
    kind: 'prior-finding',
    title: finding.title,
    detail: truncateForContract(finding.description, CLAIM_DETAIL_MAX),
    location: finding.location,
    source: 'prior-finding',
    question: truncateForContract(
      `Does the prior finding still hold in the current code, or has it been fixed: ${finding.title}?`,
      CLAIM_QUESTION_MAX
    ),
    evidenceRefs: finding.fingerprints.map((fingerprint) => ({
      key: `fingerprint:${fingerprint.algorithm}`,
      value: fingerprint.value
    }))
  })

/**
 * Derives claims from a previous run's report: each admitted finding becomes a
 * `prior-finding` claim asking whether it still holds or has been fixed in the
 * current code, carrying the finding's location and fingerprints so a
 * `confirmed`/`refuted` verdict can be matched back to it (spec 12
 * Corroboration).
 *
 * The report resolves under the repository root through path-service. A missing
 * report yields no claims (the pipeline may not have a previous run yet). A
 * report that exists but is not valid JSON, or does not match the
 * `ReviewReport` schema, is a genuine provider failure and propagates so the
 * caller can record it as a non-fatal run warning (matching how
 * context-ingestion surfaces provider failure).
 */
export const createPriorFindingsProvider = (
  config: PriorFindingsConfig
): ClaimProvider => {
  const redactor = createRedactor()

  return {
    id: `prior-findings:${config.report}`,
    gather: async (input) => {
      let raw: string
      try {
        raw = await readFile(
          await resolveExistingPathInsideRoot(input.repositoryRoot, config.report),
          'utf8'
        )
      } catch (error) {
        if (isEnoent(error)) {
          return []
        }
        throw error
      }

      const report = ReviewReportSchema.parse(JSON.parse(raw))

      const claims = report.admittedFindings
        .slice(0, MAX_CLAIMS_PER_PROVIDER)
        .map((finding) => claimFromAdmittedFinding(finding))

      return claims.map((claim) => redactClaim(claim, redactor.redact))
    }
  }
}
