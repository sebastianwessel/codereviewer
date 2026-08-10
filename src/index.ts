// The package's library entrypoint, and the whole of its public surface.
//
// EVERY SYMBOL IS NAMED EXPLICITLY, AND THIS LIST IS THE PUBLIC API. The file
// used to `export *` twelve domain barrels, which made the published surface
// whatever those barrels happened to re-export on the day: 628 symbols, most of
// them internals that reached a barrel only so a sibling domain or a colocated
// test could import them. Nothing recorded which of the 628 were intended, so
// no change to a domain barrel could be classified as breaking or not — there
// was no statement of the surface to classify it against. Narrowing a barrel
// was therefore unreviewable, and that is what this file exists to fix.
//
// WHAT BELONGS HERE is decided by what a library consumer must be able to do,
// not by what happens to be reachable. Three operations, and nothing else:
//
//  1. Type and load a configuration — every schema and inferred type under
//     `shared/contracts/`, plus `loadCodeReviewerConfig`. Many of the config
//     types have no caller inside `src/` at all; that is expected, because
//     their consumer is someone typing a `.codereviewer/config.json` against
//     the committed JSON Schema, and absence of an internal caller is not
//     evidence they are unused.
//  2. Run a review — `runReview`, and every type its options and result name,
//     which is why a handful of symbols from `repository-intake`,
//     `provider-resolution`, `review-planning`, `shared-context` and
//     `admission` appear below. A type used in a public signature has to be
//     nameable, or the signature cannot be written down by a caller.
//  3. Read, validate and render a report — the reporters, the report validator,
//     and the run index that says which run directory holds the latest one.
//     These are the artifacts `docs/06-reference/artifacts.md` documents.
//
// Two consequences worth stating, because both are load-bearing:
//
//  - Do not reintroduce `export *` here. A wildcard makes the surface
//    unenumerable and re-couples it to a barrel's internal composition, which
//    is the exact condition this file removes.
//  - A symbol on a domain barrel is NOT automatically public. Domain barrels
//    are an internal seam that serves cross-domain imports inside `src/`; this
//    file serves consumers of the published package. The two sets differ by
//    design, so a barrel can now be narrowed without touching the public API.
//    The rule is recorded in `specs/01-architecture-and-structure.md`.
//
// The `./cli` subpath (`src/cli/index.ts`) is a separate published surface with
// its own types entry. It is deliberately not folded in here: the CLI is
// dispatched, not composed from, and it exports `runCli` plus two types.

export const projectName = '@sebastianwessel/codereviewer'

export {
  currentFileSystemFlavor,
  type FileSystemFlavor,
  normalizeFileSystemPath,
  type PathServiceOptions,
  resolveExistingPathInsideRoot,
  resolveWritePathInsideRoot,
  toPortablePath
} from './platform/path-service.js'

// `stableJsonDigest` used to reach this entrypoint through the `evaluation`
// barrel. It is a generic canonical-JSON hash with no evaluation semantics and
// now lives in `shared/json/`, so it is named here directly rather than dropped:
// moving a module must not silently remove a symbol from the package's public
// surface.
export { stableJsonDigest } from './shared/json/stable-json-digest.js'

export {
  type AdmittedFinding,
  AdmittedFindingSchema,
  type AiReviewConfig,
  AiReviewConfigSchema,
  type BaselineConfig,
  BaselineConfigSchema,
  type BaselineStatus,
  BaselineStatusSchema,
  CandidateIdSchema,
  type ChangeImpactConfig,
  ChangeImpactConfigSchema,
  type Claim,
  type ClaimEvidenceRef,
  ClaimEvidenceRefSchema,
  type ClaimId,
  ClaimIdSchema,
  type ClaimKind,
  ClaimKindSchema,
  ClaimSchema,
  type CodeLocation,
  CodeLocationSchema,
  type CodeReviewerConfig,
  CodeReviewerConfigSchema,
  compareSeverityDescending,
  ContextChangedFilesProviderSchema,
  ContextInboxProviderSchema,
  ContextLedgerIdSchema,
  type ContextProviderConfig,
  ContextProviderConfigSchema,
  type ContextRequest,
  ContextRequestSchema,
  type ContextSourcesConfig,
  ContextSourcesConfigSchema,
  ContextSummaryConfigSchema,
  ContractIdSchema,
  type CostConfig,
  CostConfigSchema,
  type CoverageFile,
  CoverageFileSchema,
  type CoverageSummary,
  CoverageSummarySchema,
  type CrossFileRetrievalConfig,
  CrossFileRetrievalConfigSchema,
  type DataFlowPath,
  DataFlowPathSchema,
  defaultReviewExcludePatterns,
  type DiscoveryTelemetry,
  DiscoveryTelemetrySchema,
  type DriftCategory,
  DriftCategorySchema,
  type DriftConfig,
  DriftConfigSchema,
  type EvalRegressionGateConfig,
  EvalRegressionGateConfigSchema,
  type EvalRegressionGateProfile,
  EvalRegressionGateProfileSchema,
  type EvaluationConfig,
  EvaluationConfigSchema,
  type EvidenceKind,
  EvidenceKindSchema,
  type EvidenceRecord,
  EvidenceRecordSchema,
  type FindingCategory,
  FindingCategorySchema,
  type FindingFingerprint,
  FindingFingerprintSchema,
  type FindingJudgment,
  FindingJudgmentSchema,
  type FindingProvenance,
  FindingProvenanceSchema,
  type FixConfig,
  FixConfigSchema,
  type FixEdit,
  FixEditSchema,
  type FixProposal,
  FixProposalSchema,
  type InstructionFileEntry,
  InstructionFileEntrySchema,
  type InstructionsConfig,
  InstructionsConfigSchema,
  type IntentFulfilmentConfig,
  IntentFulfilmentConfigSchema,
  type LoggingConfig,
  LoggingConfigSchema,
  maxConcurrentTasksBounds,
  type ObservabilityConfig,
  ObservabilityConfigSchema,
  type OpenTelemetryConfig,
  OpenTelemetryConfigSchema,
  type PathsConfig,
  PathsConfigSchema,
  type PlatformTarget,
  PlatformTargetSchema,
  prefixedIdSchema,
  type PromotionPolicyConfig,
  PromotionPolicyConfigSchema,
  type ProviderConfig,
  ProviderConfigSchema,
  type QualityGateConfig,
  QualityGateConfigSchema,
  type QualityGateResult,
  QualityGateResultSchema,
  REFUTATION_SUMMARY_MAX,
  type RefutationResult,
  RefutationResultSchema,
  type RefutationVerdict,
  RefutationVerdictSchema,
  REJECTED_FINDING_MESSAGE_MAX,
  type RejectedFinding,
  RejectedFindingSchema,
  type RejectReason,
  RejectReasonSchema,
  type RelatedLocation,
  RelatedLocationSchema,
  type ReportArtifact,
  ReportArtifactSchema,
  type ReporterEligibility,
  ReporterEligibilitySchema,
  type ReportFormat,
  ReportFormatSchema,
  type ReportingConfig,
  ReportingConfigSchema,
  type RepositoryRelativePath,
  RepositoryRelativePathSchema,
  REVIEW_COMMENT_BODY_MAX,
  type ReviewCommentDraft,
  ReviewCommentDraftSchema,
  type ReviewCommentPlatform,
  ReviewCommentPlatformSchema,
  type ReviewCommentsConfig,
  ReviewCommentsConfigSchema,
  type ReviewCommentSuggestion,
  ReviewCommentSuggestionSchema,
  type ReviewCommentTargetRange,
  ReviewCommentTargetRangeSchema,
  type ReviewConfig,
  ReviewConfigSchema,
  type ReviewDepth,
  ReviewDepthSchema,
  type ReviewDiscoveryReport,
  ReviewDiscoveryReportSchema,
  type ReviewMode,
  ReviewModeSchema,
  type ReviewReport,
  ReviewReportSchema,
  type RunSummary,
  RunSummarySchema,
  SarifReportingConfigSchema,
  type SecurityAnalyzerArtifactConfig,
  SecurityAnalyzerArtifactConfigSchema,
  type SecurityConfig,
  SecurityConfigSchema,
  type SecurityDedicatedPassConfig,
  SecurityDedicatedPassConfigSchema,
  type SecuritySignalsConfig,
  SecuritySignalsConfigSchema,
  type Severity,
  severityMeetsThreshold,
  SeveritySchema,
  Sha256Schema,
  type SkillsConfig,
  SkillsConfigSchema,
  type SkippedFile,
  SkippedFileSchema,
  type TaskDiscoveryTelemetry,
  TaskDiscoveryTelemetrySchema,
  TaskIdSchema,
  type TestAdequacySignal,
  TestAdequacySignalSchema,
  type Verdict,
  VERDICT_FIX_EDITS_MAX,
  VERDICT_RATIONALE_MAX,
  VerdictSchema,
  type VerdictStatus,
  VerdictStatusSchema,
  type VerificationCheck,
  VerificationCheckSchema,
  type VerificationClaimProviderConfig,
  VerificationClaimProviderConfigSchema,
  VerificationClaimsFileProviderSchema,
  type VerificationConfig,
  VerificationConfigSchema,
  VerificationPriorFindingsProviderSchema
} from './shared/contracts/index.js'

export {
  createRedactedConfigSummary,
  loadCodeReviewerConfig
} from './domains/configuration/index.js'

export {
  isReviewRunFailedError,
  type PartialReviewRunState,
  type ReviewRunnerResult,
  runReview,
  type RunReviewOptions
} from './domains/review-workflow/index.js'

// The five blocks below are here for one reason each: `RunReviewOptions`,
// `ReviewRunnerResult` and `PartialReviewRunState` name these types, and a type
// named in a public signature must be nameable by the caller writing against it.
// Nothing else from these domains is published — `resolveProviderModelAlias`,
// `collectRepositoryIntake`, `createReviewSharedContext` and the rest are how the
// run assembles itself, not how it is called.

// `providerImport` on `RunReviewOptions`: a caller injecting its own provider
// module has to be able to type the function it passes.
export { type ProviderImport } from './domains/provider-resolution/index.js'

// `reviewDiffMaps` on `RunReviewOptions` accepts an already-parsed diff.
// `parseGitDiffMaps` is published with it because it is the only supported way
// to produce that value from a `git diff` a caller already holds; without it the
// option would be typed but unconstructable.
export {
  type DiffHunk,
  type DiffMap,
  parseGitDiffMaps
} from './domains/repository-intake/index.js'

// `contextLedger` on `ReviewRunnerResult`. The schema and the two enums come
// with the entry type because the ledger is also written to disk as
// `context-ledger.json`, so a caller may be validating one it did not receive
// directly from `runReview`.
export {
  type ContextLedgerDecision,
  ContextLedgerDecisionSchema,
  type ContextLedgerEntry,
  ContextLedgerEntrySchema,
  type ContextLedgerKind,
  ContextLedgerKindSchema
} from './domains/review-planning/index.js'

// `sharedContext` on `ReviewRunnerResult`, and the two record types the snapshot
// is made of.
export {
  type AdmissionDecisionRecord,
  type ReviewSharedContextSnapshot,
  type SharedContextEntry
} from './domains/shared-context/index.js'

// `candidateFindings` on the shared-context snapshot. The admission policy that
// turns a candidate into an `AdmittedFinding` stays internal; only the shape a
// caller can observe is published.
export { type CandidateFinding } from './domains/admission/index.js'

// `supportSignalFacts` on the shared-context snapshot, and the two unions its
// fields are drawn from. The extractors that produce these facts stay internal —
// which language a fact came from is part of the fact, but running an extractor
// is not something a caller does.
export {
  type SupportedSignalLanguage,
  type SupportSignalFact,
  type SupportSignalFactKind
} from './domains/deterministic-signals/index.js'

// Reading and rendering a report. The renderers, the validator that turns an
// untrusted `report.json` back into a `ReviewReport`, and the run index that
// says which run directory holds the latest report — the artifacts documented in
// `docs/06-reference/artifacts.md`.
//
// The markdown primitives the renderers are built from (`inlineCode`,
// `pluralize`, `safeText`, `CODE_FENCE`, `renderFencedBlock`, `renderUsageLines`,
// `renderMeasuredOn`) are deliberately not here. They are how a report is
// spelled, not what a report is, and publishing them would freeze the wording of
// every artifact this package writes.
export {
  buildReviewCommentDrafts,
  createReportArtifact,
  detectPlatformTarget,
  emptyRunIndex,
  latestRunWithReport,
  maxRunIndexEntries,
  parseRunIndex,
  type PlatformDetectionInput,
  type PlatformDetectionSource,
  readOriginRemoteUrl,
  remoteHostFromUrl,
  type RenderedReviewComment,
  renderJsonReport,
  renderMarkdownReport,
  renderReviewComments,
  renderRunIndexJson,
  renderRunSummaryJson,
  renderSarifReport,
  type ReportArtifactWriter,
  type ResolvedPlatform,
  type RunIndex,
  type RunIndexEntry,
  RunIndexEntrySchema,
  runIndexFileName,
  RunIndexSchema,
  type SarifRenderOptions,
  sortAdmittedFindings,
  upsertRunIndexEntry,
  validateReviewReport,
  writeReportingArtifacts,
  type WrittenReportArtifact
} from './domains/reporting/index.js'
