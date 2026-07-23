// Shared production wiring for the agentic investigation flow (spec 12). Both the
// claim-verification job (`verification-run.ts`) and the finding investigation-
// and-fix job (`fix-run.ts`) run through the SAME `investigate_claim` harness
// agent, mediated tools, and per-claim bounds — there is deliberately no second
// agent loop. This helper resolves the model provider (reusing
// `resolveProviderModelAlias` and the shared provider usage recorder), wires the
// harness agent into the flow runner over the caller-supplied claim providers,
// accounts the model spend in this lane's report `usage`, and returns the report
// plus gathered claims.
//
// The flow is off by default and non-fatal for missing prerequisites: with no
// claim providers or an unresolved model provider it produces an empty report and
// never throws.

import type { Logger } from '@purista/harness'
import type { CodeReviewerConfig } from '../../shared/contracts/index.js'
import type { Claim } from '../../shared/contracts/verification/verification.schema.js'
import {
  createProviderUsageRecorder,
  summarizeRunCost,
  type RunTokenUsage
} from '../costs/index.js'
import {
  resolveProviderModelAlias,
  type ProviderImport
} from '../provider-resolution/index.js'
import type { ContextRetrievalEligibilityConfig } from '../context-retrieval/index.js'
import type { ClaimProvider } from './contracts.js'
import { createHarnessClaimInvestigator } from './investigate-claim-agent.js'
import { runVerificationFlow } from './verification-flow.js'
import {
  emptyVerificationReport,
  type ClaimObservation,
  type VerificationReport
} from './verification-report.js'

export type InvestigationRunResult = {
  readonly report: VerificationReport
  // Gathered claims, so the caller can corroborate confirmed verdicts against
  // general-review findings by location, or map `current-finding` outcomes back
  // to their findings.
  readonly claims: readonly Claim[]
  readonly usage?: RunTokenUsage | undefined
}

export const runInvestigationFlow = async (input: {
  readonly config: CodeReviewerConfig
  readonly repositoryRoot: string
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly providers: readonly ClaimProvider[]
  readonly providerImport?: ProviderImport | undefined
  readonly logger?: Logger | undefined
  readonly signal?: AbortSignal | undefined
  readonly onObservation?: ((observation: ClaimObservation) => void) | undefined
}): Promise<InvestigationRunResult> => {
  if (input.providers.length === 0) {
    return { report: emptyVerificationReport(), claims: [] }
  }

  if (input.config.provider === undefined) {
    input.logger?.warn?.(
      'Investigation is enabled but no model provider is configured; producing an empty report.'
    )

    return { report: emptyVerificationReport(), claims: [] }
  }

  let modelAlias
  try {
    const resolved = await resolveProviderModelAlias({
      provider: input.config.provider,
      environment: input.environment,
      ...(input.logger === undefined ? {} : { logger: input.logger }),
      ...(input.providerImport === undefined
        ? {}
        : { importProvider: input.providerImport })
    })
    modelAlias = resolved.modelAlias
  } catch (error) {
    // An unresolved provider is non-fatal (spec 12): the flow yields an empty
    // report rather than failing the run.
    input.logger?.warn?.(
      'Investigation model provider could not be resolved; producing an empty report.',
      { error_name: error instanceof Error ? error.name : 'unknown' }
    )

    return { report: emptyVerificationReport(), claims: [] }
  }

  const usageRecorder = createProviderUsageRecorder(modelAlias)
  const investigator = createHarnessClaimInvestigator({
    modelAlias: usageRecorder.modelAlias,
    // Per-claim bounds are shared between the verification and fix jobs (spec 12).
    maxToolCallsPerClaim: input.config.verification.maxToolCallsPerClaim,
    ...(input.logger === undefined ? {} : { logger: input.logger })
  })
  const paths: ContextRetrievalEligibilityConfig = {
    include: input.config.paths.include,
    exclude: input.config.paths.exclude
  }

  try {
    const { report, claims } = await runVerificationFlow({
      providers: input.providers,
      repositoryRoot: input.repositoryRoot,
      verifyClaim: investigator.investigate,
      maxToolCallsPerClaim: input.config.verification.maxToolCallsPerClaim,
      maxBytesPerRead: input.config.verification.maxBytesPerRead,
      maxMatches: input.config.verification.maxMatches,
      paths,
      ...(input.logger === undefined ? {} : { logger: input.logger }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.onObservation === undefined
        ? {}
        : { onObservation: input.onObservation })
    })
    const usage = usageRecorder.usage()
    // Account the model spend in this lane's report so it is not silently dropped
    // (the general-review run cost is finalized before this lane runs).
    const cost = summarizeRunCost({
      providerConfigured: true,
      providerId: input.config.provider.id,
      modelName: input.config.provider.model,
      prices: input.config.costs,
      usage
    })
    const reportWithUsage: VerificationReport = {
      ...report,
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        ...(usage.cachedInputTokens === undefined
          ? {}
          : { cachedInputTokens: usage.cachedInputTokens }),
        ...(usage.reasoningTokens === undefined
          ? {}
          : { reasoningTokens: usage.reasoningTokens }),
        ...(cost.costUsd === undefined ? {} : { costUsd: cost.costUsd })
      }
    }

    return { report: reportWithUsage, claims, usage }
  } finally {
    await investigator.shutdown()
  }
}
