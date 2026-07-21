import { z } from 'zod'
import { FindingFingerprintSchema } from '../../shared/contracts/index.js'
import type { BaselineFingerprintRecord } from './baseline-matcher.js'

export const BaselineEntrySchema = z.strictObject({
  fingerprints: z.array(FindingFingerprintSchema).min(1)
})

export const BaselineFileSchema = z.array(BaselineEntrySchema)

export type BaselineEntry = z.infer<typeof BaselineEntrySchema>

/**
 * Projects a completed report's admitted findings into baseline entries.
 *
 * Fingerprints are copied verbatim rather than recomputed: recomputing them
 * here would need the source state the report was produced against, and a
 * fingerprint derived from anything else could never match a later run.
 *
 * Entries carry fingerprints only, so the baseline file discloses no source
 * content, path, or finding text.
 */
export const buildBaselineEntries = (
  admittedFindings: readonly { readonly fingerprints: readonly unknown[] }[]
): readonly BaselineFingerprintRecord[] =>
  BaselineFileSchema.parse(
    admittedFindings
      .filter((finding) => finding.fingerprints.length > 0)
      .map((finding) => ({ fingerprints: finding.fingerprints }))
  )

export const renderBaselineJson = (
  entries: readonly BaselineFingerprintRecord[]
): string => `${JSON.stringify(entries, undefined, 2)}\n`
