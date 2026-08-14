// Contracts for the agentic verification flow's claim providers (spec 12).
//
// This mirrors the context-ingestion provider shape (spec 11): the core depends
// only on `ClaimProvider`, and a new claim source (analyzer, comment, ...) is a
// new provider implementation added without changing the flow. Claim inputs are
// untrusted (spec 12): a provider only produces `Claim` records for the agent to
// investigate, never anything that can grant authority or change admission,
// severity, gates, or baseline.

import type { Claim } from '../../shared/contracts/verification/verification.schema.js'

export type ClaimGatherInput = {
  readonly repositoryRoot: string
  readonly signal?: AbortSignal | undefined
}

/**
 * What one provider contributed, together with what its cap left behind — the
 * same shape and the same reason as context-ingestion's `ContextGatherOutput`.
 */
export type ClaimGatherOutput = {
  readonly claims: readonly Claim[]
  /**
   * How many further eligible claims `MAX_CLAIMS_PER_PROVIDER` withheld.
   *
   * Required, not optional: a provider that applies the cap must say so. Every
   * claim past it is never judged and never fixed, and `claimCount` on the
   * verification report records the POST-cap number, so without this a run that
   * investigated 200 of 900 findings reports identically to one that investigated
   * all 200 it had — and a reader concludes every eligible finding was looked at.
   *
   * Counts ONLY what the cap withheld. A malformed entry a provider skips is a
   * different loss and must not be folded in here.
   */
  readonly withheldByCap: number
  /**
   * How many entries the provider read but could not turn into a `Claim` —
   * records that failed the `Claim` schema and were skipped.
   *
   * The counterpart to `withheldByCap`, and required for the same reason. A
   * skipped entry is never judged and never fixed, and skipping it silently makes
   * a claims file whose records all have the wrong shape indistinguishable from an
   * empty one: the run reports zero claims and reads as "nothing to verify". A
   * provider that cannot drop entries reports 0.
   */
  readonly malformedEntryCount: number
}

export type ClaimProvider = {
  readonly id: string
  gather(input: ClaimGatherInput): Promise<ClaimGatherOutput>
}

// Bound on the number of claims a single provider contributes per run. Keeps a
// large claims file or a report with many admitted findings from turning into an
// unbounded number of costly `investigate_claim` agent runs (the loop bound per claim
// is separately enforced by `verification.maxToolCallsPerClaim`).
export const MAX_CLAIMS_PER_PROVIDER = 200

/**
 * Applies the per-provider cap and reports what it withheld, so the three
 * providers cannot drift on how the cap is counted and a fourth cannot apply it
 * while forgetting to disclose it.
 */
export const capProviderClaims = <T>(
  eligible: readonly T[]
): { readonly kept: readonly T[]; readonly withheldByCap: number } => ({
  kept: eligible.slice(0, MAX_CLAIMS_PER_PROVIDER),
  withheldByCap: Math.max(eligible.length - MAX_CLAIMS_PER_PROVIDER, 0)
})
