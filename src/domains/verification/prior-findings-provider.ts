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
import { BaselineFileSchema, type BaselineEntry } from '../admission/index.js'
import {
  fingerprintEvidenceRefs,
  fingerprintKey
} from './claim-fingerprints.js'
import { MAX_CLAIMS_PER_PROVIDER, type ClaimProvider } from './contracts.js'
import { redactClaim } from './redact-claim.js'

type PriorFindingsConfig = z.infer<typeof VerificationPriorFindingsProviderSchema>

const isEnoent = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'ENOENT'

const CLAIM_TITLE_MAX = 200
const CLAIM_QUESTION_MAX = 500
const CLAIM_DETAIL_MAX = 2000

// A claim carries at most this many `fingerprint:<algorithm>` evidence refs, so a
// baseline entry with many fingerprints cannot exceed the `Claim.evidenceRefs`
// cap. The refs are what let a verdict be matched back to the baselined finding.
const CLAIM_FINGERPRINT_REFS_MAX = 20

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
    evidenceRefs: fingerprintEvidenceRefs(finding.fingerprints)
  })

// A baseline entry records fingerprints and nothing else (see the baseline
// writer: the file deliberately discloses no path, title, or finding text), so
// the claim it yields names the entry by fingerprint and states plainly that no
// location or description is available. Carrying the fingerprints as evidence
// refs is what still lets a verdict be matched back to the baselined finding.
const claimFromBaselineEntry = (entry: BaselineEntry): Claim => {
  const fingerprints = entry.fingerprints.slice(0, CLAIM_FINGERPRINT_REFS_MAX)
  const keys = fingerprints.map(fingerprintKey).join(', ')

  return ClaimSchema.parse({
    id: `claim_${sha256(`prior-baseline:${entry.fingerprints.map(fingerprintKey).join('|')}`).slice(0, 24)}`,
    kind: 'prior-finding',
    title: truncateForContract(`Baselined finding ${keys}`, CLAIM_TITLE_MAX),
    detail: truncateForContract(
      `A previous run baselined a finding recorded under fingerprint(s) ${keys}. The baseline stores fingerprints only, so no location, title, or description of the finding is available; establish from the current code whether a defect matching this fingerprint is still present.`,
      CLAIM_DETAIL_MAX
    ),
    source: 'prior-finding',
    question: truncateForContract(
      `Does the baselined finding recorded under fingerprint(s) ${keys} still hold in the current code, or has it been fixed?`,
      CLAIM_QUESTION_MAX
    ),
    evidenceRefs: fingerprints.map((fingerprint) => ({
      key: `fingerprint:${fingerprint.algorithm}`,
      value: fingerprint.value
    }))
  })
}

// A review report is a JSON object; a baseline file is a JSON array. The two
// shapes are disjoint at the top level, so the parsed JSON type — not a
// try-one-then-the-other cascade — selects the parser, and neither kind can be
// silently misread as the other.
const claimsFromPriorFindingsSource = (
  parsed: unknown,
  sourcePath: string
): readonly Claim[] => {
  if (Array.isArray(parsed)) {
    const baseline = BaselineFileSchema.safeParse(parsed)

    if (!baseline.success) {
      throw new TypeError(
        `Prior-findings source "${sourcePath}" is a JSON array but is not a valid baseline file (an array of entries carrying a non-empty "fingerprints" list).`
      )
    }

    return baseline.data
      .slice(0, MAX_CLAIMS_PER_PROVIDER)
      .map((entry) => claimFromBaselineEntry(entry))
  }

  const report = ReviewReportSchema.safeParse(parsed)

  if (!report.success) {
    throw new TypeError(
      `Prior-findings source "${sourcePath}" is neither a review report nor a baseline file.`
    )
  }

  return report.data.admittedFindings
    .slice(0, MAX_CLAIMS_PER_PROVIDER)
    .map((finding) => claimFromAdmittedFinding(finding))
}

/**
 * Derives claims from a previous run's report **or the baseline** (spec 12
 * "Claim Sources"): each prior finding becomes a `prior-finding` claim asking
 * whether it still holds or has been fixed in the current code, carrying the
 * finding's fingerprints — and, from a report, its location — so a
 * `confirmed`/`refuted` verdict can be matched back to it (spec 12
 * Corroboration).
 *
 * The source file resolves under the repository root through path-service. A
 * missing file yields no claims (the pipeline may not have a previous run yet).
 * A file that exists but is not valid JSON, or matches neither the
 * `ReviewReport` nor the baseline shape, is a genuine provider failure and
 * propagates so the caller can record it as a non-fatal run warning (matching
 * how context-ingestion surfaces provider failure).
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

      const claims = claimsFromPriorFindingsSource(JSON.parse(raw), config.report)

      return claims.map((claim) => redactClaim(claim, redactor.redact))
    }
  }
}
