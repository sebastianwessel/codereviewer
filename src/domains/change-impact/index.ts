// Change-impact review (spec 22). Reachable only from `src/cli/`: it must not
// import from `review-workflow`, and `review-workflow` must not import from it,
// so a failure here can never fail a diff review.
export {
  collectChangedSymbols,
  type ChangedFileChangeKind,
  type ChangedSymbol,
  type ChangedSymbolKind,
  type ChangedSymbolSourceFile,
  type CollectChangedSymbolsInput,
  type CollectChangedSymbolsResult
} from './changed-symbols.js'
export {
  changedSymbolKey,
  collectContractChanges,
  type CollectContractChangesInput
} from './contract-changes.js'
export {
  describeContractDelta,
  type ContractDeltaInput
} from './contract-delta.js'
export {
  discoverDependents,
  type DiscoverDependentsInput
} from './dependent-discovery.js'
export { renderChangeImpactMarkdown } from './impact-markdown.js'
export {
  ChangeImpactReferenceReportSchema,
  ChangedSymbolReferencesSchema,
  type ChangeImpactReferenceReport,
  type ChangedSymbolReferences,
  type SymbolReferenceSiteReport
} from './impact-report.js'
export {
  runChangeImpact,
  type RunChangeImpactInput
} from './impact-run.js'
export {
  classifyReferenceDestination,
  type ReferenceDestinationKind
} from './reference-destination.js'
