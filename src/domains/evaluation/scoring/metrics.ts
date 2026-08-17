import { z } from 'zod'
import type { Severity } from '../../../shared/contracts/index.js'
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
} from '../corpus/eval-fixture.schema.js'
import {
  allSecurityMechanismBuckets,
  emptySecurityFindingMechanismCounts,
  UNATTRIBUTED_SECURITY_MECHANISM,
  type SecurityFindingMechanismCounts,
  type SecurityMechanismBucket
} from './security-mechanism-attribution.js'
import { isProviderIssueWarning } from '../eval-warnings.js'

const RATE_MIN = 0
const RATE_MAX = 1
const METRIC_PRECISION = 1_000_000

const allTiers = ExpectedFindingTierSchema.options
const allSecurityMechanisms = SecurityMechanismSchema.options
const allSecurityContextDepths = SecurityContextDepthSchema.options

// Matched/expected pair for one key of a paired-recall breakdown: tier (spec
// 06), security mechanism and security context depth (spec 15), diff scope
// (spec 17). One shape for all four, because they differ only in their key set
// and in what an empty denominator means — and that second difference is stated
// by each aggregate at its call site (`ratio(..., 1)` vs `rateOrNull`) rather
// than baked into the counts.
//
// There is no precision here: an admitted finding carries no tier, mechanism,
// depth or scope label, so only recall (and its denominator) is derivable per
// spec 15. The denominator is what makes the paired rate readable: `0.0%` over
// 81 expectations and `n/a` over none are opposite statements about the engine.
export type PairedFindingCounts = {
  readonly expected: number
  readonly matched: number
}

// The single place the `Object.fromEntries` assertion is written. `fromEntries`
// widens its key type to `string`, so the assertion cannot be avoided; writing
// it once keeps it from being re-derived — and mis-keyed — per breakdown.
const emptyPairedCounts = <Key extends string>(
  keys: readonly Key[]
): Record<Key, PairedFindingCounts> =>
  Object.fromEntries(
    keys.map((key) => [key, { expected: 0, matched: 0 }])
  ) as Record<Key, PairedFindingCounts>

export const emptyTierCounts = (): Record<
  ExpectedFindingTier,
  PairedFindingCounts
> => emptyPairedCounts(allTiers)

export const emptySecurityMechanismCounts = (): Record<
  SecurityMechanism,
  PairedFindingCounts
> => emptyPairedCounts(allSecurityMechanisms)

export const emptySecurityContextDepthCounts = (): Record<
  SecurityContextDepth,
  PairedFindingCounts
> => emptyPairedCounts(allSecurityContextDepths)

export const emptyDiffScopeCounts = (): Record<DiffScope, PairedFindingCounts> =>
  emptyPairedCounts(allDiffScopes)

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

// Wire shape of `PairedFindingCounts`, shared by every paired-recall breakdown
// for the same reason the type is: a mechanism's counts and a diff scope's
// counts are the same fact about a different key set.
const PairedFindingCountsSchema = z.strictObject({
  expected: z.int().min(0),
  matched: z.int().min(0)
})

// NULLABLE, for the same reason `DiffScopeRateSchema` below is.
//
// This comment used to argue that the empty value is 0 rather than the 1 that
// `recall`/`recallByTier` use for "nothing expected" — a mechanism with no expected
// finding has no evidence of recall, so 100% would be a misleading perfect. That is
// right about 1 and wrong about 0, and it framed the choice as though those were
// the only two: a mechanism the corpus never tested reported the same 0 as one the
// reviewer genuinely missed every time.
//
// It was not hypothetical. 23 archived reports publish `securityObviousRecall: 0`
// on corpora carrying no security expectation at all. Spec 15 diagnosed exactly
// this for the `prompt-injection` label — "every report published
// `prompt-injection: 0%` over an empty denominator, which reads as a measured
// failure" — and removed that enum member, which cured the one symptom and left
// the disease.
//
// Null means "nobody measured this", as it does for `lineAccuracy` and diff scope.
// The paired count records carry the denominators, so a small-sample mechanism is
// still never over-read.
const SecurityMechanismRateSchema = z
  .record(SecurityMechanismSchema, RateSchema.nullable())
  .default(() =>
    Object.fromEntries(
      allSecurityMechanisms.map((mechanism) => [mechanism, null])
    ) as Record<SecurityMechanism, number | null>
  )

const SecurityMechanismCountsSchema = z
  .record(SecurityMechanismSchema, PairedFindingCountsSchema)
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

// Nullable for the same reason as `SecurityMechanismRateSchema` above: a depth the
// corpus never tested and a depth the reviewer missed every time are different
// facts and must not print the same number.
const SecurityContextDepthRateSchema = z
  .record(SecurityContextDepthSchema, RateSchema.nullable())
  .default(() =>
    Object.fromEntries(
      allSecurityContextDepths.map((depth) => [depth, null])
    ) as Record<SecurityContextDepth, number | null>
  )

const SecurityContextDepthCountsSchema = z
  .record(SecurityContextDepthSchema, PairedFindingCountsSchema)
  .default(() => emptySecurityContextDepthCounts())

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
  .record(DiffScopeSchema, PairedFindingCountsSchema)
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
  // DELIBERATELY NOT NULLABLE, unlike the fix-lane rates below, and the
  // difference is the denominator. These two -- with `parseValidity` and
  // `incompleteCoverageRate` -- are rated over TOTAL CASES, which is empty only
  // for a run that scored no case at all, and such a run has no meaningful value
  // for any metric in the report rather than a missing one here. The fix-lane
  // denominators, by contrast, are empty in the DEFAULT configuration of a run
  // that is otherwise entirely meaningful, which is what makes their floored 0 a
  // lie about a real measurement. `providerIssueCount` beside this rate is an
  // absolute count and is honestly 0 in the empty case, so nulling the rate would
  // add a case every consumer must handle to describe a state the count already
  // describes exactly.
  providerIssueRate: RateSchema.default(0),
  providerIssueCount: z.int().min(0).default(0),
  duplicateFindingCount: z.int().min(0).default(0),
  artifactOnlyRecall: RateSchema.default(1),
  artifactOnlyPrecision: RateSchema.default(1),
  artifactOnlyFindingCount: z.int().min(0).default(0),
  artifactOnlyMatchedFindingCount: z.int().min(0).default(0),
  artifactOnlyFalsePositiveCount: z.int().min(0).default(0),
  // The artifact-only plausibility split. Diagnostic in the strict sense: these
  // two partition `artifactOnlyFalsePositiveCount` and feed NO precision metric,
  // because the artifact-only population is excluded from `precision` and
  // `adjustedPrecision` by construction. Promoting it would be a precision
  // decision, and nobody has made one; until then, knowing how much of that
  // output is real is worth recording and nothing more.
  artifactOnlyUnlistedRealCount: z.int().min(0).default(0),
  artifactOnlyGenuineFalsePositiveCount: z.int().min(0).default(0),
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
  // finding is a non-defect. The paired count fields below are the denominators
  // that make each rate interpretable.
  //
  // ALL FOUR ARE NULLABLE, and null is the value a run reports when the lane
  // produced no population to score -- which is EVERY run in the default
  // configuration, because `fix.enabled` is off. They used to default to 0, and
  // that 0 was indistinguishable from a lane that ran and got everything wrong:
  // `fixJudgmentAccuracy: 0` reads as "the lane agreed with ground truth on
  // nothing", `fixProduceRate: 0` as "it fixed none of the real defects". That
  // is this repository's own silent-optimism defect class -- absence producing a
  // confident, plausible answer instead of an admission -- sitting inside the
  // instrument built to detect it. Null cannot be misread, and it forces a
  // consumer to handle the case, exactly as `lineAccuracy` and
  // `linePlacementRate` above already do.
  //
  // The four are nullable TOGETHER even though only three of the empty-value
  // zeros read as catastrophic (an empty `fixApplyFailureRate` of 0 reads as
  // "nothing failed", which is flattering rather than damning). One family, one
  // convention: three nulls beside one 0 would invite a reader to conclude the
  // 0 was measured.
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
  fixJudgmentAccuracy: RateSchema.nullable(),
  // fixFalsePositiveDetectionRate: of eligible genuine-false-positive findings,
  // the fraction the lane judged 'false-positive' (recall on catching real noise).
  fixFalsePositiveDetectionRate: RateSchema.nullable(),
  // fixProduceRate: of eligible real findings (matched or unlisted-real), the
  // fraction that received an apply-checked fix (applyCheck 'passed').
  fixProduceRate: RateSchema.nullable(),
  // fixApplyFailureRate: of fixes the lane attempted (applyCheck 'passed' or
  // 'failed'), the fraction that FAILED the deterministic apply-check
  // (hallucinated / stale edits caught by code).
  fixApplyFailureRate: RateSchema.nullable(),
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
  // mechanism. NULL where the corpus expected none (see SecurityMechanismRateSchema).
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
  // other depth. The counts are the expected denominators, and the rates are NULL
  // when those denominators are empty — a corpus with no security expectation is
  // the common case for this project's primary corpus, and it used to publish a
  // flat 0 that read as a measured failure of the reviewer.
  // `.default(null)` rather than no default, following `DiffScopeRateSchema`: a
  // report that omits the field never measured it, which is the same claim null
  // makes. An archived report that recorded a floored 0 still parses as 0 -- the
  // metrics-version boundary is what refuses to pool it, not this schema.
  securityObviousRecall: RateSchema.nullable().default(null),
  securityHardRecall: RateSchema.nullable().default(null),
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
  // Token totals summed over the cases whose usage WAS surfaced, with
  // `usageUnavailableCount` beside them for the rest, exactly as cost and
  // duration below. A provider-errored case surfaced no usage record at all, and
  // a confident zero there understates the totals in whichever arm errored more.
  inputTokens: z.int().min(0).default(0),
  // Cached input tokens are a SUBSET of inputTokens (already counted there).
  cachedInputTokens: z.int().min(0).default(0),
  outputTokens: z.int().min(0).default(0),
  // Cases whose token usage is UNKNOWN. ONE count for all three totals, not
  // three: the counts come from a single usage record, so they are surfaced
  // together or not at all (see `caseSpend` in eval-runner.ts). Three counters
  // would be three names for the same fact and could disagree.
  //
  // Deliberately NOT the same population as `costUnavailableCount` below: a run
  // that surfaced usage but had no price for its model has known tokens and an
  // unknown cost.
  usageUnavailableCount: z.int().min(0).default(0),
  // Cases whose model cost is UNKNOWN: a provider-errored case (no report, so
  // no usage was ever surfaced), or a completed case whose report carried
  // `cost-unavailable`. `costUsd` below sums only the cases whose cost IS known,
  // so a nonzero count here is what stops that partial total being read as an
  // exact one -- see `formatCostMetric`, which renders "known; unavailable for N
  // case(s)" rather than a bare figure whenever this is nonzero.
  costUnavailableCount: z.int().min(0).default(0),
  costUsd: z.number().min(0),
  // Summed review time over the cases that HAVE a review duration, with the
  // cases that do not counted beside it for the same reason as cost above. A
  // provider-errored case never reported one.
  durationMs: z.int().min(0),
  durationUnavailableCount: z.int().min(0).default(0),
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
  // Artifact-only unmatched findings the plausibility judge affirmatively deemed
  // real, and the complement that stays noise (including fail-closed ones). They
  // partition `artifactOnlyFalsePositiveCount` and nothing reads them into a
  // precision metric -- see `EvalMetricsSchema` for why that is deliberate.
  readonly artifactOnlyUnlistedRealCount: number
  readonly artifactOnlyGenuineFalsePositiveCount: number
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
  readonly tierCounts: Record<ExpectedFindingTier, PairedFindingCounts>
  // Security-dimension tallies (spec 15): matched/expected counts for the
  // case's security-category expected findings, bucketed by mechanism and by
  // context depth. Derived from the match result joined to the labelled expected
  // findings. Non-security expected findings never appear here.
  readonly securityMechanismCounts: Record<SecurityMechanism, PairedFindingCounts>
  readonly securityContextDepthCounts: Record<
    SecurityContextDepth,
    PairedFindingCounts
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
  readonly diffScopeCounts: Record<DiffScope, PairedFindingCounts>
  readonly noFindingZoneFalsePositiveCount: number
  readonly changedLineCount: number
  readonly diffHunkCount: number
  readonly coverageIncomplete: boolean
  readonly contextLedgerEntryCount: number
  readonly mutatedContextLedgerEntryCount: number
  // `null` means the value was NOT MEASURED, and is deliberately not `0`:
  // a provider-errored case surfaced no usage and no timing, and a completed
  // case can still report `cost-unavailable`. The aggregate sums only the
  // measured cases and counts the unmeasured ones, so an incomplete total is
  // never published as an exact one. There is no separate `costUnavailable`
  // flag: it was a second encoding of `costUsd === null` and could disagree
  // with it.
  readonly costUsd: number | null
  // `null` for the same reason and from the same derivation as `costUsd`: no
  // usage record was surfaced, so the counts were never measured. All three move
  // together, which is why the aggregate carries one `usageUnavailableCount`.
  readonly inputTokens: number | null
  readonly cachedInputTokens: number | null
  readonly outputTokens: number | null
  readonly durationMs: number | null
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

// The measured values only. Summing a `number | null` series by coercing null to
// 0 is exactly the defect this typing exists to prevent: it produces a total
// that looks complete. Callers pair this with a count of the unmeasured cases.
const measured = (values: readonly (number | null)[]): readonly number[] =>
  values.filter((value): value is number => value !== null)

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

// The counts every other dimension is read against, plus the three headline
// rates derived from them alone. They are returned together rather than
// recomputed per field because several are used more than once: the matched
// count is a numerator for precision and a denominator component for its
// adjusted twin, and the admitted count is the denominator of both
// `actionableRate` and `commentsPerKloc`.
type CoreFindingTotals = {
  readonly totalCaseCount: number
  readonly totalExpectedFindingCount: number
  readonly totalAdmittedFindingCount: number
  readonly totalMatchedFindingCount: number
  readonly totalFalsePositiveCount: number
  readonly totalUnlistedRealFindingCount: number
  readonly totalGenuineFalsePositiveCount: number
  readonly providerIssueCount: number
  readonly totalArtifactOnlyFindingCount: number
  readonly totalArtifactOnlyMatchedFindingCount: number
  readonly totalArtifactOnlyFalsePositiveCount: number
  readonly precision: number
  readonly adjustedPrecision: number
  readonly recall: number
}

const coreFindingTotals = (
  caseResults: readonly EvalMetricCaseResult[]
): CoreFindingTotals => {
  const totalExpectedFindingCount = sum(
    caseResults.map((result) => result.expectedFindingCount)
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

  return {
    totalCaseCount: caseResults.length,
    totalExpectedFindingCount,
    totalAdmittedFindingCount: sum(
      caseResults.map((result) => result.admittedFindingCount)
    ),
    totalMatchedFindingCount,
    totalFalsePositiveCount,
    totalUnlistedRealFindingCount,
    totalGenuineFalsePositiveCount,
    providerIssueCount: caseResults.filter(hasProviderIssue).length,
    totalArtifactOnlyFindingCount: sum(
      caseResults.map((result) => result.artifactOnlyFindingCount)
    ),
    totalArtifactOnlyMatchedFindingCount: sum(
      caseResults.map((result) => result.artifactOnlyMatchedFindingCount)
    ),
    totalArtifactOnlyFalsePositiveCount: sum(
      caseResults.map((result) => result.artifactOnlyFalsePositiveCount)
    ),
    precision: ratio(
      totalMatchedFindingCount,
      totalMatchedFindingCount + totalFalsePositiveCount,
      1
    ),
    // adjustedPrecision does not penalise real defects the fixture omitted; only
    // genuine false positives (including fail-closed, unjudged ones) sit in its
    // denominator. Empty value 1 like precision (0 findings -> 1).
    adjustedPrecision: ratio(
      totalMatchedFindingCount,
      totalMatchedFindingCount + totalGenuineFalsePositiveCount,
      1
    ),
    recall: ratio(totalMatchedFindingCount, totalExpectedFindingCount, 1)
  }
}

// Severity-weighted precision/recall and their harmonic mean. Same shape as the
// unweighted pair in `coreFindingTotals`, but every finding contributes its
// severity weight instead of 1.
const severityWeightTotals = (
  caseResults: readonly EvalMetricCaseResult[]
): {
  readonly severityWeightedPrecision: number
  readonly severityWeightedRecall: number
  readonly severityWeightedF1: number
} => {
  const totalExpectedSeverityWeight = sum(
    caseResults.flatMap((result) => result.expectedSeverityWeights)
  )
  const totalMatchedExpectedSeverityWeight = sum(
    caseResults.flatMap((result) => result.matchedExpectedSeverityWeights)
  )
  const totalFalsePositiveSeverityWeight = sum(
    caseResults.flatMap((result) => result.falsePositiveSeverityWeights)
  )
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

  return {
    severityWeightedPrecision,
    severityWeightedRecall,
    severityWeightedF1: harmonicMean(
      severityWeightedPrecision,
      severityWeightedRecall
    )
  }
}

/**
 * Sum one paired-recall breakdown across cases: a rate per key and the counts
 * the rate was computed from.
 *
 * `rate` is a PARAMETER rather than a fixed choice because the empty-denominator
 * decision is the only genuine difference between the four breakdowns, and it is
 * a measurement decision each caller must state out loud. `ratio(m, e, 1)` says
 * "nothing expected means nothing was missed"; `rateOrNull` says "nobody
 * measured this", which is what keeps a mechanism the corpus never tested from
 * reading like one the reviewer missed every time. Burying either in a shared
 * body would make one of those statements by default.
 */
const pairedTotals = <Key extends string, Rate extends number | null>(
  keys: readonly Key[],
  caseResults: readonly EvalMetricCaseResult[],
  select: (result: EvalMetricCaseResult) => Record<Key, PairedFindingCounts>,
  rate: (matched: number, expected: number) => Rate
): {
  readonly rates: Record<Key, Rate>
  readonly counts: Record<Key, PairedFindingCounts>
} => {
  const counts = Object.fromEntries(
    keys.map((key) => [
      key,
      {
        expected: sum(caseResults.map((result) => select(result)[key].expected)),
        matched: sum(caseResults.map((result) => select(result)[key].matched))
      }
    ])
  ) as Record<Key, PairedFindingCounts>

  return {
    rates: Object.fromEntries(
      keys.map((key) => [key, rate(counts[key].matched, counts[key].expected)])
    ) as Record<Key, Rate>,
    counts
  }
}

// The product tiers as a set OF TIERS, so a member that is not a real tier fails
// to compile. `productRecallTiers.includes(tier)` cannot express that: its
// parameter is the narrow tuple union, so it rejects the wider
// `ExpectedFindingTier` and needs a `readonly string[]` cast that throws the
// check away along with the error.
const productRecallTierSet: ReadonlySet<ExpectedFindingTier> = new Set(
  productRecallTiers
)

// Tier recall (spec 06). One aggregation feeds all three published fields, so
// the per-tier rates, the product roll-up and the nit rate can never disagree
// about the same tier's counts.
//
// The empty value is 1, matching `recall` and `TierRateSchema`'s own
// non-nullable default, rather than the `rateOrNull` the security and
// diff-scope breakdowns use. That difference is stated at the call site below.
const tierRecallTotals = (
  caseResults: readonly EvalMetricCaseResult[]
): {
  readonly recallByTier: Record<ExpectedFindingTier, number>
  readonly productRecall: number
  readonly nitRecall: number
} => {
  // Rate fields are clamped to [0,1] by RateSchema at validation, so these
  // ratios are written plainly; see RateSchema for why clamping is required.
  const { rates: recallByTier, counts } = pairedTotals(
    allTiers,
    caseResults,
    (result) => result.tierCounts,
    (matched, expected) => ratio(matched, expected, 1)
  )
  const productTiers = allTiers.filter((tier) => productRecallTierSet.has(tier))

  return {
    recallByTier,
    productRecall: ratio(
      sum(productTiers.map((tier) => counts[tier].matched)),
      sum(productTiers.map((tier) => counts[tier].expected)),
      1
    ),
    nitRecall: recallByTier.nit
  }
}

// Security dimension (spec 15). Aggregate the per-case mechanism tallies exactly
// like recallByTier, but the rate is `rateOrNull`: a mechanism the corpus never
// tested must not report the same number as one the reviewer missed every time.
const securityMechanismRecallTotals = (
  caseResults: readonly EvalMetricCaseResult[]
): {
  readonly securityRecallByMechanism: Record<SecurityMechanism, number | null>
  readonly securityMechanismCounts: Record<SecurityMechanism, PairedFindingCounts>
} => {
  const { rates, counts } = pairedTotals(
    allSecurityMechanisms,
    caseResults,
    (result) => result.securityMechanismCounts,
    rateOrNull
  )

  return {
    securityRecallByMechanism: rates,
    securityMechanismCounts: counts
  }
}

// The same aggregation over context depth, plus the obvious-vs-hard split that
// is derived from it rather than tallied again: obvious is the `local` depth and
// hard is every other one, so both halves come from these totals.
const securityContextDepthRecallTotals = (
  caseResults: readonly EvalMetricCaseResult[]
): {
  readonly securityRecallByContextDepth: Record<
    SecurityContextDepth,
    number | null
  >
  readonly securityContextDepthCounts: Record<
    SecurityContextDepth,
    PairedFindingCounts
  >
  readonly securityObviousRecall: number | null
  readonly securityHardRecall: number | null
  readonly securityObviousCount: number
  readonly securityHardCount: number
} => {
  const { rates, counts } = pairedTotals(
    allSecurityContextDepths,
    caseResults,
    (result) => result.securityContextDepthCounts,
    rateOrNull
  )
  const obviousDepths = allSecurityContextDepths.filter(
    isObviousSecurityContextDepth
  )
  const hardDepths = allSecurityContextDepths.filter(
    (depth) => !isObviousSecurityContextDepth(depth)
  )
  const securityObviousExpected = sum(
    obviousDepths.map((depth) => counts[depth].expected)
  )
  const securityHardExpected = sum(
    hardDepths.map((depth) => counts[depth].expected)
  )

  return {
    securityRecallByContextDepth: rates,
    securityContextDepthCounts: counts,
    securityObviousRecall: rateOrNull(
      sum(obviousDepths.map((depth) => counts[depth].matched)),
      securityObviousExpected
    ),
    securityHardRecall: rateOrNull(
      sum(hardDepths.map((depth) => counts[depth].matched)),
      securityHardExpected
    ),
    securityObviousCount: securityObviousExpected,
    securityHardCount: securityHardExpected
  }
}

// Per-mechanism adjusted precision (spec 15 *Acceptance*). Aggregate the
// per-case admitted-finding tallies, then publish a rate ONLY where it is
// bounded: see SecurityMechanismAdjustedPrecisionSchema.
const securityMechanismPrecisionTotals = (
  caseResults: readonly EvalMetricCaseResult[]
): {
  readonly securityAdjustedPrecisionByMechanism: Record<
    SecurityMechanism,
    number | null
  >
  readonly securityFindingMechanismCounts: Record<
    SecurityMechanismBucket,
    SecurityFindingMechanismCounts
  >
  readonly securityMechanismAttributionCounts: {
    readonly expectation: number
    readonly cwe: number
    readonly unknown: number
  }
} => {
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

  return {
    securityAdjustedPrecisionByMechanism: Object.fromEntries(
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
    ) as Record<SecurityMechanism, number | null>,
    securityFindingMechanismCounts,
    // Derived rather than tallied a second time, because the tally rules make the
    // source unambiguous: a `matched` entry can only have come from the expectation
    // it matched, a mechanism-bucketed genuine false positive can only have come
    // from the finding's own CWE tags, and the `unknown` bucket is by definition
    // what neither source could label. A second counter would be a second thing to
    // keep in step with `securityFindingMechanismCountsForCase`.
    securityMechanismAttributionCounts: {
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
  }
}

// Diff scope (spec 17). Aggregated like the tier counts, but the rate is
// `rateOrNull`, not `ratio`: an empty denominator here must not render as the
// 0.0% that a fully-missed out-of-diff population legitimately reports.
const diffScopeRecallTotals = (
  caseResults: readonly EvalMetricCaseResult[]
): {
  readonly recallByDiffScope: Record<DiffScope, number | null>
  readonly diffScopeCounts: Record<DiffScope, PairedFindingCounts>
} => {
  const { rates, counts } = pairedTotals(
    allDiffScopes,
    caseResults,
    (result) => result.diffScopeCounts,
    rateOrNull
  )

  return {
    recallByDiffScope: rates,
    diffScopeCounts: counts
  }
}

export const calculateEvalMetrics = (
  caseResults: readonly EvalMetricCaseResult[],
  judgeReliability?: EvalJudgeReliability,
  runTotals: EvalRunTotals = emptyRunTotals
): EvalMetrics => {
  const {
    totalCaseCount,
    totalExpectedFindingCount,
    totalAdmittedFindingCount,
    totalFalsePositiveCount,
    totalUnlistedRealFindingCount,
    totalGenuineFalsePositiveCount,
    providerIssueCount,
    totalArtifactOnlyFindingCount,
    totalArtifactOnlyMatchedFindingCount,
    totalArtifactOnlyFalsePositiveCount,
    precision,
    adjustedPrecision,
    recall
  } = coreFindingTotals(caseResults)

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
    ...severityWeightTotals(caseResults),
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
    artifactOnlyUnlistedRealCount: sum(
      caseResults.map((result) => result.artifactOnlyUnlistedRealCount)
    ),
    artifactOnlyGenuineFalsePositiveCount: sum(
      caseResults.map((result) => result.artifactOnlyGenuineFalsePositiveCount)
    ),
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
    // Fix-lane accuracy (spec 12), every rate through `rateOrNull` and none
    // through `ratio`: a run that never exercised the lane -- the default, since
    // `fix.enabled` is off -- has four empty denominators, and a rate over an
    // empty denominator is undefined rather than 0. See the schema comment for
    // why the floored 0 these used to emit was the failure mode, not the
    // convention.
    fixJudgmentAccuracy: rateOrNull(
      sum(caseResults.map((result) => result.fixJudgmentAgreementCount)),
      sum(caseResults.map((result) => result.fixJudgedLabeledCount))
    ),
    fixFalsePositiveDetectionRate: rateOrNull(
      sum(caseResults.map((result) => result.fixFalsePositiveDetectedCount)),
      sum(caseResults.map((result) => result.fixGroundTruthFalsePositiveCount))
    ),
    fixProduceRate: rateOrNull(
      sum(caseResults.map((result) => result.fixProducedForRealCount)),
      sum(caseResults.map((result) => result.fixRealFindingCount))
    ),
    fixApplyFailureRate: rateOrNull(
      sum(caseResults.map((result) => result.fixApplyFailedCount)),
      sum(caseResults.map((result) => result.fixApplyAttemptedCount))
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
    ...tierRecallTotals(caseResults),
    ...diffScopeRecallTotals(caseResults),
    ...securityMechanismRecallTotals(caseResults),
    ...securityContextDepthRecallTotals(caseResults),
    ...securityMechanismPrecisionTotals(caseResults),
    inputTokens: sum(measured(caseResults.map((result) => result.inputTokens))),
    cachedInputTokens: sum(
      measured(caseResults.map((result) => result.cachedInputTokens))
    ),
    outputTokens: sum(measured(caseResults.map((result) => result.outputTokens))),
    usageUnavailableCount: caseResults.filter(
      (result) => result.inputTokens === null
    ).length,
    costUnavailableCount: caseResults.filter((result) => result.costUsd === null)
      .length,
    costUsd: roundMetric(
      sum(measured(caseResults.map((result) => result.costUsd)))
    ),
    durationMs: sum(measured(caseResults.map((result) => result.durationMs))),
    durationUnavailableCount: caseResults.filter(
      (result) => result.durationMs === null
    ).length,
    scoringInputTokens: runTotals.scoringInputTokens,
    scoringCachedInputTokens: runTotals.scoringCachedInputTokens,
    scoringOutputTokens: runTotals.scoringOutputTokens,
    scoringCostUnavailable: runTotals.scoringCostUnavailable,
    scoringCostUsd: roundMetric(runTotals.scoringCostUsd),
    elapsedMs: runTotals.elapsedMs
  })
}
