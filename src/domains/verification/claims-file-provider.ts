import { readFile } from 'node:fs/promises'
import { resolveExistingPathInsideRoot } from '../../platform/path-service.js'
import type { VerificationClaimsFileProviderSchema } from '../../shared/contracts/config/config.schema.js'
import { ClaimSchema } from '../../shared/contracts/verification/verification.schema.js'
import { createRedactor } from '../../shared/redaction/redactor.js'
import type { z } from 'zod'
import { capProviderClaims, type ClaimProvider } from './contracts.js'
import { redactClaim } from './redact-claim.js'
import { isFileNotFoundError } from '../../shared/errors/error-normalizer.js'

type ClaimsFileConfig = z.infer<typeof VerificationClaimsFileProviderSchema>


/**
 * Reads a neutral claims file a pipeline wrote before the run — a JSON array of
 * `Claim` records. This is the decoupled path for any external claim source
 * (analyzer output, review comments, ...), exactly as the context inbox is for
 * change-intent context: the pipeline owns the fetch and its credentials, and
 * the product never integrates those systems directly.
 *
 * The file resolves under the repository root through path-service. A missing
 * file yields no claims (it is optional pipeline output). A file that exists but
 * is not valid JSON, or whose top level is not an array, is a genuine provider
 * failure and propagates so the caller can record it as a non-fatal run warning
 * (matching how context-ingestion surfaces provider failure). An individual
 * array entry that fails the `Claim` schema is skipped on its own so one
 * malformed record does not discard the rest of an otherwise-valid file.
 */
export const createClaimsFileProvider = (config: ClaimsFileConfig): ClaimProvider => {
  const redactor = createRedactor()

  return {
    id: `claims-file:${config.path}`,
    gather: async (input) => {
      let raw: string
      try {
        raw = await readFile(
          await resolveExistingPathInsideRoot(input.repositoryRoot, config.path),
          'utf8'
        )
      } catch (error) {
        if (isFileNotFoundError(error)) {
          return { claims: [], withheldByCap: 0 }
        }
        throw error
      }

      const parsed: unknown = JSON.parse(raw)

      if (!Array.isArray(parsed)) {
        throw new TypeError(`Claims file "${config.path}" must contain a JSON array.`)
      }

      // The cap is applied to ENTRIES, so `withheldByCap` counts exactly what the
      // cap held back and never absorbs the malformed entries dropped below —
      // two different losses that would be indistinguishable if merged.
      const { kept, withheldByCap } = capProviderClaims(parsed)
      const claims = kept.flatMap((entry) => {
        const result = ClaimSchema.safeParse(entry)
        return result.success ? [result.data] : []
      })

      return {
        claims: claims.map((claim) => redactClaim(claim, redactor.redact)),
        withheldByCap
      }
    }
  }
}
