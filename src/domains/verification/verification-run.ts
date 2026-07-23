// Production composition of the agentic verification flow (spec 12). This resolves
// the model provider (reusing `resolveProviderModelAlias` and the shared provider
// usage recorder), instantiates the configured claim providers, wires the
// `verify_claim` harness agent into the flow runner, and returns the verification
// report plus accumulated token usage.
//
// The flow is off by default and non-fatal for missing prerequisites: with
// verification disabled, no configured claim providers, or an unresolved model
// provider, it produces an empty verification report and never throws.

import type { Logger } from '@purista/harness'
import type {
  CodeReviewerConfig,
  VerificationClaimProviderConfig
} from '../../shared/contracts/index.js'
import {
  createProviderUsageRecorder,
  type RunTokenUsage
} from '../costs/index.js'
import {
  resolveProviderModelAlias,
  type ProviderImport
} from '../provider-resolution/index.js'
import type { ContextRetrievalEligibilityConfig } from '../context-retrieval/index.js'
import type { ClaimProvider } from './contracts.js'
import { createClaimsFileProvider } from './claims-file-provider.js'
import { createPriorFindingsProvider } from './prior-findings-provider.js'
import { createHarnessClaimVerifier } from './verify-claim-agent.js'
import { runVerificationFlow } from './verification-flow.js'
import {
  emptyVerificationReport,
  type ClaimObservation,
  type VerificationReport
} from './verification-report.js'

export type VerificationRunResult = {
  readonly report: VerificationReport
  readonly usage?: RunTokenUsage | undefined
}

const createClaimProvider = (
  config: VerificationClaimProviderConfig
): ClaimProvider => {
  switch (config.type) {
    case 'claims-file':
      return createClaimsFileProvider(config)
    case 'prior-findings':
      return createPriorFindingsProvider(config)
  }
}

export const runVerificationRun = async (input: {
  readonly config: CodeReviewerConfig
  readonly repositoryRoot: string
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly providerImport?: ProviderImport | undefined
  readonly logger?: Logger | undefined
  readonly signal?: AbortSignal | undefined
  readonly onObservation?: ((observation: ClaimObservation) => void) | undefined
}): Promise<VerificationRunResult> => {
  const { verification } = input.config

  if (!verification.enabled || verification.providers.length === 0) {
    return { report: emptyVerificationReport() }
  }

  if (input.config.provider === undefined) {
    input.logger?.warn?.(
      'Verification is enabled but no model provider is configured; producing an empty verification report.'
    )

    return { report: emptyVerificationReport() }
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
    // An unresolved provider is non-fatal for verification (spec 12): the flow
    // yields an empty report rather than failing the run.
    input.logger?.warn?.(
      'Verification model provider could not be resolved; producing an empty verification report.',
      { error_name: error instanceof Error ? error.name : 'unknown' }
    )

    return { report: emptyVerificationReport() }
  }

  const usageRecorder = createProviderUsageRecorder(modelAlias)
  const verifier = createHarnessClaimVerifier({
    modelAlias: usageRecorder.modelAlias,
    maxToolCallsPerClaim: verification.maxToolCallsPerClaim,
    ...(input.logger === undefined ? {} : { logger: input.logger })
  })
  const paths: ContextRetrievalEligibilityConfig = {
    include: input.config.paths.include,
    exclude: input.config.paths.exclude
  }

  try {
    const { report } = await runVerificationFlow({
      providers: verification.providers.map(createClaimProvider),
      repositoryRoot: input.repositoryRoot,
      verifyClaim: verifier.verify,
      maxToolCallsPerClaim: verification.maxToolCallsPerClaim,
      maxBytesPerRead: verification.maxBytesPerRead,
      maxMatches: verification.maxMatches,
      paths,
      ...(input.logger === undefined ? {} : { logger: input.logger }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.onObservation === undefined
        ? {}
        : { onObservation: input.onObservation })
    })
    const usage = usageRecorder.usage()

    return { report, usage }
  } finally {
    await verifier.shutdown()
  }
}
