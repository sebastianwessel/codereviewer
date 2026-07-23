// Production composition of the agentic claim-verification job (spec 12). It
// instantiates the configured claim providers and runs them through the shared
// `runInvestigationFlow` helper, which resolves the model provider and drives the
// `investigate_claim` harness agent. The finding investigation-and-fix job
// (`fix-run.ts`) shares the same helper and agent — there is no second agent loop.
//
// The job is off by default and non-fatal for missing prerequisites: with
// verification disabled, no configured claim providers, or an unresolved model
// provider, it produces an empty verification report and never throws.

import type { Logger } from '@purista/harness'
import type {
  CodeReviewerConfig,
  VerificationClaimProviderConfig
} from '../../shared/contracts/index.js'
import type { RunTokenUsage } from '../costs/index.js'
import type { ProviderImport } from '../provider-resolution/index.js'
import type { Claim } from '../../shared/contracts/verification/verification.schema.js'
import type { ClaimProvider } from './contracts.js'
import { createClaimsFileProvider } from './claims-file-provider.js'
import { createPriorFindingsProvider } from './prior-findings-provider.js'
import { runInvestigationFlow } from './investigation-run.js'
import {
  emptyVerificationReport,
  type ClaimObservation,
  type VerificationReport
} from './verification-report.js'

export type VerificationRunResult = {
  readonly report: VerificationReport
  // Gathered claims, so the caller can corroborate confirmed verdicts against
  // general-review findings by location.
  readonly claims: readonly Claim[]
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
    return { report: emptyVerificationReport(), claims: [] }
  }

  return runInvestigationFlow({
    config: input.config,
    repositoryRoot: input.repositoryRoot,
    environment: input.environment,
    providers: verification.providers.map(createClaimProvider),
    ...(input.providerImport === undefined
      ? {}
      : { providerImport: input.providerImport }),
    ...(input.logger === undefined ? {} : { logger: input.logger }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.onObservation === undefined
      ? {}
      : { onObservation: input.onObservation })
  })
}
