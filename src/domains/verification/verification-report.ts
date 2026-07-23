// Output contracts for the agentic verification flow (spec 12). Verdicts live in
// a verification lane separate from the defect-finding report and never enter the
// defect quality gate. The flow validates its own output at this boundary so a
// model-authored verdict cannot smuggle untyped data downstream.

import { z } from 'zod'
import {
  ClaimIdSchema,
  ClaimKindSchema,
  VerdictSchema,
  VerdictStatusSchema
} from '../../shared/contracts/verification/verification.schema.js'

// The verdict shape the `verify_claim` agent authors. It answers the claim's
// question; `claimId` and `fingerprints` are supplied by CODE (from the claim)
// rather than trusted from the model, so this model-facing schema omits them.
export const ModelVerdictSchema = z.strictObject({
  status: VerdictStatusSchema,
  rationale: z.string().min(1),
  citedEvidenceIds: z.array(z.string()).default([])
})

export type ModelVerdict = z.infer<typeof ModelVerdictSchema>

// Reason a claim ended `uncertain` because CODE (never the model) hit a bound.
// `tool-call-budget-exceeded` is the per-claim loop bound; `aborted` is the run
// timeout / cancellation; `invalid-verdict` is a model verdict that failed
// schema validation; `agent-error` is any other agent/provider failure.
export const VerificationBoundReasonSchema = z.enum([
  'tool-call-budget-exceeded',
  'aborted',
  'invalid-verdict',
  'agent-error'
])

export type VerificationBoundReason = z.infer<typeof VerificationBoundReasonSchema>

// No-content per-claim observation (spec 12 "Observability And Errors"): claim
// kind, source label, tool-call count, bytes read, verdict status, and duration.
// It carries no source, claim text, or tool output.
export const ClaimObservationSchema = z.strictObject({
  claimId: ClaimIdSchema,
  claimKind: ClaimKindSchema,
  source: z.string(),
  status: VerdictStatusSchema,
  toolCalls: z.int().min(0),
  bytesRead: z.int().min(0),
  durationMs: z.int().min(0),
  boundReason: VerificationBoundReasonSchema.optional()
})

export type ClaimObservation = z.infer<typeof ClaimObservationSchema>

export const CorroborationMatchKindSchema = z.enum(['fingerprint', 'fuzzy'])

// Links a general-review admitted finding to the confirming verification
// verdict(s) that independently support it (spec 12 "Corroboration"). It raises
// a CONFIDENCE signal only — there is deliberately no severity field, and the
// admitted finding contract is left untouched.
export const FindingCorroborationSchema = z.strictObject({
  findingId: z.string().min(1),
  confidence: z.literal('corroborated'),
  matchKinds: z.array(CorroborationMatchKindSchema),
  witnessClaimIds: z.array(z.string().min(1))
})

export const VerificationReportSchema = z.strictObject({
  verdicts: z.array(VerdictSchema).default([]),
  observations: z.array(ClaimObservationSchema).default([]),
  // Redacted, no-content run warnings (e.g. a claim provider that failed at run
  // time). Provider failures are non-fatal and surface here (spec 12).
  warnings: z.array(z.string()).default([]),
  claimCount: z.int().min(0).default(0),
  // General-review findings independently confirmed by a verification verdict.
  // Confidence signal only; never changes a finding's severity or the report.
  corroborations: z.array(FindingCorroborationSchema).default([])
})

export type CorroborationMatchKind = z.infer<typeof CorroborationMatchKindSchema>
export type FindingCorroboration = z.infer<typeof FindingCorroborationSchema>

export type VerificationReport = z.infer<typeof VerificationReportSchema>

export const emptyVerificationReport = (): VerificationReport =>
  VerificationReportSchema.parse({})

// Prefix the flow uses for a non-fatal claim-provider failure warning. The suffix
// is the provider id. Kept as a constant so the flow that emits it and the CLI
// that maps it to a human-readable run warning agree on the format.
export const CLAIM_PROVIDER_FAILED_WARNING_PREFIX = 'claim-provider-failed:'

// Maps the verification report's no-content warnings to run-warning strings the
// review report surfaces, mirroring the change-intent provider-failure warning:
// a failed claim provider is non-fatal and shows up as a run warning so the
// degradation is visible rather than silent (spec 12 "Observability And Errors").
export const runWarningsForVerificationReport = (
  report: VerificationReport
): string[] =>
  report.warnings.map((warning) =>
    warning.startsWith(CLAIM_PROVIDER_FAILED_WARNING_PREFIX)
      ? `Verification claim provider "${warning.slice(
          CLAIM_PROVIDER_FAILED_WARNING_PREFIX.length
        )}" failed and was skipped.`
      : warning
  )
