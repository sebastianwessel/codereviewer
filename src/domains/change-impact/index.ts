// Change-impact review (spec 22). Reachable only from `src/cli/`: it must not
// import from `review-workflow`, and `review-workflow` must not import from it,
// so a failure here can never fail a diff review.
export {
  collectChangedSymbols,
  type ChangedSymbol,
  type ChangedSymbolSourceFile
} from './changed-symbols.js'
export {
  adjudicateDeterministically,
  collectAdjudicationPairs,
  runAdjudication,
  type AdjudicationOutcome
} from './adjudication.js'
export {
  createChangeImpactLane
} from './change-impact-lane.js'
export {
  changedSymbolKey,
  collectContractChanges
} from './contract-changes.js'
export {
  describeContractDelta,
  type ContractChange
} from './contract-delta.js'
export {
  admitImpactFinding
} from './impact-admission.js'
export {
  modelRelianceJudgementInstructions
} from './instructions.js'
export {
  normalizeRelianceJudgement,
  relianceJudgementInputFor,
  verifyRelianceJudgement,
  ModelRelianceJudgementSchema,
  NO_RELIANCE_VERDICTS,
  RelianceJudgementInputSchema,
  type RelianceJudgement,
  type RelianceJudgementInput,
  type RelianceJudgementRunner,
  type RelianceVerdict,
  type RelianceVerdictCounts
} from './reliance-judgement.js'
export {
  discoverDependents,
  type DiscoveredReferenceSite,
  type SymbolDependents
} from './dependent-discovery.js'
export {
  renderChangeImpactMarkdown
} from './impact-markdown.js'
export {
  groupImpactedFiles,
  type GroupedImpact
} from './impacted-files.js'
export {
  AdjudicationStatusSchema,
  ChangeImpactReferenceReportSchema,
  CompatibilityClassSchema,
  impactedSymbolKey,
  ImpactedFileSchema,
  ImpactFindingSchema,
  ImpactRelianceSchema,
  ModelVerdictCountsSchema,
  type AdjudicationStatus,
  type ChangeImpactReferenceReport,
  type ChangedSymbolReport,
  type ImpactedFile,
  type ImpactedFileSymbol,
  type ImpactFinding,
  type ModelVerdictCounts,
  type ReferenceSite,
  type RemovalPairing,
  type ReportableCompatibilityClass
} from './impact-report.js'
export {
  indexAddedDeclarations,
  type AddedDeclaration,
  type RemovalPairingIndex
} from './removal-pairing.js'
export {
  runChangeImpact,
  type ChangeImpactAgents
} from './impact-run.js'
export {
  classifyReferenceDestination
} from './reference-destination.js'
