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

export type ClaimProvider = {
  readonly id: string
  gather(input: ClaimGatherInput): Promise<readonly Claim[]>
}

// Bound on the number of claims a single provider contributes per run. Keeps a
// large claims file or a report with many admitted findings from turning into an
// unbounded number of costly `verify_claim` agent runs (the loop bound per claim
// is separately enforced by `verification.maxToolCallsPerClaim`).
export const MAX_CLAIMS_PER_PROVIDER = 200
