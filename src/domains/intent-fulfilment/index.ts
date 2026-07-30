// Intent-fulfilment review (spec 23). Reachable only from `src/cli/`: it must not
// import from `review-workflow`, and `review-workflow` must not import from it, so
// this stage can neither be reached by a diff review nor fail one. Spec 23's
// advisory-only requirement rests on that separation.
export {
  collectChangeSurface,
  type ChangedFileSurface,
  type ChangedLine,
  type ChangeSurface,
  type ChangeSurfaceSourceFile
} from './change-surface.js'
export {
  FulfilmentExplanationInputSchema,
  ModelFulfilmentExplanationSchema,
  fulfilmentExplanationInputFor,
  normalizeFulfilmentExplanation,
  type FulfilmentExplanationInput,
  type FulfilmentExplanationRunner
} from './explanation.js'
export {
  createHarnessIntentFulfilmentAgents,
  type HarnessIntentFulfilmentAgents
} from './intent-fulfilment-agents.js'
export {
  createIntentFulfilmentLane,
  type IntentFulfilmentLane
} from './intent-fulfilment-lane.js'
export {
  ChangeCitationSchema,
  ExtraScopeEntrySchema,
  IntentCitationSchema,
  IntentFulfilmentReportSchema,
  ObligationSchema,
  ObligationStatusSchema,
  type ChangeCitation,
  type ExtraScopeEntry,
  type IntentCitation,
  type IntentFulfilmentReport,
  type IntentFulfilmentSummary,
  type IntentFulfilmentUsage,
  type Obligation,
  type ObligationStatus
} from './intent-fulfilment-report.js'
export {
  runIntentFulfilment,
  type IntentFulfilmentAgents,
  type RunIntentFulfilmentInput
} from './intent-fulfilment-run.js'
export {
  resolveIntentCitation,
  toIntentSources,
  type IntentSource
} from './intent-sources.js'
export {
  modelFulfilmentExplanationInstructions,
  modelFulfilmentJudgementInstructions,
  modelObligationExtractionInstructions
} from './instructions.js'
export {
  FulfilmentJudgementInputSchema,
  ModelFulfilmentJudgementSchema,
  fulfilmentJudgementInputFor,
  normalizeFulfilmentJudgement,
  verifyJudgement,
  type FulfilmentJudgement,
  type FulfilmentJudgementInput,
  type FulfilmentJudgementRunner,
  type VerifiedJudgement
} from './judgement.js'
export {
  ModelObligationExtractionSchema,
  ObligationExtractionInputSchema,
  normalizeObligationExtraction,
  obligationExtractionInputFor,
  type ExtractedObligation,
  type ObligationExtractionInput,
  type ObligationExtractionRunner
} from './obligation-extraction.js'
