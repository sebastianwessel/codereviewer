// Public API of the verification domain (spec 12). Claim providers gather
// `Claim` records for the agentic verification flow; the `investigate_claim` agent
// investigates each claim with bounded, mediated repository tools; the flow
// runner enforces per-claim bounds in code and produces the verification report;
// and the corroboration helper cross-witnesses verdicts against general-review
// findings.
export {
  MAX_CLAIMS_PER_PROVIDER,
  type ClaimGatherOutput,
  type ClaimProvider
} from './contracts.js'
export {
  createClaimsFileProvider
} from './claims-file-provider.js'
export {
  createPriorFindingsProvider
} from './prior-findings-provider.js'
export {
  createCurrentFindingsProvider,
  currentFindingClaimId,
  eligibleCurrentFindings
} from './current-findings-provider.js'
export {
  enrichFindingsWithFixes,
  type CurrentFileReader
} from './fix-enrichment.js'
export {
  runVerificationFlow,
  type ClaimAgentResult,
  type ClaimAgentRunner
} from './verification-flow.js'
export {
  CLAIM_PROVIDER_FAILED_WARNING_PREFIX,
  ModelVerdictSchema,
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
  type HarnessClaimInvestigator
} from './investigate-claim-agent.js'
export {
  runInvestigationFlow,
  type InvestigationRunContext,
  type InvestigationRunResult
} from './investigation-run.js'
export {
  runVerificationRun
} from './verification-run.js'
export {
  runFixRun,
  resolveFixMinSeverity
} from './fix-run.js'
export {
  corroborateFindings,
  type CorroborationMatchKind,
  type FindingCorroboration
} from './corroboration.js'
