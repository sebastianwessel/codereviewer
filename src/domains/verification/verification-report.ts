// Output contracts for the agentic verification flow (spec 12). Verdicts live in
// a verification lane separate from the defect-finding report and never enter the
// defect quality gate. The flow validates its own output at this boundary so a
// model-authored verdict cannot smuggle untyped data downstream.

import { z } from 'zod'
import { FixEditSchema } from '../../shared/contracts/findings/finding.schema.js'
import {
  FindingCorroborationSchema,
  type CorroborationMatchKind,
  type FindingCorroboration
} from '../../shared/contracts/report/review-report.schema.js'
import { LaneUsageSchema } from '../costs/index.js'
import { ContextLedgerEntrySchema } from '../review-planning/index.js'
import { MAX_CLAIMS_PER_PROVIDER } from './contracts.js'
import {
  ClaimIdSchema,
  ClaimKindSchema,
  FindingJudgmentSchema,
  VerdictStatusSchema,
  VerdictSchema,
  VERDICT_FIX_EDITS_MAX
} from '../../shared/contracts/verification/verification.schema.js'

// The outcome shape the `investigate_claim` agent authors. It answers the claim's
// question; `claimId` and `fingerprints` are supplied by CODE (from the claim)
// rather than trusted from the model, so this model-facing schema omits them.
// `findingJudgment` and `fixEdits` are populated only when investigating one of
// this run's admitted findings (a `current-finding` claim); the flow ignores them
// for other claim kinds.
export const ModelVerdictSchema = z.strictObject({
  status: VerdictStatusSchema,
  findingJudgment: FindingJudgmentSchema.optional(),
  fixEdits: z.array(FixEditSchema).max(VERDICT_FIX_EDITS_MAX).optional(),
  rationale: z.string().min(1),
  citedEvidenceIds: z.array(z.string()).default([])
})

export type ModelVerdict = z.infer<typeof ModelVerdictSchema>

// Reason a claim ended `uncertain` because CODE (never the model) hit a bound.
// `tool-call-budget-exceeded` is the per-claim loop bound; `aborted` is a
// caller-supplied cancellation (there is no whole-run deadline in the engine);
// `invalid-verdict` is a model verdict that failed schema validation;
// `agent-error` is any other agent/provider failure.
export const VerificationBoundReasonSchema = z.enum([
  'tool-call-budget-exceeded',
  'aborted',
  'invalid-verdict',
  // The provider refused the investigation as too large, and narrowing what a
  // read returns did not make it fit. Distinct from `agent-error` on purpose: a
  // reader seeing "the agent could not complete" looks for a broken agent, and
  // this is a context that will not fit however many times it is retried. Naming
  // it is what makes the limit actionable instead of merely inconclusive.
  'context-length-exceeded',
  'agent-error'
])

export type VerificationBoundReason = z.infer<typeof VerificationBoundReasonSchema>

export const ApplyCheckOutcomeSchema = z.enum(['passed', 'failed', 'not-attempted'])

export type ApplyCheckOutcome = z.infer<typeof ApplyCheckOutcomeSchema>

// Why a fix the agent DID propose was refused before the apply-check ran.
//
// Present only in that case, so its absence means the check ran or there was
// nothing to check — never "declined for a reason we did not record". Without it,
// a refusal was reported as `applyCheck: 'not-attempted'`, which is exactly what a
// finding with no proposed fix reports, so "the agent proposed nothing" and "the
// agent proposed something this lane will not carry" were the same record. They are
// opposite situations for whoever reads it: the second is a fix that exists and was
// withheld.
//
// It is a reason for the REFUSAL rather than a fourth apply-check outcome because
// the apply-check genuinely did not run; overloading its result would say it did.
export const FixDeclinedReasonSchema = z.enum(['edits-outside-finding-file'])

export type FixDeclinedReason = z.infer<typeof FixDeclinedReasonSchema>

// No-content per-claim observation (spec 12 "Observability And Errors"): claim
// kind, source label, tool-call count, bytes read, verdict status, the finding
// judgment (or absent), whether a fix was produced, the apply-check outcome, and
// duration. It carries no source, claim/finding text, fix text, or tool output.
export const ClaimObservationSchema = z.strictObject({
  claimId: ClaimIdSchema,
  claimKind: ClaimKindSchema,
  source: z.string(),
  status: VerdictStatusSchema,
  findingJudgment: FindingJudgmentSchema.optional(),
  fixProduced: z.boolean().optional(),
  applyCheck: ApplyCheckOutcomeSchema.optional(),
  fixDeclinedReason: FixDeclinedReasonSchema.optional(),
  toolCalls: z.int().min(0),
  bytesRead: z.int().min(0),
  durationMs: z.int().min(0),
  boundReason: VerificationBoundReasonSchema.optional()
})

export type ClaimObservation = z.infer<typeof ClaimObservationSchema>

// Corroboration records are defined in the REPORT contract and imported here.
// The review report and this one carry the same records, and one shape for one
// fact is what keeps them from drifting.

// Per-finding advisory result of the fix lane (spec 12 "Effect On Findings").
// `findingJudgment` is the boolean precision signal (absent when the agent
// established neither); `fixProduced` records whether an apply-checked fix
// enriched the finding's `fixProposal`; `applyCheck` records how the
// deterministic apply-check went. It is a separate structure — the admitted
// finding contract, its severity, admission, and the gate are all left untouched.
export const FixOutcomeSchema = z.strictObject({
  findingId: z.string().min(1),
  findingJudgment: FindingJudgmentSchema.optional(),
  fixProduced: z.boolean(),
  applyCheck: ApplyCheckOutcomeSchema,
  // Set only when a proposed fix was refused before the apply-check; see
  // `FixDeclinedReasonSchema`.
  fixDeclinedReason: FixDeclinedReasonSchema.optional()
})

export type FixOutcome = z.infer<typeof FixOutcomeSchema>

// Token usage and cost for the verification model calls. The flow runs after the
// general review's report is finalized, so its spend is accounted here (in its own
// lane) rather than silently dropped from the run cost.
export const VerificationReportSchema = z.strictObject({
  verdicts: z.array(VerdictSchema).default([]),
  observations: z.array(ClaimObservationSchema).default([]),
  // Redacted, no-content run warnings (e.g. a claim provider that failed at run
  // time). Provider failures are non-fatal and surface here (spec 12).
  warnings: z.array(z.string()).default([]),
  claimCount: z.int().min(0).default(0),
  // General-review findings independently confirmed by a verification verdict.
  // Confidence signal only; never changes a finding's severity or the report.
  corroborations: z.array(FindingCorroborationSchema).default([]),
  // Advisory per-finding results of the fix lane (judgment + fix outcome). A
  // signal only; it never changes a finding's severity, admission, or the gate.
  fixOutcomes: z.array(FixOutcomeSchema).default([]),
  // The context ledger for every mediated tool call the investigation agent made
  // (spec 12 "Tools": each call "records a context-ledger entry"). It lives in
  // this report because that is the artifact this lane writes: without it the
  // entries the retriever creates would be discarded and the evidence ids in
  // `Verdict.citedEvidenceIds` would name records no artifact holds. Entries are
  // no-content by construction — path, byte counts, and a content hash only.
  contextLedger: z.array(ContextLedgerEntrySchema).default([]),
  // Token usage and cost of the verification model calls, when a provider ran.
  usage: LaneUsageSchema.optional()
})

export type VerificationReport = z.infer<typeof VerificationReportSchema>

export type { CorroborationMatchKind, FindingCorroboration }

export const emptyVerificationReport = (): VerificationReport =>
  VerificationReportSchema.parse({})

// Prefix the flow uses for a non-fatal claim-provider failure warning. The suffix
// is the provider id. Kept as a constant so the flow that emits it and the CLI
// that maps it to a human-readable run warning agree on the format.
export const CLAIM_PROVIDER_FAILED_WARNING_PREFIX = 'claim-provider-failed:'

// Prefix for a non-fatal per-provider claim-cap warning. The suffix is
// `<withheld>:<providerId>` — the COUNT FIRST, because a provider id itself
// contains a colon (`claims-file:<path>`) and would otherwise make the suffix
// unparseable.
export const CLAIM_PROVIDER_CAPPED_WARNING_PREFIX = 'claim-provider-capped:'

// Prefix for a non-fatal malformed-entry warning. Same suffix shape and same
// count-first reason as the cap warning above; a separate prefix because the two
// losses are separately counted and must stay separately reported.
export const CLAIM_PROVIDER_MALFORMED_WARNING_PREFIX = 'claim-provider-malformed:'

// Splits a `<count>:<providerId>` warning suffix. Shared by the two counted
// provider warnings so they cannot drift on how the suffix is parsed.
const splitCountedProviderSuffix = (
  suffix: string
): { readonly count: string; readonly providerId: string } => {
  const separator = suffix.indexOf(':')

  return {
    count: suffix.slice(0, separator),
    providerId: suffix.slice(separator + 1)
  }
}

const cappedProviderRunWarning = (suffix: string): string => {
  const { count, providerId } = splitCountedProviderSuffix(suffix)

  return `Verification claim provider "${providerId}" reached the per-provider cap of ${MAX_CLAIMS_PER_PROVIDER} claims; ${count} further claim(s) were not investigated.`
}

const malformedProviderRunWarning = (suffix: string): string => {
  const { count, providerId } = splitCountedProviderSuffix(suffix)

  return `Verification claim provider "${providerId}" skipped ${count} entry(ies) that are not valid claims; they were not investigated.`
}

// Maps the verification report's no-content warnings to run-warning strings the
// review report surfaces, mirroring the change-intent provider-failure warning:
// a failed claim provider is non-fatal and shows up as a run warning so the
// degradation is visible rather than silent (spec 12 "Observability And Errors").
export const runWarningsForVerificationReport = (
  report: VerificationReport
): string[] =>
  report.warnings.map((warning) => {
    if (warning.startsWith(CLAIM_PROVIDER_FAILED_WARNING_PREFIX)) {
      return `Verification claim provider "${warning.slice(
        CLAIM_PROVIDER_FAILED_WARNING_PREFIX.length
      )}" failed and was skipped.`
    }

    // A capped provider is a partial answer, not a failure: the claims that were
    // investigated are sound, and the ones past the cap were never judged. Both
    // belong in the run warnings, because `claimCount` reports the post-cap
    // number and nothing else in the report distinguishes the two runs.
    if (warning.startsWith(CLAIM_PROVIDER_CAPPED_WARNING_PREFIX)) {
      return cappedProviderRunWarning(
        warning.slice(CLAIM_PROVIDER_CAPPED_WARNING_PREFIX.length)
      )
    }

    // A malformed entry is the same kind of partial answer as a capped one: the
    // claims that were read are sound, and the ones that could not be read were
    // never judged. `claimCount` counts only the former.
    if (warning.startsWith(CLAIM_PROVIDER_MALFORMED_WARNING_PREFIX)) {
      return malformedProviderRunWarning(
        warning.slice(CLAIM_PROVIDER_MALFORMED_WARNING_PREFIX.length)
      )
    }

    return warning
  })
