export {
  EVAL_INCONCLUSIVE_MATCH_WARNING_PREFIX,
  EVAL_PLAUSIBILITY_FAIL_CLOSED_WARNING_PREFIX,
  EVAL_PROVIDER_RETRY_WARNING_PREFIX,
  PROVIDER_ERROR_WARNING_PREFIX,
  inconclusiveMatchWarnings,
  plausibilityFailClosedWarnings,
  isProviderIssueWarning
} from './eval-warnings.js'
export {
  EvalCaseSchema,
  EvalCaseSetSchema,
  EvalLineRangeSchema,
  ExpectedFindingSchema,
  ExpectedFindingTierSchema,
  ExpectedNoFindingZoneSchema,
  parseEvalCases,
  parseEvalCasesJson,
  productRecallTiers,
  resolveExpectedFindingTier,
  type EvalCase,
  type EvalLineRange,
  type ExpectedFinding,
  type ExpectedFindingTier,
  type ExpectedNoFindingZone
} from './eval-fixture.schema.js'
export {
  assertBenchmarkSlicesHydrated,
  hydrateCodeReviewBenchmarkPack,
  isPlaceholderPositiveSlice,
  placeholderSliceMarker,
  type HydrateBenchmarkPackOptions,
  type HydrateBenchmarkPackResult
} from './benchmark-hydration.js'
export {
  answerKeyLeakIn,
  containsAnswerKey,
  isFullCommitSha,
  parseRealRepoCorpusManifest,
  parseRealRepoCorpusManifestJson,
  selectCorpusCases,
  tokenNormalizedDiffFingerprint,
  CorpusSplitSchema,
  FullCommitShaSchema,
  PermissiveLicenseSchema,
  RealRepoCorpusCaseSchema,
  RealRepoCorpusManifestSchema,
  RemovedCommentDisclosureReviewSchema,
  type CorpusSplit,
  type RealRepoCorpusCase,
  type RealRepoCorpusManifest,
  type RemovedCommentDisclosureReview
} from './real-repo-corpus.schema.js'
export {
  countExpectedImpactByReachability,
  directlyReachableImpactClasses,
  evidenceDateOf,
  isDirectlyReachable,
  parseChangeImpactCorpusManifest,
  parseChangeImpactCorpusManifestJson,
  ChangeImpactCorpusCaseSchema,
  ChangeImpactCorpusManifestSchema,
  EvidenceOfBreakageSchema,
  ExpectedCompatibilityClassSchema,
  ExpectedImpactSchema,
  ImpactReachabilitySchema,
  LocalPlausibilitySchema,
  type ChangeImpactCorpusCase,
  type ChangeImpactCorpusManifest,
  type EvidenceOfBreakage,
  type ExpectedImpact,
  type ImpactReachability,
  type ImpactReachabilityCounts
} from './change-impact-corpus.schema.js'
export {
  createMetricsVersionHistory,
  type MetricComparabilityOf,
  type MetricsVersionDivergenceOf,
  type MetricsVersionEntry,
  type MetricsVersionHistory
} from './metrics-version-history.js'
export {
  CHANGE_IMPACT_METRICS_VERSION,
  CHANGE_IMPACT_METRICS_VERSION_HISTORY,
  changeImpactMetricComparability,
  changeImpactMetricsAffectedBetween,
  type ChangeImpactComparabilityKey,
  type ChangeImpactMetricComparability,
  type ChangeImpactMetricsVersionDivergence
} from './change-impact-metrics-versions.js'
export {
  adjudicatedDestinationFiles,
  changeImpactArms,
  changeImpactUnmeasuredReasons,
  corpusSplits,
  impactReachabilityClasses,
  isAdjudicationMeasured,
  referenceDestinationFiles,
  scoreChangeImpactCases,
  type ChangeImpactAdjudicationDelta,
  type ChangeImpactArm,
  type ChangeImpactArmMetrics,
  type ChangeImpactCaseInput,
  type ChangeImpactCaseOutcome,
  type ChangeImpactCaseScore,
  type ChangeImpactCoverage,
  type ChangeImpactRate,
  type ChangeImpactRecall,
  type ChangeImpactScore,
  type ChangeImpactUnmeasuredReason,
  type ScoredExpectation
} from './change-impact-scoring.js'
export {
  buildChangeImpactEvalReport,
  parseChangeImpactEvalReport,
  ChangeImpactEvalReportSchema,
  CHANGE_IMPACT_EVAL_ARTIFACT_ROOT,
  CHANGE_IMPACT_EVAL_REPORT_ARTIFACT_NAME,
  CHANGE_IMPACT_EVAL_SUMMARY_ARTIFACT_NAME,
  type ChangeImpactEvalReport
} from './change-impact-eval-report.js'
export { renderChangeImpactEvalSummary } from './change-impact-eval-rendering.js'
export {
  readEngineIdentity,
  ENGINE_COMMIT_UNKNOWN,
  engineCommitArgs,
  engineWorkingTreeArgs,
  type EngineIdentity
} from './engine-identity.js'
export {
  buildChangeImpactCase,
  changeImpactHydrationSource,
  defaultChangeImpactManifestPath,
  defaultChangeImpactOutputRoot,
  diffHeaderPaths,
  hydrateChangeImpactCorpus,
  type ChangeImpactCaseResult,
  type HydrateChangeImpactCorpusOptions,
  type HydrateChangeImpactCorpusResult
} from './change-impact-corpus-hydration.js'
export {
  minimumDisclosureWordCount,
  removedProseCommentsIn,
  resolveRemovedCommentDisclosures,
  type RemovedCommentDisclosureResolution
} from './real-repo-diff-comment-disclosure.js'
export {
  assertReviewedDiffIsUncontaminated,
  buildRealRepoSlice,
  defaultRealRepoManifestPath,
  defaultRealRepoOutputSliceRoot,
  diffPathsOutsideReviewedSet,
  hydrateRealRepoCorpus,
  realRepoHydrationSource,
  resolveCaseHydrationState,
  type CaseHydrationState,
  type CorpusGitCommandRunner,
  type HydrateRealRepoCorpusOptions,
  type HydrateRealRepoCorpusResult,
  type RealRepoCaseResult
} from './real-repo-corpus-hydration.js'
export {
  EVAL_SEMANTIC_JUDGE_STAGE,
  matchEvalFindings,
  missingSemanticJudgeError,
  type EvalFindingMatch,
  type EvalInconclusiveMatch,
  type EvalMatcherResult,
  type EvalSemanticJudge,
  type EvalSemanticJudgeInput,
  type EvalSemanticJudgeResult
} from './eval-matcher.js'
export {
  createModelSemanticJudge
} from './eval-semantic-judge.js'
export {
  createModelPlausibilityJudge,
  judgeUnmatchedFindingsPlausibility,
  prepareEvalPlausibilitySource,
  EVAL_PLAUSIBILITY_JUDGE_STAGE,
  EVAL_PLAUSIBILITY_SOURCE_BYTE_CAP,
  type EvalCaseFileReader,
  type EvalPlausibilityJudge,
  type EvalPlausibilityJudgeInput,
  type EvalPlausibilityJudgeResult,
  type EvalPlausibilityOutcome,
  type EvalPlausibilityResult,
  type EvalPlausibilitySource
} from './eval-plausibility-judge.js'
export {
  DEFAULT_MINIMUM_JUDGE_AGREEMENT,
  EvalJudgeCalibrationPairSchema,
  evalJudgeCalibrationSet,
  scoreJudgeCalibration,
  type EvalJudgeCalibrationPair,
  type EvalJudgeCalibrationResult
} from './eval-judge-calibration.js'
export {
  DEFAULT_MINIMUM_PLAUSIBILITY_AGREEMENT,
  EvalPlausibilityCalibrationPairSchema,
  evalPlausibilityCalibrationSet,
  scorePlausibilityCalibration,
  type EvalPlausibilityCalibrationPair,
  type EvalPlausibilityCalibrationResult
} from './eval-plausibility-calibration.js'
export {
  calculateEvalMetrics,
  EvalMetricsSchema,
  severityWeight,
  type EvalJudgeReliability,
  type EvalMetricCaseResult,
  type EvalMetrics
} from './metrics.js'
export { runEvaluation } from './eval-runner.js'
export {
  EVAL_REPORT_ARTIFACT_NAME,
  EVAL_RECALL_REPORT_ARTIFACT_NAME,
  EVAL_SUMMARY_ARTIFACT_NAME,
  renderEvalSummary
} from './eval-summary-report-rendering.js'
export { renderEvalComparison } from './eval-comparison-report-rendering.js'
export {
  EvalComparisonReportSchema,
  parseEvalComparisonReport,
  type EvalComparisonCase,
  type EvalComparisonMetricGroup,
  type EvalComparisonMetrics,
  type EvalComparisonReport,
  type EvalComparisonRun
} from './eval-comparison-view.js'
export {
  EVAL_METRICS_VERSION_HISTORY,
  metricComparability,
  metricsAffectedBetween,
  type EvalComparabilityKey,
  type MetricComparability,
  type MetricsVersionDivergence
} from './eval-metrics-versions.js'
export {
  PAIRED_SIGNIFICANCE_ALPHA,
  pairedRecallVerdict,
  type PairedArmSummary,
  type PairedPopulationFinding,
  type PairedPopulationKind,
  type PairedPopulationVerdict,
  type PairedRecallVerdict
} from './eval-paired-recall-verdict.js'
export {
  precisionBracket,
  type PrecisionBracket,
  type PrecisionBracketBound
} from './eval-precision-bracket.js'
export { renderEvalRecallReport } from './eval-recall-report-rendering.js'
export {
  EVAL_METRICS_VERSION,
  EvalRegressionThresholdsSchema,
  EvalReportSchema,
  type EvalCaseOutput,
  type EvalContextLedgerEntry,
  type EvalRegressionThresholds,
  type EvalReport,
  type EvalReportProvenance
} from './eval-report-contracts.js'
export {
  computeAnswerKeyDigest,
  computeChangeImpactAnswerKeyDigest,
  computeChangeImpactAnswerKeyDigestByCase
} from './eval-report-provenance.js'
export { stableJsonDigest } from './stable-json-digest.js'
export {
  loadEvalCasesFromFixtures
} from './eval-fixture-loader.js'
export {
  createEvalSliceManifest,
  EvalSliceManifestCaseSchema,
  EvalSliceManifestSchema,
  type EvalSliceManifest,
  type EvalSliceManifestCase
} from './eval-slice-manifest.js'
export {
  calculateEvalDiffStats,
  type EvalDiffStats
} from './eval-diff-stats.js'
export {
  allDiffScopes,
  classifyExpectedFindingDiffScope,
  DiffScopeSchema,
  expectedFindingDiffScopes,
  hunkSpansByPath,
  type DiffScope,
  type DiffHunkSpansByPath
} from './eval-diff-scope.js'
