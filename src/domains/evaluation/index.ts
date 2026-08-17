export {
  EVAL_PROVIDER_RETRY_WARNING_PREFIX,
  PROVIDER_ERROR_WARNING_PREFIX,
  artifactOnlyPlausibilityFailClosedWarnings,
  inconclusiveMatchWarnings,
  plausibilityFailClosedWarnings,
  isProviderIssueWarning
} from './eval-warnings.js'
export {
  EvalCaseSchema,
  EvalLineRangeSchema,
  // Exported for the drift domain's artifact-example checker, which validates
  // every eval slice example printed in Markdown against this contract. A
  // cross-domain consumer is what a barrel entry is for.
  EvalSliceCaseSchema,
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
} from './corpus/eval-fixture.schema.js'
export {
  assertBenchmarkSlicesHydrated,
  hydrateCodeReviewBenchmarkPack,
  isPlaceholderPositiveSlice,
  placeholderSliceMarker
} from './corpus/benchmark-hydration.js'
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
  RealRepoCorpusManifestSchema,
  RemovedCommentDisclosureReviewSchema,
  type CorpusSplit,
  type RealRepoCorpusCase,
  type RealRepoCorpusManifest
} from './corpus/real-repo-corpus.schema.js'
export {
  countExpectedImpactByReachability,
  directlyReachableImpactClasses,
  evidenceDateOf,
  isDirectlyReachable,
  parseChangeImpactCorpusManifest,
  parseChangeImpactCorpusManifestJson,
  ChangeImpactCorpusCaseSchema,
  ChangeImpactCorpusManifestSchema,
  ExpectedCompatibilityClassSchema,
  ExpectedImpactSchema,
  ImpactReachabilitySchema,
  type ChangeImpactCorpusCase,
  type ChangeImpactCorpusManifest,
  type ExpectedImpact,
  type ImpactReachability,
  type ImpactReachabilityCounts
} from './change-impact-eval/change-impact-corpus.schema.js'
export {
  createMetricsVersionHistory,
  type MetricComparabilityOf,
  type MetricsVersionDivergenceOf,
  type MetricsVersionEntry
} from './report/versions/metrics-version-history.js'
export {
  CHANGE_IMPACT_METRICS_VERSION,
  CHANGE_IMPACT_METRICS_VERSION_HISTORY,
  changeImpactMetricComparability,
  changeImpactMetricsAffectedBetween
} from './change-impact-eval/change-impact-metrics-versions.js'
export {
  changeImpactUnmeasuredReasons,
  corpusSplits,
  impactReachabilityClasses,
  scoreChangeImpactCases,
  type ChangeImpactArmMetrics,
  type ChangeImpactCaseInput,
  type ChangeImpactCaseOutcome,
  type ChangeImpactRecall,
  type ChangeImpactScore
} from './change-impact-eval/change-impact-scoring.js'
export {
  buildChangeImpactEvalReport,
  parseChangeImpactEvalReport,
  ChangeImpactEvalReportSchema,
  CHANGE_IMPACT_EVAL_ARTIFACT_ROOT,
  CHANGE_IMPACT_EVAL_REPORT_ARTIFACT_NAME,
  CHANGE_IMPACT_EVAL_SUMMARY_ARTIFACT_NAME,
  type ChangeImpactEvalReport
} from './change-impact-eval/change-impact-eval-report.js'
export {
  renderChangeImpactEvalSummary
} from './change-impact-eval/change-impact-eval-rendering.js'
// The per-case runner `eval impact` drives. Only the two symbols the command
// needs are here: `configForCase` and `hydratedCaseMatchesManifest` have no
// consumer outside this domain, and its colocated test reaches them by module
// path rather than through the barrel.
export {
  changeImpactAdjudicationCallBounds,
  runChangeImpactEvalCase
} from './change-impact-eval/impact-eval-runner.js'
// Intent-fulfilment corpus (spec 23 §Evaluation). A third corpus with a third
// answer key, exported beside the other two and never merged with them.
export {
  countOutstandingExpectationsByArm,
  intentArms,
  IntentArmSchema,
  parseIntentCorpusManifest,
  parseIntentCorpusManifestJson,
  type IntentArm,
  type IntentArmCounts,
  type IntentCorpusCase,
  type IntentCorpusManifest,
  type OutstandingExpectation
} from './intent-eval/intent-corpus.schema.js'
export {
  assembleIntentBody,
  defaultIntentManifestPath,
  defaultIntentOutputRoot,
  hydrateIntentCorpus,
  intentHydrationSource,
  renderIntentDocument,
  INTENT_CASE_ARTIFACT_NAME,
  INTENT_CASE_CONTEXT_DIRECTORY,
  INTENT_CASE_WORK_TREE,
  type HydratedIntentCase,
  type IntentLineMapEntry
} from './intent-eval/intent-corpus-hydration.js'
export {
  intentUnmeasuredReasons,
  listPlacement,
  scoreIntentCases,
  OUTSTANDING_LIST_PLACEMENT,
  SPEC_DENOMINATOR_NOT_MEASURABLE,
  type ExpectationOutcome,
  type IntentArmMetrics,
  type IntentCaseInput,
  type IntentCaseOutcome,
  type IntentRate,
  type IntentScore
} from './intent-eval/intent-eval-scoring.js'
export {
  buildIntentEvalReport,
  parseIntentEvalReport,
  INTENT_EVAL_ARTIFACT_ROOT,
  INTENT_EVAL_REPORT_ARTIFACT_NAME,
  INTENT_EVAL_SUMMARY_ARTIFACT_NAME,
  type IntentEvalReport
} from './intent-eval/intent-eval-report.js'
export {
  renderIntentEvalSummary
} from './intent-eval/intent-eval-rendering.js'
// The per-case runner `eval intent` drives. `configForIntentCase` and
// `hydratedIntentCaseMatchesManifest` stay off the barrel for the reason the
// change-impact ones do: nothing outside this domain calls them.
export {
  runIntentEvalCase
} from './intent-eval/intent-eval-runner.js'
export {
  INTENT_METRICS_VERSION
} from './intent-eval/intent-metrics-versions.js'
export {
  readEngineIdentity,
  ENGINE_COMMIT_UNKNOWN,
  engineCommitArgs,
  engineWorkingTreeArgs,
  type EngineIdentity
} from './report/engine-identity.js'
// Whether several finished runs may be merged into one statistic. On the barrel
// because both pooling surfaces are CLI commands: `eval recall-report` pools
// per-expectation outcomes, and `eval compare` asks the same question of the
// judge before it adjudicates two arms.
export {
  engineIdentityOf,
  judgeIdentityOf,
  poolIdentityRefusals,
  poolIdentityWarnings,
  POOL_IDENTITY_UNRECORDED,
  type PoolCandidate,
  type PoolIdentityProvenance
} from './report/eval-pool-identity.js'
export {
  buildChangeImpactCase,
  changeImpactHydrationSource,
  defaultChangeImpactManifestPath,
  defaultChangeImpactOutputRoot,
  diffHeaderPaths,
  hydrateChangeImpactCorpus,
  type ChangeImpactCaseResult
} from './change-impact-eval/change-impact-corpus-hydration.js'
export {
  removedProseCommentsIn,
  resolveRemovedCommentDisclosures
} from './corpus/real-repo-diff-comment-disclosure.js'
export {
  assertReviewedDiffIsUncontaminated,
  buildRealRepoSlice,
  diffPathsOutsideReviewedSet,
  hydrateRealRepoCorpus,
  realRepoHydrationSource
} from './corpus/real-repo-corpus-hydration.js'
// From the modules that OWN them, not through the real-repo hydrator. That
// module used to re-export these purely because callers already addressed them
// by its name, which is how one corpus's file became the apparent home of
// plumbing all three share.
export type { CorpusGitCommandRunner } from './corpus/git-corpus-plumbing.js'
export { resolveCaseHydrationState } from './corpus/git-corpus-hydration.js'
export {
  EVAL_SEMANTIC_JUDGE_STAGE,
  matchEvalFindings,
  missingSemanticJudgeError,
  type EvalMatcherResult,
  type EvalSemanticJudge,
  type EvalSemanticJudgeInput,
  type EvalSemanticJudgeResult
} from './judging/eval-matcher.js'
export {
  createModelSemanticJudge
} from './judging/eval-semantic-judge.js'
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
  type EvalPlausibilityResult
} from './judging/eval-plausibility-judge.js'
export {
  DEFAULT_MINIMUM_JUDGE_AGREEMENT,
  evalJudgeCalibrationSet,
  scoreJudgeCalibration,
  type EvalJudgeCalibrationPair,
  type EvalJudgeCalibrationResult
} from './judging/eval-judge-calibration.js'
export {
  DEFAULT_MINIMUM_PLAUSIBILITY_AGREEMENT,
  evalPlausibilityCalibrationSet,
  scorePlausibilityCalibration,
  type EvalPlausibilityCalibrationPair,
  type EvalPlausibilityCalibrationResult
} from './judging/eval-plausibility-calibration.js'
export {
  calculateEvalMetrics,
  EvalMetricsSchema,
  severityWeight,
  type EvalJudgeReliability,
  type EvalMetricCaseResult,
  type EvalMetrics
} from './scoring/metrics.js'
export {
  runEvaluation
} from './run/eval-runner.js'
// `runEvalCase` is DELIBERATELY NOT EXPORTED HERE, and adding it would break the
// build rather than merely widen the barrel. It imports `review-workflow`, whose
// preflight imports `drift`, whose artifact-example checker imports this barrel
// for the eval corpus contracts — so a barrel entry closes an import cycle
// (`evaluation/index` → `eval-case-runner` → `review-workflow` → `drift` →
// `evaluation/index`) that `madge --circular` catches and that would put this
// file's zod schemas in the temporal dead zone for whichever side loads second.
// Its one consumer is `src/cli/commands/eval-run.ts`, which imports the module
// directly; the CLI is not a sibling domain, so no domain reaches past a barrel.
// See the header of `run/eval-case-runner.ts`.
//
// The committed evaluation configuration. `eval run` applies the pins to the
// configuration it loaded, and the `--capability` parser beside that command
// reads the flag names off the table to decide what it will accept — two
// cross-boundary needs, one list.
export {
  applyEvalCapabilityPins,
  evalCapabilityPins
} from './run/eval-capability-pins.js'
export {
  EVAL_REPORT_ARTIFACT_NAME,
  EVAL_RECALL_REPORT_ARTIFACT_NAME,
  EVAL_SUMMARY_ARTIFACT_NAME,
  renderEvalSummary
} from './rendering/summary/eval-summary-report-rendering.js'
export {
  renderEvalComparison
} from './rendering/comparison/eval-comparison-report-rendering.js'
export {
  parseEvalComparisonReport,
  type EvalComparisonCase,
  type EvalComparisonMetricGroup,
  type EvalComparisonMetrics,
  type EvalComparisonReport,
  type EvalComparisonRun
} from './report/eval-comparison-view.js'
export {
  parseEvalRecallView,
  type EvalRecallView
} from './report/eval-recall-view.js'
export {
  EVAL_METRICS_VERSION_HISTORY,
  metricComparability,
  metricsAffectedBetween,
  type EvalComparabilityKey,
  type MetricComparability
} from './report/versions/eval-metrics-versions.js'
export {
  PAIRED_SIGNIFICANCE_ALPHA,
  pairedRecallVerdict,
  type PairedArmSummary,
  type PairedPopulationVerdict,
  type PairedRecallVerdict
} from './scoring/eval-paired-recall-verdict.js'
export {
  precisionBracket,
  type PrecisionBracket,
  type PrecisionBracketBound
} from './scoring/eval-precision-bracket.js'
export {
  renderEvalRecallReport
} from './rendering/eval-recall-report-rendering.js'
export {
  EVAL_METRICS_VERSION,
  EvalRegressionThresholdsSchema,
  EvalReportCapabilityFlagsSchema,
  EvalReportSchema,
  type EvalCaseOutput,
  type EvalRegressionGateOutcome,
  type EvalRegressionThresholds,
  type EvalReport,
  type EvalReportCapabilityFlags,
  type EvalReportProvenance
} from './report/eval-report-contracts.js'
export {
  computeAnswerKeyDigest,
  computeChangeImpactAnswerKeyDigest,
  computeChangeImpactAnswerKeyDigestByCase,
  computeIntentAnswerKeyDigest,
  computeIntentAnswerKeyDigestByCase
} from './report/eval-report-provenance.js'
export {
  loadEvalCasesFromFixtures
} from './corpus/eval-fixture-loader.js'
export {
  createEvalSliceManifest,
  EvalSliceManifestSchema
} from './corpus/eval-slice-manifest.js'
export {
  calculateEvalDiffStats
} from './scoring/eval-diff-stats.js'
export {
  allDiffScopes,
  classifyExpectedFindingDiffScope,
  DiffScopeSchema,
  expectedFindingDiffScopes,
  hunkSpansByPath,
  type DiffScope
} from './scoring/eval-diff-scope.js'
