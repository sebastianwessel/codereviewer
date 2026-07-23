// Public API of the verification domain (spec 12). Claim providers gather
// `Claim` records for the agentic verification flow; the `investigate_claim` agent
// investigates each claim with bounded, mediated repository tools; the flow
// runner enforces per-claim bounds in code and produces the verification report;
// and the corroboration helper cross-witnesses verdicts against general-review
// findings.
export { MAX_CLAIMS_PER_PROVIDER, type ClaimGatherInput, type ClaimProvider } from './contracts.js'
export { createClaimsFileProvider } from './claims-file-provider.js'
export { createPriorFindingsProvider } from './prior-findings-provider.js'
export {
  createCurrentFindingsProvider,
  currentFindingClaimId,
  type CurrentFindingsProviderConfig
} from './current-findings-provider.js'
export { applyFixEdits, type ApplyCheckResult } from './apply-check.js'
export {
  enrichFindingsWithFixes,
  type CurrentFileReader,
  type FixEnrichmentResult
} from './fix-enrichment.js'
export {
  ClaimToolCallBudgetExceededError,
  isClaimToolCallBudgetExceededError,
  createBoundedClaimTools,
  type BoundedClaimTools,
  type VerificationClaimTools
} from './claim-tools.js'
export {
  runVerificationFlow,
  type ClaimAgentResult,
  type ClaimAgentRunner,
  type RunVerificationFlowInput,
  type VerificationFlowResult
} from './verification-flow.js'
export {
  ApplyCheckOutcomeSchema,
  CLAIM_PROVIDER_FAILED_WARNING_PREFIX,
  ClaimObservationSchema,
  FixOutcomeSchema,
  ModelVerdictSchema,
  VerificationBoundReasonSchema,
  VerificationReportSchema,
  emptyVerificationReport,
  runWarningsForVerificationReport,
  type ApplyCheckOutcome,
  type ClaimObservation,
  type FixOutcome,
  type ModelVerdict,
  type VerificationBoundReason,
  type VerificationReport
} from './verification-report.js'
export {
  createHarnessClaimInvestigator,
  investigateClaimInstructions,
  type HarnessClaimInvestigator
} from './investigate-claim-agent.js'
export {
  runInvestigationFlow,
  type InvestigationRunResult
} from './investigation-run.js'
export { runVerificationRun, type VerificationRunResult } from './verification-run.js'
export {
  runFixRun,
  resolveFixMinSeverity,
  type FixRunResult
} from './fix-run.js'
export {
  corroborateFindings,
  type CorroborateFindingsInput,
  type CorroborationMatchKind,
  type FindingCorroboration
} from './corroboration.js'
