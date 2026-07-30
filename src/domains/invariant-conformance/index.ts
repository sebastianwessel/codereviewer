// Invariant-conformance review (spec 24). Reachable only from `src/cli/`: it must
// not import from `review-workflow`, and `review-workflow` must not import from
// it, so a failure here can never fail a diff review.
// Declaration span, shape and position now live in `declaration-analysis` and are
// NOT re-exported here. They are shared with the diff reviewer (spec 25), which
// this domain is forbidden to touch, so re-exporting them would route a stage-1
// import through a stage-3 barrel and defeat the boundary test below.
export {
  derivePeerSets,
  type ConformanceSourceFile,
  type DerivePeerSetsInput,
  type DerivePeerSetsResult,
  type PeerDeclaration,
  type PeerDeclarationKind,
  type PeerSet
} from './peer-sets.js'
export {
  collectDivergences,
  type CollectDivergencesInput,
  type CollectDivergencesResult
} from './divergence.js'
export {
  ConformanceAdjudicationRecordSchema,
  ConformanceAdjudicationSummarySchema,
  ConformanceDivergenceSchema,
  ConformanceUsageSchema,
  InvariantConformanceReportSchema,
  MINIMUM_CITED_PEERS,
  type ConformanceAdjudicationRecord,
  type ConformanceAdjudicationSummary,
  type ConformanceDivergence,
  type ConformanceUsage,
  type DeclarationSite,
  type DivergenceAttribution,
  type InvariantConformanceReport
} from './conformance-report.js'
export {
  ConformanceAdjudicationInputSchema,
  ConformanceAdjudicationVerdictSchema,
  ModelConformanceAdjudicationSchema,
  conformanceAdjudicationInputFor,
  normalizeConformanceAdjudication,
  type ConformanceAdjudication,
  type ConformanceAdjudicationContext,
  type ConformanceAdjudicationInput,
  type ConformanceAdjudicationRunner,
  type ConformanceAdjudicationVerdict,
  type ModelConformanceAdjudication
} from './conformance-adjudication.js'
export { modelConformanceAdjudicationInstructions } from './adjudication-instructions.js'
export {
  adjudicateDivergences,
  deterministicAdjudicationSummary,
  type AdjudicateDivergencesInput,
  type AdjudicateDivergencesResult
} from './adjudicate-divergences.js'
export {
  createHarnessConformanceAdjudicator,
  type HarnessConformanceAdjudicator
} from './conformance-adjudication-agent.js'
export {
  createConformanceAdjudicationLane,
  type ConformanceAdjudicationLane
} from './conformance-adjudication-run.js'
export {
  runInvariantConformance,
  type RunInvariantConformanceInput
} from './conformance-run.js'
