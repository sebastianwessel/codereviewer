// Contracts for the agentic verification flow (spec 12). A `Claim` is a single
// assertion the flow investigates with bounded, mediated repository tools; a
// `Verdict` is the flow's reasoned answer. Both are strict schemas so a claim
// provider or the verification agent cannot smuggle untyped data through the
// flow (claim inputs are untrusted per spec 12: they cannot grant authority or
// change admission, severity, gates, or baseline).

import { z } from 'zod'
import {
  CodeLocationSchema,
  ContractIdSchema,
  FindingFingerprintSchema,
  prefixedIdSchema
} from '../findings/finding.schema.js'

export const ClaimIdSchema = prefixedIdSchema('claim')

export const ClaimKindSchema = z.enum(['prior-finding', 'analyzer', 'comment', 'fix'])

// Bounded free-form supporting data carried from the claim's source (e.g. an
// analyzer rule id, a CWE, or a data-flow summary). Kept as a bounded array of
// key/value pairs rather than an open record so a claim provider cannot inject
// an unbounded number of fields into the prompt context.
export const ClaimEvidenceRefSchema = z.strictObject({
  key: z.string().min(1).max(120),
  value: z.string().min(1).max(500)
})

export const ClaimSchema = z.strictObject({
  id: ClaimIdSchema,
  kind: ClaimKindSchema,
  title: z.string().min(1).max(200),
  detail: z.string().min(1).max(2000),
  location: CodeLocationSchema.optional(),
  source: z.string().min(1).max(200),
  question: z.string().min(1).max(500),
  evidenceRefs: z.array(ClaimEvidenceRefSchema).max(20).optional()
})

export const VerdictStatusSchema = z.enum(['confirmed', 'refuted', 'uncertain'])

// Max length for a verdict rationale. Exported so construction sites that copy
// model-authored rationale truncate to the same cap (single source of truth)
// before parsing, mirroring `REJECTED_FINDING_MESSAGE_MAX`.
export const VERDICT_RATIONALE_MAX = 1000

export const VerdictSchema = z.strictObject({
  claimId: ClaimIdSchema,
  status: VerdictStatusSchema,
  rationale: z.string().min(1).max(VERDICT_RATIONALE_MAX),
  citedEvidenceIds: z.array(ContractIdSchema).default([]),
  fingerprints: z.array(FindingFingerprintSchema).min(1)
})

export type ClaimId = z.infer<typeof ClaimIdSchema>
export type ClaimKind = z.infer<typeof ClaimKindSchema>
export type ClaimEvidenceRef = z.infer<typeof ClaimEvidenceRefSchema>
export type Claim = z.infer<typeof ClaimSchema>
export type VerdictStatus = z.infer<typeof VerdictStatusSchema>
export type Verdict = z.infer<typeof VerdictSchema>
