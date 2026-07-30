// Invariant-conformance review (spec 24). Reachable only from `src/cli/`: it must
// not import from `review-workflow`, and `review-workflow` must not import from
// it, so a failure here can never fail a diff review.
export {
  blankNonCode,
  codeLinesOfSpan,
  declarationSpanAt,
  toSourceLines,
  type BlankedLine,
  type DeclarationSpan,
  type SourceLines
} from './declaration-span.js'
export {
  declarationTraitKey,
  declarationTraitSubjectKey,
  describeDeclarationTrait,
  describePositionedTrait,
  extractDeclarationTraits,
  isComparableDeclarationHeader,
  type DeclarationTrait,
  type DeclarationTraitKind,
  type DeclarationTraitSubject,
  type ExtractDeclarationTraitsInput
} from './declaration-shape.js'
export {
  describeTraitPosition,
  traitPositionKey,
  traitPositionsOfSpan,
  type TraitDepthBand,
  type TraitPosition,
  type TraitTerminality
} from './trait-position.js'
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
