// The agentic verification flow runner (spec 12). For every claim gathered from
// the configured providers it runs the `investigate_claim` agent in a bounded loop,
// enforces the per-claim bounds in CODE (never the model), and produces the
// verification-lane report: verdicts, no-content observations, and non-fatal run
// warnings. It accumulates token usage across claims.
//
// The agent invocation is injected as `investigateClaim` so the pure orchestration —
// claim gathering, bound enforcement, verdict assembly — is unit-testable with a
// fake runner and never reaches a real provider. Production wires the harness
// `investigate_claim` agent through this seam (see `investigation-run.ts`).

import type { Logger } from '@purista/harness'
import { combineRunTokenUsage, type RunTokenUsage } from '../costs/index.js'
import {
  ContractIdSchema,
  type Claim,
  type FindingJudgment,
  type FixEdit,
  type Verdict
} from '../../shared/contracts/index.js'
import {
  VerdictSchema,
  VERDICT_RATIONALE_MAX
} from '../../shared/contracts/verification/verification.schema.js'
import { truncateForContract } from '../../shared/text/truncate.js'
import {
  createContextRetriever,
  type ContextRetrievalEligibilityConfig,
  createBoundedRetrievalTools,
  isToolCallBudgetExceededError,
  type RetrievalTools
} from '../context-retrieval/index.js'
import { isContextLengthExceeded } from '../../shared/errors/context-overflow.js'
import type { ContextLedgerEntry } from '../review-planning/index.js'
import type { ClaimProvider } from './contracts.js'
import { fingerprintsForClaim } from './claim-fingerprints.js'
import {
  CLAIM_PROVIDER_FAILED_WARNING_PREFIX,
  ModelVerdictSchema,
  VerificationReportSchema,
  type ClaimObservation,
  type ModelVerdict,
  type VerificationBoundReason,
  type VerificationReport
} from './verification-report.js'

// Maximum number of evidence records a verdict cites. Bounds the report so a
// long investigation cannot emit an unbounded cited-evidence list.
const MAX_CITED_EVIDENCE = 100

export type ClaimAgentResult = {
  readonly verdict: ModelVerdict
  readonly usage?: RunTokenUsage | undefined
}

// The injected per-claim agent runner. It receives the (untrusted) claim and the
// bounded tools and returns a model verdict. It may call the tools any number of
// times; the tools enforce the byte/match caps and the per-claim tool-call
// budget themselves.
export type ClaimAgentRunner = (input: {
  readonly claim: Claim
  readonly tools: RetrievalTools
  readonly signal?: AbortSignal | undefined
}) => Promise<ClaimAgentResult>

export type RunVerificationFlowInput = {
  readonly providers: readonly ClaimProvider[]
  readonly repositoryRoot: string
  readonly investigateClaim: ClaimAgentRunner
  readonly maxToolCallsPerClaim: number
  // Optional, and omitted rather than defaulted when the operator has not set
  // one: the retriever's own runaway guard then applies. See the config schema
  // for why a proactive per-read cap was removed here.
  readonly maxBytesPerRead?: number | undefined
  readonly maxMatches: number
  readonly paths?: ContextRetrievalEligibilityConfig | undefined
  readonly logger?: Logger | undefined
  readonly signal?: AbortSignal | undefined
  readonly onObservation?: (observation: ClaimObservation) => void
}

export type VerificationFlowResult = {
  readonly report: VerificationReport
  // The gathered claims, exposed so the caller can corroborate confirmed verdicts
  // against general-review findings by location (a verdict carries fingerprints
  // but not a location).
  readonly claims: readonly Claim[]
  readonly usage?: RunTokenUsage | undefined
}

const BOUND_RATIONALES: Record<VerificationBoundReason, string> = {
  'tool-call-budget-exceeded':
    'Verification ended without a conclusive verdict: the per-claim tool-call budget was exhausted before the claim could be resolved.',
  aborted:
    'Verification ended without a conclusive verdict: the run was cancelled or timed out before the claim could be resolved.',
  'invalid-verdict':
    'Verification ended without a conclusive verdict: the agent returned a verdict that did not satisfy the verdict contract.',
  'context-length-exceeded':
    'Verification ended without a conclusive verdict: the provider refused the investigation as exceeding its context length, and narrowing what each read returns did not make it fit. Nothing was truncated to force it through. Configure a model with a larger context window, or narrow the claim.',
  'agent-error':
    'Verification ended without a conclusive verdict: the verification agent could not complete the investigation.'
}

// How many times one claim may be retried against a narrowed read budget.
//
// `reduceReadBudget` halves toward its own floor and would terminate on its own,
// but every attempt is a paid agent run, so the bound is stated here rather than
// left to emerge from the arithmetic. Halving converges on the provider's real
// limit quickly — the first refusal already happens near it — so a small number
// is enough, and a claim that still does not fit after this is reported as not
// fitting rather than retried into a bill.
const MAX_READ_NARROWING_ATTEMPTS = 3

const investigateWithNarrowingReads = async (
  input: {
    readonly claim: Claim
    readonly tools: RetrievalTools
    readonly retriever: { readonly reduceReadBudget: () => boolean }
    readonly investigateClaim: ClaimAgentRunner
    readonly logger?: Logger | undefined
    readonly signal?: AbortSignal | undefined
  }
): Promise<ClaimAgentResult> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await input.investigateClaim({
        claim: input.claim,
        tools: input.tools,
        ...(input.signal === undefined ? {} : { signal: input.signal })
      })
    } catch (error) {
      if (
        !isContextLengthExceeded(error) ||
        attempt >= MAX_READ_NARROWING_ATTEMPTS ||
        !input.retriever.reduceReadBudget()
      ) {
        throw error
      }

      // Visible rather than silent: a claim answered against narrowed reads was
      // investigated differently from one that was not.
      input.logger?.warn?.(
        'Provider refused the claim investigation as too large; narrowing reads and retrying.',
        { claim_kind: input.claim.kind, attempt: attempt + 1 }
      )
    }
  }
}

const isAbort = (error: unknown, signal: AbortSignal | undefined): boolean =>
  signal?.aborted === true ||
  (error instanceof Error && error.name === 'AbortError')

const dedupeCitedEvidence = (
  evidenceIds: readonly string[]
): string[] => {
  const seen = new Set<string>()

  for (const id of evidenceIds) {
    if (seen.size >= MAX_CITED_EVIDENCE) {
      break
    }
    if (ContractIdSchema.safeParse(id).success) {
      seen.add(id)
    }
  }

  return [...seen]
}

const buildVerdict = (input: {
  readonly claim: Claim
  readonly status: Verdict['status']
  readonly rationale: string
  readonly citedEvidenceIds: readonly string[]
  // Populated only for `current-finding` claims (the fix lane): the agent's
  // real/false-positive judgment and its proposed apply-ready edits. Ignored for
  // every other claim kind so a verification claim can never carry them.
  readonly findingJudgment?: FindingJudgment | undefined
  readonly fixEdits?: readonly FixEdit[] | undefined
}): Verdict => {
  const isCurrentFinding = input.claim.kind === 'current-finding'

  return VerdictSchema.parse({
    claimId: input.claim.id,
    status: input.status,
    ...(isCurrentFinding && input.findingJudgment !== undefined
      ? { findingJudgment: input.findingJudgment }
      : {}),
    ...(isCurrentFinding &&
    input.fixEdits !== undefined &&
    input.fixEdits.length > 0
      ? { fixEdits: [...input.fixEdits] }
      : {}),
    rationale: truncateForContract(input.rationale, VERDICT_RATIONALE_MAX),
    citedEvidenceIds: dedupeCitedEvidence(input.citedEvidenceIds),
    fingerprints: fingerprintsForClaim(input.claim)
  })
}

const gatherClaims = async (
  input: RunVerificationFlowInput,
  warnings: string[]
): Promise<Claim[]> => {
  const claims: Claim[] = []

  for (const provider of input.providers) {
    try {
      const gathered = await provider.gather({
        repositoryRoot: input.repositoryRoot,
        ...(input.signal === undefined ? {} : { signal: input.signal })
      })
      claims.push(...gathered)
    } catch {
      // Claim provider failures are non-fatal (spec 12): record a no-content
      // warning that names only the provider id and proceed without its claims.
      input.logger?.warn?.('Claim provider failed; skipping its claims.', {
        provider_id: provider.id
      })
      warnings.push(`${CLAIM_PROVIDER_FAILED_WARNING_PREFIX}${provider.id}`)
    }
  }

  return claims
}

export const runVerificationFlow = async (
  input: RunVerificationFlowInput
): Promise<VerificationFlowResult> => {
  const warnings: string[] = []
  const claims = await gatherClaims(input, warnings)
  const verdicts: Verdict[] = []
  const observations: ClaimObservation[] = []
  // One ledger for the whole flow, so every mediated tool call across every claim
  // is recorded in the report this lane writes (spec 12 "Tools"). Without a sink
  // the retriever's entries are created and dropped, and the evidence ids the
  // verdicts cite name records no artifact holds.
  const contextLedger: ContextLedgerEntry[] = []
  let usage: RunTokenUsage | undefined

  for (const claim of claims) {
    const startedAt = Date.now()
    const retriever = createContextRetriever({
      repositoryRoot: input.repositoryRoot,
      ledgerEntries: contextLedger,
      budget: {
        ...(input.maxBytesPerRead === undefined
          ? {}
          : { maxBytesPerRead: input.maxBytesPerRead }),
        maxMatches: input.maxMatches,
        // The unified per-claim tool-call counter governs the loop, so the
        // retriever's own per-kind read/search counters are set to the same cap
        // and never trip first.
        maxReads: input.maxToolCallsPerClaim,
        maxSearches: input.maxToolCallsPerClaim
      },
      ...(input.paths === undefined ? {} : { paths: input.paths })
    })
    const bounded = createBoundedRetrievalTools({
      retriever,
      maxToolCalls: input.maxToolCallsPerClaim
    })

    let verdict: Verdict
    let boundReason: VerificationBoundReason | undefined

    if (input.signal?.aborted === true) {
      boundReason = 'aborted'
      verdict = buildVerdict({
        claim,
        status: 'uncertain',
        rationale: BOUND_RATIONALES.aborted,
        citedEvidenceIds: []
      })
    } else {
      try {
        // A provider that refuses the investigation as too large is RECOVERED
        // FROM, not pre-empted by a byte cap chosen in advance: the reads are
        // narrowed and the claim is retried, which is the same order the
        // discovery lane uses (reads first — the overflow came from what a tool
        // returned, so shrinking that is what makes the next attempt smaller).
        //
        // The retry reuses `bounded`, so it continues spending the SAME per-claim
        // tool-call budget rather than being handed a fresh one, and it reuses
        // `retriever`, whose budget `reduceReadBudget` has just halved in place.
        // When the budget cannot be narrowed further, or the attempts run out,
        // the error propagates to the handler below and is named for what it is.
        const result = await investigateWithNarrowingReads({
          claim,
          tools: bounded.tools,
          retriever,
          investigateClaim: input.investigateClaim,
          ...(input.logger === undefined ? {} : { logger: input.logger }),
          ...(input.signal === undefined ? {} : { signal: input.signal })
        })
        const parsedVerdict = ModelVerdictSchema.safeParse(result.verdict)
        usage = combineRunTokenUsage(usage, result.usage)

        if (bounded.budgetExhausted()) {
          // CODE, not the model, is authoritative: a claim whose tool-call
          // budget was exhausted ends `uncertain` even if the agent returned a
          // conclusive verdict after receiving the recoverable budget error.
          boundReason = 'tool-call-budget-exceeded'
          verdict = buildVerdict({
            claim,
            status: 'uncertain',
            rationale: BOUND_RATIONALES['tool-call-budget-exceeded'],
            citedEvidenceIds: bounded.citedEvidenceIds()
          })
        } else if (!parsedVerdict.success) {
          boundReason = 'invalid-verdict'
          verdict = buildVerdict({
            claim,
            status: 'uncertain',
            rationale: BOUND_RATIONALES['invalid-verdict'],
            citedEvidenceIds: bounded.citedEvidenceIds()
          })
        } else {
          verdict = buildVerdict({
            claim,
            status: parsedVerdict.data.status,
            rationale: parsedVerdict.data.rationale,
            citedEvidenceIds: bounded.citedEvidenceIds(),
            ...(parsedVerdict.data.findingJudgment === undefined
              ? {}
              : { findingJudgment: parsedVerdict.data.findingJudgment }),
            ...(parsedVerdict.data.fixEdits === undefined
              ? {}
              : { fixEdits: parsedVerdict.data.fixEdits })
          })
        }
      } catch (error) {
        boundReason = isToolCallBudgetExceededError(error)
          ? 'tool-call-budget-exceeded'
          : isAbort(error, input.signal)
            ? 'aborted'
            : // Named for what it is. Reaching here means the reads were already
              // narrowed as far as they go and the context still did not fit, so
              // reporting it as a generic agent error would send the reader
              // looking for a broken agent.
              isContextLengthExceeded(error)
              ? 'context-length-exceeded'
              : 'agent-error'
        input.logger?.warn?.('Claim verification did not complete.', {
          claim_kind: claim.kind,
          bound_reason: boundReason
        })
        verdict = buildVerdict({
          claim,
          status: 'uncertain',
          rationale: BOUND_RATIONALES[boundReason],
          citedEvidenceIds: bounded.citedEvidenceIds()
        })
      }
    }

    const observation: ClaimObservation = {
      claimId: claim.id,
      claimKind: claim.kind,
      source: claim.source,
      status: verdict.status,
      ...(verdict.findingJudgment === undefined
        ? {}
        : { findingJudgment: verdict.findingJudgment }),
      toolCalls: bounded.toolCallCount(),
      bytesRead: bounded.bytesRead(),
      durationMs: Math.max(0, Date.now() - startedAt),
      ...(boundReason === undefined ? {} : { boundReason })
    }
    verdicts.push(verdict)
    observations.push(observation)
    input.onObservation?.(observation)
  }

  const report = VerificationReportSchema.parse({
    verdicts,
    observations,
    warnings,
    claimCount: claims.length,
    contextLedger
  })

  return {
    report,
    claims,
    ...(usage === undefined ? {} : { usage })
  }
}
