import { z } from 'zod'
import type { Severity } from '../../shared/contracts/index.js'
import { allDiffScopes, DiffScopeSchema, type DiffScope } from './eval-diff-scope.js'
import {
  ExpectedFindingTierSchema,
  isObviousSecurityContextDepth,
  productRecallTiers,
  SecurityContextDepthSchema,
  SecurityMechanismSchema,
  type ExpectedFindingTier,
  type SecurityContextDepth,
  type SecurityMechanism
} from './eval-fixture.schema.js'
import {
  allSecurityMechanismBuckets,
  emptySecurityFindingMechanismCounts,
  UNATTRIBUTED_SECURITY_MECHANISM,
  type SecurityFindingMechanismCounts,
  type SecurityMechanismBucket
} from './security-mechanism-attribution.js'
import { isProviderIssueWarning } from './eval-warnings.js'

const RATE_MIN = 0
const RATE_MAX = 1
const METRIC_PRECISION = 1_000_000

const allTiers = ExpectedFindingTierSchema.options
const allSecurityMechanisms = SecurityMechanismSchema.options
const allSecurityContextDepths = SecurityContextDepthSchema.options

export type TierFindingCounts = {
  readonly expected: number
  readonly matched: number
}

// Matched/expected pair for a single security mechanism or context depth. There
// is no precision here: an admitted finding carries no mechanism label, so only
// recall (and its denominator) is derivable per spec 15.
export type SecurityFindingCounts = {
  readonly expected: number
  readonly matched: number
}

export const emptyTierCounts = (): Record<
  ExpectedFindingTier,
  TierFindingCounts
> =>
  Object.fromEntries(
    allTiers.map((tier) => [tier, { expected: 0, matched: 0 }])
  ) as Record<ExpectedFindingTier, TierFindingCounts>

export const emptySecurityMechanismCounts = (): Record<
  SecurityMechanism,
  SecurityFindingCounts
> =>
  Object.fromEntries(
    allSecurityMechanisms.map((mechanism) => [
      mechanism,
      { expected: 0, matched: 0 }
    ])
  ) as Record<SecurityMechanism, SecurityFindingCounts>

export const emptySecurityContextDepthCounts = (): Record<
  SecurityContextDepth,
  SecurityFindingCounts
> =>
  Object.fromEntries(
    allSecurityContextDepths.map((depth) => [depth, { expected: 0, matched: 0 }])
  ) as Record<SecurityContextDepth, SecurityFindingCounts>

// Matched/expected pair per diff scope (spec 17). Same shape as the tier and
// security records, and the denominator is what makes the paired recall rate
// readable: `0.0%` over 81 expectations and `n/a` over none are opposite
// statements about the engine.
export type DiffScopeFindingCounts = {
  readonly expected: number
  readonly matched: number
}

export const emptyDiffScopeCounts = (): Record<
  DiffScope,
  DiffScopeFindingCounts
> =>
  Object.fromEntries(
    allDiffScopes.map((scope) => [scope, { expected: 0, matched: 0 }])
  ) as Record<DiffScope, DiffScopeFindingCounts>

const clampRate = (value: unknown): unknown =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(RATE_MAX, Math.max(RATE_MIN, value))
    : value

// Shared rate schema: a [0,1] number that defensively clamps its input before
// validation. Aggregation can legitimately produce a value just outside the
// range (e.g. a coverage ratio whose numerator exceeds its denominator), and an
// unclamped out-of-range value would fail EvalMetricsSchema and abort the entire
// eval run at report assembly. Reuse this for every rate field so that drift can
// never reintroduce that failure mode.
const RateSchema = z.preprocess(
  clampRate,
  z.number().min(RATE_MIN).max(RATE_MAX)
)

const TierRateSchema = z
  .record(ExpectedFindingTierSchema, RateSchema)
  .default(() =>
    Object.fromEntries(allTiers.map((tier) => [tier, 1])) as Record<
      ExpectedFindingTier,
      number
    >
  )

const SecurityFindingCountsSchema = z.strictObject({
  expected: z.int().min(0),
  matched: z.int().min(0)
})

// Security recall records use an empty value of 0, not the 1 recall/recallByTier
// use for "nothing expected": a mechanism with no expected findings has NO
// evidence of recall, and reporting 100% would be a misleading perfect. The
// paired count records (denominators) make each rate interpretable so a
// small-sample mechanism is never over-read.
const SecurityMechanismRateSchema = z
  .record(SecurityMechanismSchema, RateSchema)
  .default(() =>
    Object.fromEntries(
      allSecurityMechanisms.map((mechanism) => [mechanism, 0])
    ) as Record<SecurityMechanism, number>
  )

const SecurityMechanismCountsSchema = z
  .record(SecurityMechanismSchema, SecurityFindingCountsSchema)
  .default(() => emptySecurityMechanismCounts())

const SecurityFindingMechanismCountsSchema = z.strictObject({
  matched: z.int().min(0),
  genuineFalsePositive: z.int().min(0)
})

const SecurityMechanismBucketSchema = z.enum([
  ...SecurityMechanismSchema.options,
  UNATTRIBUTED_SECURITY_MECHANISM
])

const SecurityFindingMechanismCountsRecordSchema = z
  .record(SecurityMechanismBucketSchema, SecurityFindingMechanismCountsSchema)
  .default(() => emptySecurityFindingMechanismCounts())

// Per-mechanism adjusted precision is NULLABLE, and null is the normal value
// rather than an error case. A rate is emitted only when it is BOUNDED: the
// mechanism has a non-empty denominator AND no genuine security false positive
// in the run is unattributable. One unattributed genuine false positive could
// belong to any mechanism, so it bounds all of them, and serialising the
// unbounded ratio would publish a 100% that no evidence supports — the same
// vacuous-perfect shape `lineAccuracy` is null for.
const SecurityMechanismAdjustedPrecisionSchema = z
  .record(SecurityMechanismSchema, RateSchema.nullable())
  .default(() =>
    Object.fromEntries(
      allSecurityMechanisms.map((mechanism) => [mechanism, null])
    ) as Record<SecurityMechanism, number | null>
  )

const SecurityMechanismAttributionCountsSchema = z
  .strictObject({
    expectation: z.int().min(0),
    cwe: z.int().min(0),
    unknown: z.int().min(0)
  })
  .default({ expectation: 0, cwe: 0, unknown: 0 })

const SecurityContextDepthRateSchema = z
  .record(SecurityContextDepthSchema, RateSchema)
  .default(() =>
    Object.fromEntries(
      allSecurityContextDepths.map((depth) => [depth, 0])
    ) as Record<SecurityContextDepth, number>
  )

const SecurityContextDepthCountsSchema = z
  .record(SecurityContextDepthSchema, SecurityFindingCountsSchema)
  .default(() => emptySecurityContextDepthCounts())

const DiffScopeFindingCountsSchema = z.strictObject({
  expected: z.int().min(0),
  matched: z.int().min(0)
})

// Diff-scope recall (spec 17) is NULLABLE per scope, unlike the tier and
// security records, and that is the whole point of the field. The engine's
// measured out-of-diff recall is a real 0.0% over a real denominator; a corpus
// with no out-of-diff expectation at all must therefore be distinguishable from
// that, or the two read identically. Null means "nobody measured this", exactly
// as it does for `lineAccuracy`, and `diffScopeCounts` carries the denominator
// that makes each rate interpretable.
const DiffScopeRateSchema = z
  .record(DiffScopeSchema, RateSchema.nullable())
  .default(() =>
    Object.fromEntries(allDiffScopes.map((scope) => [scope, null])) as Record<
      DiffScope,
      number | null
    >
  )

const DiffScopeCountsSchema = z
  .record(DiffScopeSchema, DiffScopeFindingCountsSchema)
  .default(() => emptyDiffScopeCounts())

const severityWeights: Readonly<Record<Severity, number>> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1
}

export const EvalMetricsSchema = z.strictObject({
  parseValidity: RateSchema,
  recall: RateSchema,
  precision: RateSchema,
  // Headline precision that does not penalise real defects the fixture omitted:
  // matched / (matched + genuineFalsePositiveCount). Empty value 1 like precision.
  adjustedPrecision: RateSchema.default(1),
  f1: RateSchema,
  severityWeightedPrecision: RateSchema,
  severityWeightedRecall: RateSchema,
  severityWeightedF1: RateSchema,
  // Both rates are computed over MATCHED findings, so their denominator is empty
  // whenever nothing matched, and lineAccuracy's is empty on any corpus without a
  // `path-line` expectation, since no other match mode is scored for line
  // overlap. The counts travel with the rates so a report can say "undefined"
  // instead of rendering an empty denominator as 0.0%, which reads as total
  // failure.
  // Null when nothing was checked. A rate over an empty denominator is vacuously
  // 1, and serialising that vacuous 1 into report.json reads as "perfect line
  // placement" to anything that consumes the number without also reading the
  // count. Null cannot be misread, and it forces a consumer to handle the case.
  lineAccuracy: RateSchema.nullable(),
  lineCheckCount: z.int().min(0).default(0),
  // DIAGNOSTIC ONLY (spec 06 item 0.3). This is deliberately a DIFFERENT
  // measurement from lineAccuracy, not a replacement for it: lineAccuracy is
  // the strict scoring metric restricted to `path-line` expectations and
  // feeds nothing else that gates. `linePlacementRate` is a looser observation
  // over every MATCHED expectation that declares a `lineRange`, regardless of
  // match mode -- chiefly `path-semantic`, which is the entire primary
  // real-repository corpus and was therefore invisible to any line-quality
  // measurement at all. It answers "are reported line numbers roughly right on
  // real code", nothing more, and it must never be read into the regression
  // gate or any pass/fail decision. Null (not 0) on an empty denominator, for
  // the same reason lineAccuracy is null: a vacuous 1 or a floored 0 would
  // both misreport "nobody measured this" as a real result.
  linePlacementRate: RateSchema.nullable(),
  linePlacementCheckCount: z.int().min(0).default(0),
  severityAccuracy: RateSchema.nullable(),
  severityCheckCount: z.int().min(0).default(0),
  falsePositiveCount: z.int().min(0),
  // Trustworthy false-positive count: unmatched findings the plausibility judge
  // deemed spurious, plus any whose plausibility judgment could not be completed
  // (fail-closed). genuineFalsePositiveCount + unlistedRealFindingCount always
  // equals the raw falsePositiveCount.
  genuineFalsePositiveCount: z.int().min(0).default(0),
  // Unmatched findings the plausibility judge deemed genuine defects absent from
  // the fixture's expected list.
  //
  // READ THIS AS FRAGMENTATION, NOT AS KEY INCOMPLETENESS. Measured 2026-07-30
  // over 29 such rows from three arms: 16 distinct findings, of which 0 were
  // genuine unlisted defects and 13 were the engine restating a defect the key
  // already lists. The cause is structural rather than a bug in any one layer -
  // a key expectation may fold several defect sites into one entry (traefik
  // expectation 0 names both `Name` and `Port` over lines 591-596) while
  // precision is counted per finding, so one-to-one matching consumes the
  // expectation with the first finding and the second is then, literally, an
  // unlisted real defect.
  //
  // The practical consequence is that this counter REWARDS SPLITTING: an arm that
  // reports one defect as two findings scores higher on it. In the spec 25 A/B
  // the arm leading on this counter (14 against 4) was simultaneously the arm
  // with the LOWEST recall. Do not read it as a discovery signal, and do not
  // difference it across arms without reading
  // `reports/2026-07-30-unlisted-real-diagnosis.md` first.
  unlistedRealFindingCount: z.int().min(0).default(0),
  noFindingZoneFalsePositiveCount: z.int().min(0),
  actionableRate: RateSchema,
  commentsPerKloc: z.number().min(0),
  commentsPerDiffHunk: z.number().min(0),
  incompleteCoverageRate: RateSchema,
  contextMutationRate: RateSchema,
  providerErrorRate: RateSchema,
  providerIssueRate: RateSchema.default(0),
  providerIssueCount: z.int().min(0).default(0),
  duplicateFindingCount: z.int().min(0).default(0),
  artifactOnlyRecall: RateSchema.default(1),
  artifactOnlyPrecision: RateSchema.default(1),
  artifactOnlyFindingCount: z.int().min(0).default(0),
  artifactOnlyMatchedFindingCount: z.int().min(0).default(0),
  artifactOnlyFalsePositiveCount: z.int().min(0).default(0),
  // Rejections by reason, aggregated. Shows what the admission gate discarded
  // before anything downstream could see it.
  rejectionReasonCounts: z.record(z.string(), z.int().min(0)).default({}),
  // Rejections by the rejected CANDIDATE's own severity (spec 06 item 0.4),
  // aggregated. `rejectionReasonCounts` alone cannot answer "is the model
  // over-calling severity", because the admission floor deletes every
  // model-origin `low` candidate before anyone downstream can observe it --
  // the floor and the question it is suspected of confounding would otherwise
  // share one blind spot. A rejection whose candidate severity could not be
  // recovered (currently: refutation-stage rejections, which do not yet thread
  // severity through their own contract) is bucketed under `unknown` rather
  // than silently dropped, so the denominators here always sum to
  // `rejectedFindingCount`.
  rejectionSeverityCounts: z.record(z.string(), z.int().min(0)).default({}),
  // Same tally, cross-tabulated by reason then severity, so a spike in one
  // reason's rejections can be attributed to a severity band instead of only
  // read in aggregate.
  rejectionReasonBySeverityCounts: z
    .record(z.string(), z.record(z.string(), z.int().min(0)))
    .default({}),
  refutationFalseNegativeCount: z.int().min(0).default(0),
  refutationFalsePositiveCount: z.int().min(0).default(0),
  // Fix-lane accuracy metrics (spec 12). All are measured over REAL runs of the
  // finding investigation-and-fix lane and are scored against the eval match
  // result as ground truth: a matched finding is a real defect, a false-positive
  // finding is a non-defect. Unlike recall/precision (whose empty value is 1),
  // every fix-lane rate uses an empty value of 0 so an eval that never exercised
  // the lane reports 0, not a misleading "perfect", and the paired count fields
  // (denominators) make each rate interpretable.
  //
  // All fix-lane rates are scored only over findings the lane was ELIGIBLE to act
  // on (at or above fix.minSeverity) — the lane produces an outcome only for
  // those, so a sub-threshold finding it never touched is neither credited nor
  // penalised. Ground truth is corrected by the plausibility judge: a matched
  // finding OR an unmatched-but-plausible (unlisted-real) finding is 'real'; only
  // a genuine false positive is 'false-positive'.
  //
  // fixJudgmentAccuracy: over eligible findings the lane judged that carry a
  // ground-truth label, the fraction whose judgment agrees with ground truth.
  fixJudgmentAccuracy: RateSchema.default(0),
  // fixFalsePositiveDetectionRate: of eligible genuine-false-positive findings,
  // the fraction the lane judged 'false-positive' (recall on catching real noise).
  fixFalsePositiveDetectionRate: RateSchema.default(0),
  // fixProduceRate: of eligible real findings (matched or unlisted-real), the
  // fraction that received an apply-checked fix (applyCheck 'passed').
  fixProduceRate: RateSchema.default(0),
  // fixApplyFailureRate: of fixes the lane attempted (applyCheck 'passed' or
  // 'failed'), the fraction that FAILED the deterministic apply-check
  // (hallucinated / stale edits caught by code).
  fixApplyFailureRate: RateSchema.default(0),
  // Denominators, surfaced so the rates above are interpretable.
  fixJudgedFindingCount: z.int().min(0).default(0),
  fixGroundTruthFalsePositiveCount: z.int().min(0).default(0),
  fixRealFindingCount: z.int().min(0).default(0),
  fixAttemptedCount: z.int().min(0).default(0),
  // Semantic-judge reliability for the run. `judgeAgreement` is the fraction of
  // human-labeled calibration pairs the judge decided correctly; it is omitted
  // when no calibration pair was scored (an offline run needs no judge).
  judgeAgreement: z.number().min(0).max(1).optional(),
  judgeAgreementPairCount: z.int().min(0).default(0),
  // Plausibility-judge reliability for the run. `plausibilityJudgeAgreement` is
  // the fraction of human-labeled plausibility-calibration findings the judge
  // decided correctly; it is omitted when no calibration pair was scored (an
  // offline run needs no judge). A run below the configured minimum marks
  // `adjustedPrecision` untrustworthy.
  plausibilityJudgeAgreement: z.number().min(0).max(1).optional(),
  plausibilityJudgeAgreementPairCount: z.int().min(0).default(0),
  // Expected/finding pairs the judge could not decide. Excluded from the recall
  // and precision denominators; surfaced as a run warning.
  inconclusiveMatchCount: z.int().min(0).default(0),
  recallByTier: TierRateSchema,
  productRecall: RateSchema.default(1),
  nitRecall: RateSchema.default(1),
  // Diff-scope recall (spec 17 *Diff Scope Of An Expectation*). `recall` above
  // BLENDS two populations whose measured recall differs by tens of points, so
  // its value tracks the in/out ratio of the fixture set as much as reviewer
  // quality. These two are reported alongside it, never instead of it: it would
  // be equally dishonest to headline the in-diff figure and drop the harder
  // population as it was to blend them without saying so.
  //
  // `undetermined` is not a third quality signal. It counts expectations the
  // hunk-span rule cannot place (no path, no declared line range, or a case
  // whose reviewed diff was not captured), and exists so those never silently
  // land in the out-of-diff denominator. A non-zero undetermined count on the
  // real-repository corpus means the classification lost its input, not that
  // the engine did anything.
  recallByDiffScope: DiffScopeRateSchema,
  diffScopeCounts: DiffScopeCountsSchema,
  // Security-dimension measurement (spec 15). Every recall denominator is the
  // count of security-category expected findings carrying the label, aggregated
  // across cases like recallByTier. Non-security expected findings never touch
  // these. Per-mechanism adjusted precision is measured separately below, over a
  // population of ADMITTED findings rather than of expectations.
  //
  // securityRecallByMechanism: matched / expected security findings, per
  // mechanism. Empty value 0 (see SecurityMechanismRateSchema).
  securityRecallByMechanism: SecurityMechanismRateSchema,
  // Per-mechanism {expected, matched} denominators so a small sample is not
  // over-read and the report can show matched/expected.
  securityMechanismCounts: SecurityMechanismCountsSchema,
  // securityRecallByContextDepth: matched / expected security findings, per
  // context depth (local | cross-function | callee | caller | implementation |
  // cross-file | analyzer-path-dependent).
  securityRecallByContextDepth: SecurityContextDepthRateSchema,
  securityContextDepthCounts: SecurityContextDepthCountsSchema,
  // Obvious-vs-hard split, tracked separately so aced trivial (local) sinks
  // never mask the hard-class gap. Obvious = `local` context depth; hard = every
  // other depth. The counts are the expected denominators. Empty value 0.
  securityObviousRecall: RateSchema.default(0),
  securityHardRecall: RateSchema.default(0),
  securityObviousCount: z.int().min(0).default(0),
  securityHardCount: z.int().min(0).default(0),
  // Per-mechanism ADJUSTED PRECISION (spec 15 *Acceptance*). The denominator
  // that did not exist until admitted findings could be attributed to a
  // mechanism: matched / (matched + genuine false positives), per mechanism.
  // See SecurityMechanismAdjustedPrecisionSchema for why a rate is null unless
  // it is bounded, and securityFindingMechanismCounts for the raw halves.
  securityAdjustedPrecisionByMechanism:
    SecurityMechanismAdjustedPrecisionSchema,
  // Both halves of every rate above, plus the `unknown` bucket that holds the
  // findings no source could justify a mechanism for. Reported, never hidden:
  // `unknown.genuineFalsePositive` is exactly the quantity that decides whether
  // any per-mechanism precision is publishable at all.
  securityFindingMechanismCounts: SecurityFindingMechanismCountsRecordSchema,
  // Where the labels came from, over the same population: ground truth the
  // fixture stated (`expectation`), a public CWE tag on the finding (`cwe`), or
  // nothing (`unknown`). A run whose `unknown` share is large has not measured
  // per-mechanism precision, however many rates it prints.
  securityMechanismAttributionCounts:
    SecurityMechanismAttributionCountsSchema,
  inputTokens: z.int().min(0).default(0),
  // Cached input tokens are a SUBSET of inputTokens (already counted there).
  cachedInputTokens: z.int().min(0).default(0),
  outputTokens: z.int().min(0).default(0),
  costUnavailableCount: z.int().min(0).default(0),
  costUsd: z.number().min(0),
  durationMs: z.int().min(0),
  // Judge + plausibility-judge provider spend for the WHOLE run, wrapped by the
  // SAME `createProviderUsageRecorder` mechanism the review path uses (see
  // provider-usage-recorder.ts) and priced with the SAME `summarizeRunCost`
  // helper that produces `costUsd` above. Deliberately NOT folded into
  // `costUsd`/`inputTokens`/`outputTokens`, which are folded ONLY from each
  // case's REVIEW report: every judge/plausibility-judge call a run made --
  // across matching AND the judge/plausibility calibration passes -- used to
  // be counted nowhere, so true provider spend was understated by whatever the
  // judge itself cost. Folding it into `costUsd` instead of giving it its own
  // field would silently change what that number has always meant to every
  // existing report and dashboard that reads it.
  scoringInputTokens: z.int().min(0).default(0),
  scoringCachedInputTokens: z.int().min(0).default(0),
  scoringOutputTokens: z.int().min(0).default(0),
  // Mirrors `costUnavailableCount`'s per-case semantics, but the judge/
  // plausibility recorder covers the whole run rather than one case, so this
  // is a single flag rather than a count.
  scoringCostUnavailable: z.boolean().default(false),
  scoringCostUsd: z.number().min(0).default(0),
  // Monotonic wall-clock elapsed time for the WHOLE evaluation run (per-case
  // review execution AND judge/plausibility scoring), as opposed to
  // `durationMs`, which only SUMS each case's own review time and therefore
  // can never be compared to how long the run actually took: idle time
  // between cases, judge/plausibility provider calls, and orchestration
  // overhead are all invisible to a sum of per-case numbers.
  elapsedMs: z.int().min(0).default(0)
})

export type EvalMetrics = z.infer<typeof EvalMetricsSchema>

export type EvalMetricCaseResult = {
  readonly caseId: string
  readonly parseValid: boolean
  readonly providerErrored: boolean
  readonly providerIssueCount: number
  // Expected findings that were actually SCORED: declared expected findings
  // minus the ones whose verdict is inconclusive because a judge call failed.
  // This is the recall denominator.
  readonly expectedFindingCount: number
  // Expected/finding pairs the judge could not decide for this case.
  readonly inconclusiveMatchCount: number
  readonly admittedFindingCount: number
  readonly matchedFindingCount: number
  readonly expectedSeverityWeights: readonly number[]
  readonly matchedExpectedSeverityWeights: readonly number[]
  readonly falsePositiveSeverityWeights: readonly number[]
  readonly matchedLineCheckCount: number
  readonly accurateLineMatchCount: number
  // Diagnostic-only counterparts (spec 06 item 0.3): numerator/denominator of
  // `linePlacementRate`. See that field's schema comment for why this is a
  // separate measurement from the pair above rather than a broader version of
  // it feeding the same metric.
  readonly linePlacementCheckCount: number
  readonly accurateLinePlacementCount: number
  readonly matchedSeverityCheckCount: number
  readonly accurateSeverityMatchCount: number
  readonly actionableFindingCount: number
  readonly falsePositiveCount: number
  // Unmatched findings the plausibility judge affirmatively deemed genuine but
  // unlisted defects. genuineFalsePositiveCount is derived as
  // falsePositiveCount - unlistedRealFindingCount, so a fail-closed (unjudged)
  // finding is a genuine false positive by construction.
  readonly unlistedRealFindingCount: number
  readonly duplicateFindingCount: number
  readonly artifactOnlyFindingCount: number
  readonly artifactOnlyMatchedFindingCount: number
  readonly artifactOnlyFalsePositiveCount: number
  // Refutation results with a `proved` verdict. Used to derive the refutation
  // false-positive count (proved refutations whose finding never matched).
  readonly provedRefutationCount: number
  // Rejected/demoted candidates. Used to derive the refutation false-negative
  // count (expected findings demoted without a matching admitted finding).
  readonly rejectedFindingCount: number
  readonly rejectionReasonCounts: Readonly<Record<string, number>>
  // Per-severity and reason x severity tallies of the same rejected candidates
  // (spec 06 item 0.4). See `EvalMetricsSchema` for why a candidate whose
  // severity could not be recovered is bucketed under `unknown` rather than
  // dropped.
  readonly rejectionSeverityCounts: Readonly<Record<string, number>>
  readonly rejectionReasonBySeverityCounts: Readonly<
    Record<string, Readonly<Record<string, number>>>
  >
  // Fix-lane (spec 12) per-case tallies, all derived from real fix-lane outcomes
  // joined to the match result. See EvalMetricsSchema for the aggregate formulas.
  // Numerator/denominator of fixJudgmentAccuracy.
  readonly fixJudgmentAgreementCount: number
  readonly fixJudgedLabeledCount: number
  // Numerator/denominator of fixFalsePositiveDetectionRate.
  readonly fixFalsePositiveDetectedCount: number
  readonly fixGroundTruthFalsePositiveCount: number
  // Numerator/denominator of fixProduceRate.
  readonly fixProducedForRealCount: number
  readonly fixRealFindingCount: number
  // Numerator/denominator of fixApplyFailureRate.
  readonly fixApplyFailedCount: number
  readonly fixApplyAttemptedCount: number
  readonly tierCounts: Record<ExpectedFindingTier, TierFindingCounts>
  // Security-dimension tallies (spec 15): matched/expected counts for the
  // case's security-category expected findings, bucketed by mechanism and by
  // context depth. Derived from the match result joined to the labelled expected
  // findings. Non-security expected findings never appear here.
  readonly securityMechanismCounts: Record<
    SecurityMechanism,
    SecurityFindingCounts
  >
  readonly securityContextDepthCounts: Record<
    SecurityContextDepth,
    SecurityFindingCounts
  >
  // Per-mechanism precision tallies over the case's ADMITTED findings (spec 15).
  // Built by `securityFindingMechanismCountsForCase`; see that function for the
  // population and why `unknown` is a first-class bucket rather than a discard.
  readonly securityFindingMechanismCounts: Record<
    SecurityMechanismBucket,
    SecurityFindingMechanismCounts
  >
  // Diff-scope tallies (spec 17): matched/expected per in-diff, out-of-diff and
  // undetermined, derived from the case's own reviewed diff joined to the match
  // result. Aggregated exactly like `tierCounts`.
  readonly diffScopeCounts: Record<DiffScope, DiffScopeFindingCounts>
  readonly noFindingZoneFalsePositiveCount: number
  readonly changedLineCount: number
  readonly diffHunkCount: number
  readonly coverageIncomplete: boolean
  readonly contextLedgerEntryCount: number
  readonly mutatedContextLedgerEntryCount: number
  readonly costUsd: number
  readonly inputTokens: number
  readonly cachedInputTokens: number
  readonly outputTokens: number
  readonly costUnavailable: boolean
  readonly durationMs: number
  readonly warnings: readonly string[]
  readonly failingFindingIds: readonly string[]
}

const roundMetric = (value: number): number =>
  Math.round(value * METRIC_PRECISION) / METRIC_PRECISION

const ratio = (
  numerator: number,
  denominator: number,
  emptyValue: number
): number => (denominator === 0 ? emptyValue : roundMetric(numerator / denominator))

// For rates whose empty case is "nobody measured this", as opposed to precision's
// empty case of "nothing was reported, so nothing was wrong".
const rateOrNull = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : roundMetric(numerator / denominator)

const harmonicMean = (left: number, right: number): number =>
  left + right === 0 ? 0 : roundMetric((2 * left * right) / (left + right))

const sum = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0)

export const severityWeight = (severity: Severity): number =>
  severityWeights[severity]

const hasProviderIssue = (result: EvalMetricCaseResult): boolean =>
  result.providerErrored ||
  result.providerIssueCount > 0 ||
  result.warnings.some(isProviderIssueWarning)

// Run-level semantic-judge reliability. It is not derivable from case results
// (the calibration set is scored once per run), so it is passed in and repeated
// on every metric group: the same judge produced every group's numbers.
export type EvalJudgeReliability = {
  readonly judgeAgreement?: number
  readonly judgeAgreementPairCount: number
  // Plausibility-judge reliability, scored once per run and repeated on every
  // metric group (one judge produced every group's numbers).
  readonly plausibilityJudgeAgreement?: number
  readonly plausibilityJudgeAgreementPairCount: number
}

// Run-level judge/plausibility-judge spend and wall-clock elapsed time.
// Neither is derivable from case results -- the usage recorder wraps
// judge/plausibility calls across the WHOLE run rather than per case, and the
// elapsed timer spans the whole run -- so both are passed in and repeated on
// every metric group, exactly like `EvalJudgeReliability`: one run produced
// every group's numbers.
export type EvalRunTotals = {
  readonly elapsedMs: number
  readonly scoringInputTokens: number
  readonly scoringCachedInputTokens: number
  readonly scoringOutputTokens: number
  readonly scoringCostUsd: number
  readonly scoringCostUnavailable: boolean
}

export const emptyRunTotals: EvalRunTotals = {
  elapsedMs: 0,
  scoringInputTokens: 0,
  scoringCachedInputTokens: 0,
  scoringOutputTokens: 0,
  scoringCostUsd: 0,
  scoringCostUnavailable: false
}

export const calculateEvalMetrics = (
  caseResults: readonly EvalMetricCaseResult[],
  judgeReliability?: EvalJudgeReliability,
  runTotals: EvalRunTotals = emptyRunTotals
): EvalMetrics => {
  const totalCaseCount = caseResults.length
  const totalExpectedFindingCount = sum(
    caseResults.map((result) => result.expectedFindingCount)
  )
  const totalAdmittedFindingCount = sum(
    caseResults.map((result) => result.admittedFindingCount)
  )
  const totalMatchedFindingCount = sum(
    caseResults.map((result) => result.matchedFindingCount)
  )
  const totalFalsePositiveCount = sum(
    caseResults.map((result) => result.falsePositiveCount)
  )
  const totalUnlistedRealFindingCount = sum(
    caseResults.map((result) => result.unlistedRealFindingCount)
  )
  // Every raw false positive the plausibility judge did not affirmatively credit
  // as a real defect — including fail-closed ones — is a genuine false positive.
  const totalGenuineFalsePositiveCount =
    totalFalsePositiveCount - totalUnlistedRealFindingCount
  const providerIssueCount = caseResults.filter(hasProviderIssue).length
  const totalArtifactOnlyFindingCount = sum(
    caseResults.map((result) => result.artifactOnlyFindingCount)
  )
  const totalArtifactOnlyMatchedFindingCount = sum(
    caseResults.map((result) => result.artifactOnlyMatchedFindingCount)
  )
  const totalArtifactOnlyFalsePositiveCount = sum(
    caseResults.map((result) => result.artifactOnlyFalsePositiveCount)
  )
  const totalExpectedSeverityWeight = sum(
    caseResults.flatMap((result) => result.expectedSeverityWeights)
  )
  const totalMatchedExpectedSeverityWeight = sum(
    caseResults.flatMap((result) => result.matchedExpectedSeverityWeights)
  )
  const totalFalsePositiveSeverityWeight = sum(
    caseResults.flatMap((result) => result.falsePositiveSeverityWeights)
  )
  const precision = ratio(
    totalMatchedFindingCount,
    totalMatchedFindingCount + totalFalsePositiveCount,
    1
  )
  // adjustedPrecision does not penalise real defects the fixture omitted; only
  // genuine false positives (including fail-closed, unjudged ones) sit in its
  // denominator. Empty value 1 like precision (0 findings -> 1).
  const adjustedPrecision = ratio(
    totalMatchedFindingCount,
    totalMatchedFindingCount + totalGenuineFalsePositiveCount,
    1
  )
  const recall = ratio(totalMatchedFindingCount, totalExpectedFindingCount, 1)
  const tierTotals = allTiers.map((tier) => {
    const expected = sum(
      caseResults.map((result) => result.tierCounts[tier].expected)
    )
    const matched = sum(
      caseResults.map((result) => result.tierCounts[tier].matched)
    )

    return { tier, expected, matched }
  })
  // Rate fields are clamped to [0,1] by RateSchema at validation, so these
  // ratios are written plainly; see RateSchema for why clamping is required.
  const recallByTier = Object.fromEntries(
    tierTotals.map(({ tier, expected, matched }) => [
      tier,
      ratio(matched, expected, 1)
    ])
  ) as Record<ExpectedFindingTier, number>
  const productTierTotals = tierTotals.filter((entry) =>
    (productRecallTiers as readonly string[]).includes(entry.tier)
  )
  const productRecall = ratio(
    sum(productTierTotals.map((entry) => entry.matched)),
    sum(productTierTotals.map((entry) => entry.expected)),
    1
  )
  const nitRecall = recallByTier.nit
  // Security dimension (spec 15). Aggregate the per-case mechanism and
  // context-depth tallies exactly like recallByTier, but with an empty value of
  // 0 so a mechanism with no expected findings reports 0, not a misleading 100%.
  const securityMechanismTotals = allSecurityMechanisms.map((mechanism) => ({
    mechanism,
    expected: sum(
      caseResults.map(
        (result) => result.securityMechanismCounts[mechanism].expected
      )
    ),
    matched: sum(
      caseResults.map(
        (result) => result.securityMechanismCounts[mechanism].matched
      )
    )
  }))
  const securityRecallByMechanism = Object.fromEntries(
    securityMechanismTotals.map(({ mechanism, expected, matched }) => [
      mechanism,
      ratio(matched, expected, 0)
    ])
  ) as Record<SecurityMechanism, number>
  const securityMechanismCounts = Object.fromEntries(
    securityMechanismTotals.map(({ mechanism, expected, matched }) => [
      mechanism,
      { expected, matched }
    ])
  ) as Record<SecurityMechanism, SecurityFindingCounts>
  const securityContextDepthTotals = allSecurityContextDepths.map((depth) => ({
    depth,
    expected: sum(
      caseResults.map(
        (result) => result.securityContextDepthCounts[depth].expected
      )
    ),
    matched: sum(
      caseResults.map(
        (result) => result.securityContextDepthCounts[depth].matched
      )
    )
  }))
  const securityRecallByContextDepth = Object.fromEntries(
    securityContextDepthTotals.map(({ depth, expected, matched }) => [
      depth,
      ratio(matched, expected, 0)
    ])
  ) as Record<SecurityContextDepth, number>
  const securityContextDepthCounts = Object.fromEntries(
    securityContextDepthTotals.map(({ depth, expected, matched }) => [
      depth,
      { expected, matched }
    ])
  ) as Record<SecurityContextDepth, SecurityFindingCounts>
  const obviousDepthTotals = securityContextDepthTotals.filter((entry) =>
    isObviousSecurityContextDepth(entry.depth)
  )
  const hardDepthTotals = securityContextDepthTotals.filter(
    (entry) => !isObviousSecurityContextDepth(entry.depth)
  )
  const securityObviousExpected = sum(
    obviousDepthTotals.map((entry) => entry.expected)
  )
  const securityHardExpected = sum(hardDepthTotals.map((entry) => entry.expected))
  const securityObviousRecall = ratio(
    sum(obviousDepthTotals.map((entry) => entry.matched)),
    securityObviousExpected,
    0
  )
  const securityHardRecall = ratio(
    sum(hardDepthTotals.map((entry) => entry.matched)),
    securityHardExpected,
    0
  )
  // Per-mechanism adjusted precision (spec 15 *Acceptance*). Aggregate the
  // per-case admitted-finding tallies, then publish a rate ONLY where it is
  // bounded: see SecurityMechanismAdjustedPrecisionSchema.
  const securityFindingMechanismCounts = Object.fromEntries(
    allSecurityMechanismBuckets.map((bucket) => [
      bucket,
      {
        matched: sum(
          caseResults.map(
            (result) => result.securityFindingMechanismCounts[bucket].matched
          )
        ),
        genuineFalsePositive: sum(
          caseResults.map(
            (result) =>
              result.securityFindingMechanismCounts[bucket].genuineFalsePositive
          )
        )
      }
    ])
  ) as Record<SecurityMechanismBucket, SecurityFindingMechanismCounts>
  // One genuine security false positive nobody could attribute could belong to
  // any mechanism, so it bounds every mechanism's precision at once. While that
  // count is non-zero no per-mechanism rate is publishable, and the counts below
  // are what a reader uses instead.
  const unattributedGenuineFalsePositives =
    securityFindingMechanismCounts[UNATTRIBUTED_SECURITY_MECHANISM]
      .genuineFalsePositive
  const securityAdjustedPrecisionByMechanism = Object.fromEntries(
    allSecurityMechanisms.map((mechanism) => {
      const counts = securityFindingMechanismCounts[mechanism]
      const denominator = counts.matched + counts.genuineFalsePositive

      return [
        mechanism,
        unattributedGenuineFalsePositives > 0
          ? null
          : rateOrNull(counts.matched, denominator)
      ]
    })
  ) as Record<SecurityMechanism, number | null>
  // Derived rather than tallied a second time, because the tally rules make the
  // source unambiguous: a `matched` entry can only have come from the expectation
  // it matched, a mechanism-bucketed genuine false positive can only have come
  // from the finding's own CWE tags, and the `unknown` bucket is by definition
  // what neither source could label. A second counter would be a second thing to
  // keep in step with `securityFindingMechanismCountsForCase`.
  const securityMechanismAttributionCounts = {
    expectation: sum(
      allSecurityMechanisms.map(
        (mechanism) => securityFindingMechanismCounts[mechanism].matched
      )
    ),
    cwe: sum(
      allSecurityMechanisms.map(
        (mechanism) =>
          securityFindingMechanismCounts[mechanism].genuineFalsePositive
      )
    ),
    unknown: unattributedGenuineFalsePositives
  }
  // Diff scope (spec 17). Aggregated like the tier counts, but the rate is
  // `rateOrNull`, not `ratio`: an empty denominator here must not render as the
  // 0.0% that a fully-missed out-of-diff population legitimately reports.
  const diffScopeTotals = allDiffScopes.map((scope) => ({
    scope,
    expected: sum(
      caseResults.map((result) => result.diffScopeCounts[scope].expected)
    ),
    matched: sum(
      caseResults.map((result) => result.diffScopeCounts[scope].matched)
    )
  }))
  const recallByDiffScope = Object.fromEntries(
    diffScopeTotals.map(({ scope, expected, matched }) => [
      scope,
      rateOrNull(matched, expected)
    ])
  ) as Record<DiffScope, number | null>
  const diffScopeCounts = Object.fromEntries(
    diffScopeTotals.map(({ scope, expected, matched }) => [
      scope,
      { expected, matched }
    ])
  ) as Record<DiffScope, DiffScopeFindingCounts>
  const severityWeightedPrecision = ratio(
    totalMatchedExpectedSeverityWeight,
    totalMatchedExpectedSeverityWeight + totalFalsePositiveSeverityWeight,
    1
  )
  const severityWeightedRecall = ratio(
    totalMatchedExpectedSeverityWeight,
    totalExpectedSeverityWeight,
    1
  )

  return EvalMetricsSchema.parse({
    parseValidity: ratio(
      caseResults.filter((result) => result.parseValid).length,
      totalCaseCount,
      1
    ),
    recall,
    precision,
    adjustedPrecision,
    f1: harmonicMean(precision, recall),
    severityWeightedPrecision,
    severityWeightedRecall,
    severityWeightedF1: harmonicMean(
      severityWeightedPrecision,
      severityWeightedRecall
    ),
    lineCheckCount: sum(
      caseResults.map((result) => result.matchedLineCheckCount)
    ),
    severityCheckCount: sum(
      caseResults.map((result) => result.matchedSeverityCheckCount)
    ),
    lineAccuracy: rateOrNull(
      sum(caseResults.map((result) => result.accurateLineMatchCount)),
      sum(caseResults.map((result) => result.matchedLineCheckCount))
    ),
    // Diagnostic only -- see the schema comment on `linePlacementRate`. Kept as
    // a wholly separate aggregation from `lineAccuracy` immediately above so
    // the two can never be conflated by sharing a computation.
    linePlacementCheckCount: sum(
      caseResults.map((result) => result.linePlacementCheckCount)
    ),
    linePlacementRate: rateOrNull(
      sum(caseResults.map((result) => result.accurateLinePlacementCount)),
      sum(caseResults.map((result) => result.linePlacementCheckCount))
    ),
    severityAccuracy: rateOrNull(
      sum(caseResults.map((result) => result.accurateSeverityMatchCount)),
      sum(caseResults.map((result) => result.matchedSeverityCheckCount))
    ),
    falsePositiveCount: totalFalsePositiveCount,
    genuineFalsePositiveCount: totalGenuineFalsePositiveCount,
    unlistedRealFindingCount: totalUnlistedRealFindingCount,
    noFindingZoneFalsePositiveCount: sum(
      caseResults.map((result) => result.noFindingZoneFalsePositiveCount)
    ),
    actionableRate: ratio(
      sum(caseResults.map((result) => result.actionableFindingCount)),
      totalAdmittedFindingCount,
      1
    ),
    commentsPerKloc:
      sum(caseResults.map((result) => result.changedLineCount)) === 0
        ? 0
        : roundMetric(
            (totalAdmittedFindingCount * 1000) /
              sum(caseResults.map((result) => result.changedLineCount))
          ),
    commentsPerDiffHunk: ratio(
      totalAdmittedFindingCount,
      sum(caseResults.map((result) => result.diffHunkCount)),
      0
    ),
    incompleteCoverageRate: ratio(
      caseResults.filter((result) => result.coverageIncomplete).length,
      totalCaseCount,
      0
    ),
    contextMutationRate: ratio(
      sum(caseResults.map((result) => result.mutatedContextLedgerEntryCount)),
      sum(caseResults.map((result) => result.contextLedgerEntryCount)),
      0
    ),
    providerErrorRate: ratio(
      caseResults.filter((result) => result.providerErrored).length,
      totalCaseCount,
      0
    ),
    providerIssueRate: ratio(providerIssueCount, totalCaseCount, 0),
    providerIssueCount,
    duplicateFindingCount: sum(
      caseResults.map((result) => result.duplicateFindingCount)
    ),
    artifactOnlyRecall: ratio(
      totalArtifactOnlyMatchedFindingCount,
      totalExpectedFindingCount,
      1
    ),
    artifactOnlyPrecision: ratio(
      totalArtifactOnlyMatchedFindingCount,
      totalArtifactOnlyMatchedFindingCount + totalArtifactOnlyFalsePositiveCount,
      1
    ),
    artifactOnlyFindingCount: totalArtifactOnlyFindingCount,
    artifactOnlyMatchedFindingCount: totalArtifactOnlyMatchedFindingCount,
    artifactOnlyFalsePositiveCount: totalArtifactOnlyFalsePositiveCount,
    rejectionReasonCounts: caseResults.reduce<Record<string, number>>(
      (totals, result) => {
        for (const [reason, count] of Object.entries(
          result.rejectionReasonCounts
        )) {
          totals[reason] = (totals[reason] ?? 0) + count
        }

        return totals
      },
      {}
    ),
    rejectionSeverityCounts: caseResults.reduce<Record<string, number>>(
      (totals, result) => {
        for (const [severity, count] of Object.entries(
          result.rejectionSeverityCounts
        )) {
          totals[severity] = (totals[severity] ?? 0) + count
        }

        return totals
      },
      {}
    ),
    rejectionReasonBySeverityCounts: caseResults.reduce<
      Record<string, Record<string, number>>
    >((totals, result) => {
      for (const [reason, severityCounts] of Object.entries(
        result.rejectionReasonBySeverityCounts
      )) {
        const reasonTotals = totals[reason] ?? {}
        for (const [severity, count] of Object.entries(severityCounts)) {
          reasonTotals[severity] = (reasonTotals[severity] ?? 0) + count
        }
        totals[reason] = reasonTotals
      }

      return totals
    }, {}),
    // UPPER BOUND, not a measurement: expected findings left unmatched in a case
    // that also rejected something. Whether the rejected candidate was actually
    // the missing expectation is not checked, because establishing that would
    // mean judging every rejected candidate against every expectation, which
    // costs provider calls the evaluation does not spend. Reported as an upper
    // bound so it is not read as a count of proven refuter mistakes.
    refutationFalseNegativeCount: sum(
      caseResults.map((result) =>
        Math.min(
          result.rejectedFindingCount,
          Math.max(0, result.expectedFindingCount - result.matchedFindingCount)
        )
      )
    ),
    // Candidates the refuter PROVED that turned out not to be real defects.
    //
    // This previously counted every proved finding that did not match the answer
    // key, which made it numerically identical to unlistedRealFindingCount on a
    // clean run -- it charged the refuter for the genuine defects the fixture
    // simply never listed, which is precisely what the plausibility judge exists
    // to exonerate. Only a finding the judge deemed spurious is a refuter error,
    // and the count is bounded by the proved refutations so a trusted
    // deterministic finding (which is refutation-exempt) is never charged here.
    refutationFalsePositiveCount: sum(
      caseResults.map((result) =>
        Math.min(
          result.provedRefutationCount,
          Math.max(
            0,
            result.falsePositiveCount - result.unlistedRealFindingCount
          )
        )
      )
    ),
    // Fix-lane accuracy (spec 12). Every rate uses an empty value of 0: a run
    // that never exercised the lane has zero denominators and must report 0, not
    // the 1 that recall/precision use for "nothing expected".
    fixJudgmentAccuracy: ratio(
      sum(caseResults.map((result) => result.fixJudgmentAgreementCount)),
      sum(caseResults.map((result) => result.fixJudgedLabeledCount)),
      0
    ),
    fixFalsePositiveDetectionRate: ratio(
      sum(caseResults.map((result) => result.fixFalsePositiveDetectedCount)),
      sum(caseResults.map((result) => result.fixGroundTruthFalsePositiveCount)),
      0
    ),
    fixProduceRate: ratio(
      sum(caseResults.map((result) => result.fixProducedForRealCount)),
      sum(caseResults.map((result) => result.fixRealFindingCount)),
      0
    ),
    fixApplyFailureRate: ratio(
      sum(caseResults.map((result) => result.fixApplyFailedCount)),
      sum(caseResults.map((result) => result.fixApplyAttemptedCount)),
      0
    ),
    fixJudgedFindingCount: sum(
      caseResults.map((result) => result.fixJudgedLabeledCount)
    ),
    fixGroundTruthFalsePositiveCount: sum(
      caseResults.map((result) => result.fixGroundTruthFalsePositiveCount)
    ),
    fixRealFindingCount: sum(
      caseResults.map((result) => result.fixRealFindingCount)
    ),
    fixAttemptedCount: sum(
      caseResults.map((result) => result.fixApplyAttemptedCount)
    ),
    ...(judgeReliability?.judgeAgreement === undefined
      ? {}
      : { judgeAgreement: judgeReliability.judgeAgreement }),
    judgeAgreementPairCount: judgeReliability?.judgeAgreementPairCount ?? 0,
    ...(judgeReliability?.plausibilityJudgeAgreement === undefined
      ? {}
      : { plausibilityJudgeAgreement: judgeReliability.plausibilityJudgeAgreement }),
    plausibilityJudgeAgreementPairCount:
      judgeReliability?.plausibilityJudgeAgreementPairCount ?? 0,
    inconclusiveMatchCount: sum(
      caseResults.map((result) => result.inconclusiveMatchCount)
    ),
    recallByTier,
    productRecall,
    nitRecall,
    recallByDiffScope,
    diffScopeCounts,
    securityRecallByMechanism,
    securityMechanismCounts,
    securityRecallByContextDepth,
    securityContextDepthCounts,
    securityObviousRecall,
    securityHardRecall,
    securityObviousCount: securityObviousExpected,
    securityHardCount: securityHardExpected,
    securityAdjustedPrecisionByMechanism,
    securityFindingMechanismCounts,
    securityMechanismAttributionCounts,
    inputTokens: sum(caseResults.map((result) => result.inputTokens)),
    cachedInputTokens: sum(caseResults.map((result) => result.cachedInputTokens)),
    outputTokens: sum(caseResults.map((result) => result.outputTokens)),
    costUnavailableCount: caseResults.filter((result) => result.costUnavailable)
      .length,
    costUsd: roundMetric(sum(caseResults.map((result) => result.costUsd))),
    durationMs: sum(caseResults.map((result) => result.durationMs)),
    scoringInputTokens: runTotals.scoringInputTokens,
    scoringCachedInputTokens: runTotals.scoringCachedInputTokens,
    scoringOutputTokens: runTotals.scoringOutputTokens,
    scoringCostUnavailable: runTotals.scoringCostUnavailable,
    scoringCostUsd: roundMetric(runTotals.scoringCostUsd),
    elapsedMs: runTotals.elapsedMs
  })
}
