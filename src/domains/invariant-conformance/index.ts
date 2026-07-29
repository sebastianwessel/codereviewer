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
  extractDeclarationTraits,
  isComparableDeclarationHeader,
  type DeclarationTrait,
  type DeclarationTraitKind,
  type ExtractDeclarationTraitsInput
} from './declaration-shape.js'
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
  ConformanceDivergenceSchema,
  InvariantConformanceReportSchema,
  MINIMUM_CITED_PEERS,
  type ConformanceDivergence,
  type DeclarationSite,
  type DivergenceAttribution,
  type InvariantConformanceReport
} from './conformance-report.js'
export {
  runInvariantConformance,
  type RunInvariantConformanceInput
} from './conformance-run.js'
