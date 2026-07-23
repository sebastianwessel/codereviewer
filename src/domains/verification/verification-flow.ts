// The agentic verification flow runner (spec 12). For every claim gathered from
// the configured providers it runs the `verify_claim` agent in a bounded loop,
// enforces the per-claim bounds in CODE (never the model), and produces the
// verification-lane report: verdicts, no-content observations, and non-fatal run
// warnings. It accumulates token usage across claims.
//
// The agent invocation is injected as `verifyClaim` so the pure orchestration —
// claim gathering, bound enforcement, verdict assembly — is unit-testable with a
// fake runner and never reaches a real provider. Production wires the harness
// `verify_claim` agent through this seam (see `verification-run.ts`).

import type { Logger } from '@purista/harness'
import { combineRunTokenUsage, type RunTokenUsage } from '../costs/index.js'
import {
  ContractIdSchema,
  type Claim,
  type Verdict
} from '../../shared/contracts/index.js'
import {
  VerdictSchema,
  VERDICT_RATIONALE_MAX
} from '../../shared/contracts/verification/verification.schema.js'
import { truncateForContract } from '../../shared/text/truncate.js'
import {
  createContextRetriever,
  type ContextRetrievalEligibilityConfig
} from '../context-retrieval/index.js'
import type { ClaimProvider } from './contracts.js'
import {
  createBoundedClaimTools,
  isClaimToolCallBudgetExceededError,
  type VerificationClaimTools
} from './claim-tools.js'
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
  readonly tools: VerificationClaimTools
  readonly signal?: AbortSignal | undefined
}) => Promise<ClaimAgentResult>

export type RunVerificationFlowInput = {
  readonly providers: readonly ClaimProvider[]
  readonly repositoryRoot: string
  readonly verifyClaim: ClaimAgentRunner
  readonly maxToolCallsPerClaim: number
  readonly maxBytesPerRead: number
  readonly maxMatches: number
  readonly paths?: ContextRetrievalEligibilityConfig | undefined
  readonly logger?: Logger | undefined
  readonly signal?: AbortSignal | undefined
  readonly onObservation?: (observation: ClaimObservation) => void
}

export type VerificationFlowResult = {
  readonly report: VerificationReport
  readonly usage?: RunTokenUsage | undefined
}

const BOUND_RATIONALES: Record<VerificationBoundReason, string> = {
  'tool-call-budget-exceeded':
    'Verification ended without a conclusive verdict: the per-claim tool-call budget was exhausted before the claim could be resolved.',
  aborted:
    'Verification ended without a conclusive verdict: the run was cancelled or timed out before the claim could be resolved.',
  'invalid-verdict':
    'Verification ended without a conclusive verdict: the agent returned a verdict that did not satisfy the verdict contract.',
  'agent-error':
    'Verification ended without a conclusive verdict: the verification agent could not complete the investigation.'
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
}): Verdict =>
  VerdictSchema.parse({
    claimId: input.claim.id,
    status: input.status,
    rationale: truncateForContract(input.rationale, VERDICT_RATIONALE_MAX),
    citedEvidenceIds: dedupeCitedEvidence(input.citedEvidenceIds),
    fingerprints: fingerprintsForClaim(input.claim)
  })

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
  let usage: RunTokenUsage | undefined

  for (const claim of claims) {
    const startedAt = Date.now()
    const retriever = createContextRetriever({
      repositoryRoot: input.repositoryRoot,
      budget: {
        maxBytesPerRead: input.maxBytesPerRead,
        maxMatches: input.maxMatches,
        // The unified per-claim tool-call counter governs the loop, so the
        // retriever's own per-kind read/search counters are set to the same cap
        // and never trip first.
        maxReads: input.maxToolCallsPerClaim,
        maxSearches: input.maxToolCallsPerClaim
      },
      ...(input.paths === undefined ? {} : { paths: input.paths })
    })
    const bounded = createBoundedClaimTools({
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
        const result = await input.verifyClaim({
          claim,
          tools: bounded.tools,
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
            citedEvidenceIds: bounded.citedEvidenceIds()
          })
        }
      } catch (error) {
        boundReason = isClaimToolCallBudgetExceededError(error)
          ? 'tool-call-budget-exceeded'
          : isAbort(error, input.signal)
            ? 'aborted'
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
    claimCount: claims.length
  })

  return {
    report,
    ...(usage === undefined ? {} : { usage })
  }
}
