// Production composition of the agentic claim-verification job (spec 12). It
// instantiates the configured claim providers and runs them through the shared
// `runInvestigationFlow` helper, which resolves the model provider and drives the
// `investigate_claim` harness agent. The finding investigation-and-fix job
// (`fix-run.ts`) shares the same helper and agent — there is no second agent loop.
//
// The job is off by default and non-fatal for missing prerequisites: with
// verification disabled, no configured claim providers, or an unresolved model
// provider, it produces an empty verification report and never throws.

import type { VerificationClaimProviderConfig } from '../../shared/contracts/index.js'
import type { ClaimProvider } from './contracts.js'
import { createClaimsFileProvider } from './claims-file-provider.js'
import { createPriorFindingsProvider } from './prior-findings-provider.js'
import {
  runInvestigationFlow,
  type InvestigationRunContext,
  type InvestigationRunResult
} from './investigation-run.js'
import { emptyVerificationReport } from './verification-report.js'

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

export const runVerificationRun = async (
  input: InvestigationRunContext
): Promise<InvestigationRunResult> => {
  const { verification } = input.config

  if (!verification.enabled || verification.providers.length === 0) {
    return { report: emptyVerificationReport(), claims: [] }
  }

  return runInvestigationFlow({
    ...input,
    providers: verification.providers.map(createClaimProvider)
  })
}
