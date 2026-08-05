// Change-impact review (spec 22). Reachable only from `src/cli/`: it must not
// import from `review-workflow`, and `review-workflow` must not import from it,
// so a failure here can never fail a diff review.
export {
  collectChangedSymbols,
  type ChangedFileChangeKind,
  type ChangedSymbol,
  type ChangedSymbolChangeKind,
  type ChangedSymbolKind,
  type ChangedSymbolSourceFile,
  type CollectChangedSymbolsInput,
  type CollectChangedSymbolsResult
} from './changed-symbols.js'
export {
  adjudicateDeterministically,
  collectAdjudicationPairs,
  runAdjudication,
  type AdjudicationOutcome,
  type AdjudicationPair,
  type CandidateImpactFinding,
  type DeterministicVerdict,
  type RunAdjudicationInput
} from './adjudication.js'
export {
  createChangeImpactLane,
  type ChangeImpactLane
} from './change-impact-lane.js'
export {
  changedSymbolKey,
  collectContractChanges,
  type CollectContractChangesInput
} from './contract-changes.js'
export {
  CONTRACT_DIMENSION_IDS,
  describeContractDelta,
  type ContractChange,
  type ContractDeltaInput,
  type ContractDimensionId
} from './contract-delta.js'
export {
  admitImpactFinding,
  CandidateImpactFindingSchema,
  type ImpactAdmissionPolicy,
  type ImpactAdmissionResult
} from './impact-admission.js'
export { modelRelianceJudgementInstructions } from './instructions.js'
export {
  normalizeRelianceJudgement,
  relianceJudgementInputFor,
  verifyRelianceJudgement,
  ModelRelianceJudgementSchema,
  RelianceJudgementInputSchema,
  type RelianceJudgement,
  type RelianceJudgementInput,
  type RelianceJudgementRunner
} from './reliance-judgement.js'
export {
  discoverDependents,
  type DiscoverDependentsInput,
  type DiscoveredReferenceSite,
  type SymbolDependents
} from './dependent-discovery.js'
export { renderChangeImpactMarkdown } from './impact-markdown.js'
export {
  groupImpactedFiles,
  type GroupedImpact,
  type GroupImpactedFilesInput
} from './impacted-files.js'
export {
  AdjudicationStatusSchema,
  ChangeImpactReferenceReportSchema,
  ChangedSymbolReportSchema,
  CompatibilityClassSchema,
  impactedSymbolKey,
  ImpactedFileSchema,
  ImpactFindingSchema,
  ImpactRelianceSchema,
  RemovalPairingSchema,
  type AdjudicationStatus,
  type ChangeImpactReferenceReport,
  type ChangedSymbolReport,
  type CompatibilityClass,
  type ImpactedFile,
  type ImpactedFileSymbol,
  type ImpactFinding,
  type ImpactReliance,
  type ReferenceSite,
  type RemovalPairing,
  type ReportableCompatibilityClass
} from './impact-report.js'
export {
  indexAddedDeclarations,
  type AddedDeclaration,
  type RemovalPairingIndex,
  type RemovedDeclaration
} from './removal-pairing.js'
export {
  runChangeImpact,
  type ChangeImpactAgents,
  type RunChangeImpactInput
} from './impact-run.js'
export {
  classifyReferenceDestination,
  type ReferenceDestinationKind
} from './reference-destination.js'
