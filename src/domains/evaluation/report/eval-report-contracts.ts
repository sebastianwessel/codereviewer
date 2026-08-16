import { z } from 'zod'
import {
  FINDING_DESCRIPTION_MAX,
  FindingJudgmentSchema,
  RefutationVerdictSchema,
  ReviewReportSchema
} from '../../../shared/contracts/index.js'
import { ContextLedgerKindSchema } from '../../review-planning/index.js'
import {
  ApplyCheckOutcomeSchema,
  FixDeclinedReasonSchema
} from '../../verification/index.js'
import { EvalMatchModeSchema } from '../corpus/eval-fixture.schema.js'
import { DiffScopeSchema } from '../scoring/eval-diff-scope.js'
import { EvalMetricsSchema } from '../scoring/metrics.js'

export const EvalContextLedgerEntrySchema = z.strictObject({
  kind: ContextLedgerKindSchema,
  consideredForModelContext: z.boolean(),
  truncated: z.boolean()
})

const ProviderErrorSchema = z.strictObject({
  status: z.literal('provider-error'),
  code: z.string().min(1),
  // The agentic stage that failed, when known, so a hard provider error stays
  // diagnosable instead of dropping where it happened.
  stage: z.string().min(1).optional(),
  message: z.string().min(1).max(500)
})

const SuccessfulEvalOutputSchema = z.strictObject({
  status: z.literal('ok'),
  reviewReport: ReviewReportSchema
})

// Per-finding outcome of the finding investigation-and-fix lane (spec 12),
// mirrored into the eval contract so the runner can score the lane's judgment
// and fix quality against the match result. The eval domain owns the SHAPE of
// this mirror (as it does for provider-issue and refutation shapes) but not the
// vocabularies, which are imported for the reason stated on the refutation mirror
// below: a judgment or an apply-check outcome added to the lane must land here
// rather than being silently unrepresentable.
//
// `fixDeclinedReason` is carried, and its omission was not a shape decision but
// the exact confusion `FixDeclinedReasonSchema` was written to end. Without it, a
// fix the agent PROPOSED and this lane refused to carry records here as
// `fixProduced: false, applyCheck: 'not-attempted'` — byte-identical to a finding
// the agent proposed nothing for. Those are opposite facts about the lane, and
// the eval was scoring them as one.
export const EvalFixOutcomeReportSchema = z.strictObject({
  findingId: z.string().min(1),
  findingJudgment: FindingJudgmentSchema.optional(),
  fixProduced: z.boolean(),
  applyCheck: ApplyCheckOutcomeSchema,
  // Optional exactly as the producer makes it: present only when a proposed fix
  // was refused before the apply-check ran, so its absence means the check ran or
  // there was nothing to check — never "declined for a reason nobody recorded".
  fixDeclinedReason: FixDeclinedReasonSchema.optional()
})

export const EvalCaseOutputSchema = z.strictObject({
  caseId: z.string().min(1),
  changedLineCount: z.int().min(0),
  diffHunkCount: z.int().min(0),
  contextLedger: z.array(EvalContextLedgerEntrySchema).default([]),
  // Fix-lane outcomes captured when the eval case ran with `fix.enabled`.
  // Empty when the lane was disabled, ran on no eligible finding, or could not
  // resolve a provider — all non-fatal (spec 12).
  fixOutcomes: z.array(EvalFixOutcomeReportSchema).default([]),
  result: z.discriminatedUnion('status', [
    SuccessfulEvalOutputSchema,
    ProviderErrorSchema
  ])
})

export const EvalRegressionThresholdsSchema = z.strictObject({
  minParseValidity: z.number().min(0).max(1).optional(),
  minRecall: z.number().min(0).max(1).optional(),
  minPrecision: z.number().min(0).max(1).optional(),
  minSeverityWeightedF1: z.number().min(0).max(1).optional(),
  maxFalsePositiveCount: z.int().min(0).optional(),
  maxCommentsPerKloc: z.number().min(0).optional(),
  maxCommentsPerDiffHunk: z.number().min(0).optional(),
  maxIncompleteCoverageRate: z.number().min(0).max(1).optional(),
  maxContextMutationRate: z.number().min(0).max(1).optional(),
  maxCostUsd: z.number().min(0).optional(),
  maxDurationMs: z.int().min(0).optional(),
  minProductRecall: z.number().min(0).max(1).optional(),
  failOnProviderError: z.boolean().default(true)
})

export const EvalFindingMatchReportSchema = z.strictObject({
  expectedIndex: z.int().min(0),
  findingId: z.string().min(1),
  // Report-safe rationale from the semantic judge that accepted the match.
  // There is no numeric similarity score: identity of defect is a judgment.
  semanticReason: z.string().min(1).max(1000),
  lineOverlaps: z.boolean(),
  severityMatches: z.boolean(),
  // DIAGNOSTIC ONLY (spec 06 item 0.3): the finding's produced location,
  // recorded for EVERY matched pair regardless of match mode. This is
  // deliberately NOT the same signal as `lineOverlaps`, which stays gated to
  // `path-line` and feeds the strict `lineAccuracy` scoring metric. These two
  // fields let `linePlacementRate` measure line placement on `path-semantic`
  // matches too -- the entire primary corpus, which `lineAccuracy`
  // structurally cannot see -- without changing what a match IS or touching
  // the regression gate.
  producedPath: z.string().min(1),
  producedStartLine: z.int().min(1)
})

// An expected/finding pair the judge could not decide. It is excluded from the
// recall and precision denominators instead of being recorded as "no match".
export const EvalInconclusiveMatchReportSchema = z.strictObject({
  expectedIndex: z.int().min(0),
  findingId: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1).max(500).optional()
})

// The attributes of ONE produced finding, independent of how it was later
// classified. Every classification below is a list of IDs into
// `producedFindings`, so a finding that lands in two of them -- an unlisted-real
// finding is by construction also a false positive -- has its attributes stored
// once. The four per-classification copies this replaced could disagree with
// each other, and the matched half of every population carried no attributes at
// all, which made "what distinguishes the findings that matched from the ones
// that did not" unanswerable from a saved report.
export const EvalFindingSummaryReportSchema = z.strictObject({
  findingId: z.string().min(1),
  severity: z.string().min(1),
  category: z.string().min(1),
  path: z.string().min(1),
  line: z.int().min(1),
  title: z.string().min(1),
  // The finding's own description, stored so an ARCHIVED run can be
  // re-adjudicated. Every judge in this domain decides from the description; a
  // report that keeps only the title cannot be re-judged at all, so a question
  // asked of a finished run ("was this unmatched finding real?") can only be
  // answered by paying for the whole run again. That is not hypothetical: 53
  // archived artifact-only findings could not be labelled for exactly this
  // reason, which is what made this field necessary.
  //
  // This reverses an earlier decision to omit it as model prose. The prose is
  // already bounded and already redacted upstream -- it is the same text the
  // review report itself publishes -- so the cost is artifact size, and the
  // benefit is that a saved run stays answerable.
  //
  // Sized to the source's own cap rather than a smaller invented one: a tighter
  // bound here would truncate ordinary descriptions instead of guarding against
  // anything the producer can actually emit.
  description: z.string().min(1).max(FINDING_DESCRIPTION_MAX),
  // How well GROUNDED the finding is, as structure rather than prose. Severity
  // and category describe what a finding CLAIMS; these describe what it brought
  // to support the claim, which is the axis a "could not prove it" population
  // varies along. Each is a plain scalar the producer already holds -- none costs
  // a call, and none is free text that would need a judge to interpret.
  proposedBy: z.string().min(1),
  evidenceCount: z.int().min(0),
  hasFixProposal: z.boolean(),
  relatedLocationCount: z.int().min(0),
  dataFlowCount: z.int().min(0),
  cweCount: z.int().min(0),
  securitySeverity: z.number().min(0).max(10).optional()
})

export const EvalProviderIssueReportSchema = z.strictObject({
  code: z.string().min(1),
  stage: z.string().min(1).optional(),
  recovered: z.boolean(),
  message: z.string().min(1).max(500).optional()
})

export const EvalAgenticStageReportSchema = z.strictObject({
  stage: z.enum(['refutation', 'fix', 'provider-recovery']),
  status: z.enum(['active', 'skipped', 'recovered', 'error']),
  count: z.int().min(0)
})

// The eval domain owns the SHAPE of this mirror, but not the vocabulary: the
// verdict is the shared contract's closed enum, so a verdict added there lands in
// the eval report too instead of being silently unrepresentable here.
export const EvalRefutationResultReportSchema = z.strictObject({
  id: z.string().min(1),
  candidateId: z.string().min(1),
  verdict: RefutationVerdictSchema
})

export const EvalExpectedFindingReportSchema = z.strictObject({
  expectedIndex: z.int().min(0),
  category: z.string().min(1),
  severity: z.string().min(1),
  path: z.string().min(1).optional(),
  lineRange: z.tuple([z.int().min(1), z.int().min(1)]).optional(),
  // The corpus fixture's own vocabulary, on the same rule as the refutation
  // verdict and the diff scope above: the eval domain owns the SHAPE of this
  // record, not the vocabulary. `EvalMatchModeSchema` decides how an expectation
  // is matched, and a mode added there and not here would make every expectation
  // using it unrepresentable in the saved report — a run that scored fine and an
  // artifact that refuses to be written.
  matchMode: EvalMatchModeSchema,
  // Whether this expectation lies inside the reviewed diff (spec 17). Derived
  // by the eval domain from the case's own diff under the hunk-span rule and
  // STORED here so the split is auditable per expectation and cannot drift:
  // before this field it was re-derived by hand for every analysis, and two
  // people computing it two ways got two different headline numbers.
  //
  // `undetermined` is a value the PRODUCER writes when the case's diff cannot
  // settle the question. It is not a parse fallback: an artifact that omits the
  // field was not written by a compatible build and must fail to parse rather
  // than be read as undetermined.
  diffScope: DiffScopeSchema,
  semanticSummary: z.string().min(1)
})

export const EvalCaseReportSchema = z.strictObject({
  caseId: z.string().min(1),
  parseValid: z.boolean(),
  providerErrored: z.boolean(),
  providerIssues: z.array(EvalProviderIssueReportSchema).default([]),
  agenticStages: z.array(EvalAgenticStageReportSchema).default([]),
  // What discovery produced for this case, before refutation and admission
  // filtered it (spec 27). Reused from the review report verbatim rather than
  // mirrored: the provider-issue and refutation mirrors above exist because the
  // eval reshapes those, and there is nothing to reshape here — a copy would only
  // create two definitions that can drift. Absent when the review report carried
  // none, which is a provider-errored case.
  discovery: ReviewReportSchema.shape.discovery,
  contextLedger: z.array(EvalContextLedgerEntrySchema).default([]),
  // EVERY finding the review produced for this case -- actionable and
  // artifact-only alike -- recorded once, in one shape. The classification
  // fields below are ID lists into this array; resolve a finding's severity,
  // category, path or title from here regardless of which bucket it fell in.
  producedFindings: z.array(EvalFindingSummaryReportSchema).default([]),
  expectedFindings: z.array(EvalExpectedFindingReportSchema),
  matchedFindings: z.array(EvalFindingMatchReportSchema),
  unmatchedExpectedIndexes: z.array(z.int().min(0)),
  inconclusiveExpectedIndexes: z.array(z.int().min(0)).default([]),
  inconclusiveFindingIds: z.array(z.string().min(1)).default([]),
  inconclusiveMatches: z
    .array(EvalInconclusiveMatchReportSchema)
    .default([]),
  duplicateFindingIds: z.array(z.string().min(1)).default([]),
  falsePositiveFindingIds: z.array(z.string().min(1)),
  // Unmatched findings the plausibility judge deemed genuine but unlisted
  // defects; excluded from genuineFalsePositiveCount and adjustedPrecision's
  // denominator. A subset of falsePositiveFindingIds.
  unlistedRealFindingIds: z.array(z.string().min(1)).default([]),
  // Unmatched findings that count against adjustedPrecision: judged spurious or
  // fail-closed (unjudged). The complement of unlistedRealFindingIds within the
  // raw false-positive set.
  genuineFalsePositiveFindingIds: z.array(z.string().min(1)).default([]),
  noFindingZoneFalsePositiveIds: z.array(z.string().min(1)),
  artifactOnlyFindingIds: z.array(z.string().min(1)).default([]),
  artifactOnlyMatchedFindings: z.array(EvalFindingMatchReportSchema).default([]),
  artifactOnlyFalsePositiveFindingIds: z.array(z.string().min(1)).default([]),
  // The same plausibility split, run over the ARTIFACT-ONLY population and kept
  // in its own bucket. These two feed no precision metric, deliberately: the
  // artifact-only findings are excluded from `precision` and `adjustedPrecision`
  // by construction, and folding a real/noise label for them into either number
  // would silently promote a population nobody decided to promote. They exist so
  // the question "how much of the artifact-only output is real?" is answerable
  // from a saved report instead of only by re-running the corpus.
  artifactOnlyUnlistedRealFindingIds: z.array(z.string().min(1)).default([]),
  artifactOnlyGenuineFalsePositiveFindingIds: z
    .array(z.string().min(1))
    .default([]),
  refutationResults: z.array(EvalRefutationResultReportSchema).default([]),
  // Per-finding fix-lane outcomes for this case (spec 12), preserved so saved
  // reports are self-contained for fix-lane analysis.
  fixOutcomes: z.array(EvalFixOutcomeReportSchema).default([]),
  inlineFindingCount: z.int().min(0).default(0),
  warnings: z.array(z.string()),
  // ABSENT means NOT MEASURED, and is never the same claim as `0`. A
  // provider-errored case produced no review report at all, so neither its
  // review duration nor its model cost was ever surfaced; writing 0 for either
  // states a measurement that was not taken. `costUnavailable` stays the
  // machine-readable flag the aggregate counts, and is set from the same value
  // that decides whether `costUsd` is present, so the two cannot disagree.
  durationMs: z.int().min(0).optional(),
  // The same rule for token usage, which is surfaced by ONE usage record and is
  // therefore unknown as a unit: `summarizeRunCost` returns all three counts or
  // none, so there is one `usageUnavailable` flag rather than three. A
  // provider-errored case, and a provider run whose usage was never surfaced,
  // both leave these absent; a deterministic run with no provider configured
  // genuinely made no model call and records a real `0`.
  //
  // Token availability is NOT the same question as cost availability: a run that
  // surfaced usage but had no price for its model reports every token count and
  // no cost, and carries `cost-unavailable` for the cost alone.
  inputTokens: z.int().min(0).optional(),
  cachedInputTokens: z.int().min(0).optional(),
  outputTokens: z.int().min(0).optional(),
  usageUnavailable: z.boolean().default(false),
  costUnavailable: z.boolean().default(false),
  costUsd: z.number().min(0).optional()
})

// A GATE HAS THREE OUTCOMES, NOT TWO.
//
// `maxCostUsd` and `maxDurationMs` are compared against totals that sum only the
// cases whose cost/duration was actually measured (see `costUnavailableCount`).
// When some case's value is unknown, that total is a FLOOR, and a floor at or
// below the threshold does not establish that the run was under budget -- the
// true total could be on either side. Reporting that as `passed` is the same
// defect class as the confident zeros the totals were fixed to stop publishing,
// sitting inside the one place that is supposed to catch it.
//
// The gate therefore refuses instead of guessing, which is what this engine
// already does elsewhere for an input it will not judge partially (`intent
// check` exits 4 rather than judging part of an input; the change-impact scorer
// reports `not-measured` rather than a rate). Refusing rather than FAILING is
// deliberate: an unrecovered provider error is an infrastructure problem, and
// this project's standing rule is that it must not read as a quality verdict.
//
// A definite failure always wins over a refusal. Unknown spend can only add to a
// total, so a threshold a known-only floor ALREADY exceeds is failed outright,
// and any other failing threshold is reported as the failure it is rather than
// being masked by an unrelated unknown.
export const EvalRegressionGateOutcomeSchema = z.enum([
  'passed',
  'failed',
  'not-evaluable'
])

export const EvalRegressionGateSchema = z.strictObject({
  outcome: EvalRegressionGateOutcomeSchema,
  reasons: z.array(z.string()),
  // Thresholds the gate could not evaluate, each naming the metric, the
  // known-only total, the threshold, and how many cases are unmeasured. Kept
  // apart from `reasons` so "over budget" and "budget not evaluable" are
  // distinguishable by a machine and not only by reading prose.
  notEvaluableReasons: z.array(z.string()),
  thresholds: EvalRegressionThresholdsSchema,
  // Cases that caused a FAILURE. A refusal names no case here, for the same
  // reason `qualityGate.failOnProviderError` fails with an empty
  // `failingFindingIds`: there is nothing to blame, the problem is that a
  // measurement is missing. Which cases are unmeasured is already recorded per
  // case as `costUnavailable` / absent `durationMs`.
  failingCaseIds: z.array(z.string().min(1))
})

export const EvalReportSelectionSchema = z.strictObject({
  fixtureSource: z.enum(['default', 'slice-root']),
  sliceRoot: z.string().min(1).optional(),
  caseFilters: z.array(z.string().min(1)),
  selectedCaseIds: z.array(z.string().min(1))
})

// Scoring metadata proves how reliable the run's sole semantic authority was.
// `judgeAgreement` is omitted when no calibration pair was scored (an offline
// run with no expected findings needs no judge).
export const EvalReportScoringSchema = z.strictObject({
  judgeAgreement: z.number().min(0).max(1).optional(),
  judgeTrustworthy: z.boolean(),
  // Plausibility-judge reliability. `plausibilityJudgeAgreement` is omitted when
  // no plausibility calibration pair was scored (an offline run needs no judge).
  // `adjustedPrecisionTrustworthy` is `false` when the plausibility agreement is
  // below the configured minimum, marking `adjustedPrecision` untrustworthy.
  plausibilityJudgeAgreement: z.number().min(0).max(1).optional(),
  adjustedPrecisionTrustworthy: z.boolean().default(true),
  // Whether a plausibility judge ran at all. This is what makes the reported
  // precision BRACKET honest. With no plausibility judge the stage is a no-op
  // and `adjustedPrecision` is set equal to raw `precision` -- so publishing it
  // as the upper bound would assert that every unmatched finding was examined
  // and found spurious, when in fact none was examined. The upper bound is then
  // not measured, which is a different statement from "equal to the lower
  // bound".
  //
  // Deliberately optional rather than defaulted: a report written before this
  // field existed genuinely does not record whether a judge ran, and defaulting
  // it either way would fabricate that answer. Absent means unknown.
  plausibilityJudged: z.boolean().optional()
})

// The optional-capability toggles a run was configured with, named rather than
// hashed.
//
// KEYS ARE THE CONFIGURATION PATH OF THE TOGGLE, verbatim and including the
// trailing `.enabled`, so a reader maps a key back to the setting without a
// translation table and no capability can be recorded under two spellings.
//
// It is an EXPLICIT strict object and not a `Record<string, boolean>`. A
// free-form record cannot say what the absence of a key means -- an off
// capability and a capability the producer forgot to record would both be
// missing -- and it would let a typo become a new capability. With a closed set,
// every key is present on every report this build writes, so `false` means off
// and a missing block means the whole field was never recorded.
//
// It is the COMPLETE set of `enabled` toggles in the configuration schema, not a
// curated subset of the ones judged relevant to a measurement. A curated list
// asks for that judgement to be re-made correctly on every new toggle, and "this
// flag cannot affect the numbers" is exactly the kind of judgement this
// repository has already got wrong (reviewer instructions were ledgered, hashed,
// and then dropped before the discovery call, with nothing reporting it).
// `eval-capability-flags.test.ts` derives the toggle set from the configuration
// schema itself and fails when it does not match this list exactly.
export const EvalReportCapabilityFlagsSchema = z.strictObject({
  'review.crossFileRetrieval.enabled': z.boolean(),
  'review.signalFacts.enabled': z.boolean(),
  'review.citations.enabled': z.boolean(),
  'skills.enabled': z.boolean(),
  'baseline.enabled': z.boolean(),
  'aiReview.enabled': z.boolean(),
  'contextSources.enabled': z.boolean(),
  'verification.enabled': z.boolean(),
  'changeImpact.enabled': z.boolean(),
  'changeImpact.adjudication.enabled': z.boolean(),
  'intentFulfilment.enabled': z.boolean(),
  'fix.enabled': z.boolean(),
  'security.dedicatedPass.enabled': z.boolean(),
  'security.signals.enabled': z.boolean(),
  'reporting.reviewComments.enabled': z.boolean(),
  'drift.enabled': z.boolean(),
  'observability.openTelemetry.enabled': z.boolean(),
  'reviewConversation.enabled': z.boolean()
})

// Provenance proves WHAT was scored and under WHAT configuration, which
// `metricsVersion` alone does not: `metricsVersion` says how a metric is
// computed from review output, but nothing before this recorded which answer
// key produced the review output in the first place. An archived run in this
// repository once reported 78.8% recall after its answer key had since
// changed underneath it, and nothing in the artifact revealed that -- the
// same class of failure `metricsVersion` mismatches already guard against, one
// layer up the stack.
export const EvalReportProvenanceSchema = z.strictObject({
  // sha256 digest over the expected-finding content of every selected case
  // (see `computeAnswerKeyDigest` for the exact scope and why it stops at
  // expected-finding content). Two reports with the same digest scored an
  // IDENTICAL answer key; comparison and the significance module refuse to
  // diff across a mismatch here, exactly like a `metricsVersion` mismatch.
  answerKeyDigest: z.string().min(1),
  // Per case, so a comparison can tell a deliberately different case selection
  // (legitimate, and already warned about) from the shared cases having been
  // scored against different expectations (the stale-answer-key incident).
  // Empty is a value the producer writes for a selection with no cases, never a
  // stand-in for a report that omitted the field.
  answerKeyDigestByCase: z.record(z.string(), z.string()),
  // sha256 digest over the effective (file + environment + CLI-override
  // merged) configuration the run used. Comparison does NOT refuse across a
  // config-hash mismatch the way it does for `answerKeyDigest`: a maintainer
  // legitimately compares two runs under DIFFERENT configurations to measure
  // the effect of changing one, so refusing here would block the very
  // comparisons this project exists to make. The hash exists so an archived
  // run can be read back and its configuration identity checked, not to gate
  // diffing.
  configHash: z.string().min(1),
  // Provider/model identity, present only when a provider was configured for
  // the run (an offline run scoring only cases with no expected findings needs
  // neither). `modelName` is the REVIEWER's model -- the subject of the
  // measurement.
  providerId: z.string().min(1).optional(),
  modelName: z.string().min(1).optional(),
  // The model the two judges (semantic match + plausibility) actually scored
  // with. Equal to `modelName` unless `evaluation.judgeModel` pinned it, and
  // recorded either way: a report that cannot name its own judge leaves every
  // number in it ambiguous between a reviewer difference and a scorer
  // difference, which is exactly the failure the pinning exists to remove.
  // Optional for the same reason as the two above: an offline run has no judge.
  // Not for an archived report — this is the producer contract, which no archive
  // is ever read through.
  judgeModelName: z.string().min(1).optional(),
  // Which optional capabilities the run actually had ENABLED.
  //
  // `configHash` above cannot answer that, and its own comment claims it exists
  // "so an archived run can be read back and its configuration identity
  // checked". A digest supports exactly one question -- did two runs share a
  // configuration -- because no value can be read back out of it. So no archived
  // report could say whether the fix lane was on, which is the first thing a
  // reader asks of a fix-lane figure, and the hash still cannot: it is kept for
  // identity, and this is kept for content.
  //
  // OPTIONAL, AND ABSENT MEANS "NOT RECORDED" -- NEVER "NOTHING WAS ENABLED".
  // The producer's own input types it optional and omits the key when a caller
  // does not supply it, so absence is reachable in a report written today; it is
  // not a statement about older builds. Defaulting it to an all-`false` set would
  // fabricate an answer about a run nobody can re-interrogate. Same rule, and
  // the same reason, as `scoring.plausibilityJudged`.
  capabilities: EvalReportCapabilityFlagsSchema.optional()
})

export const EvalMetricGroupSchema = z.strictObject({
  groupBy: z.enum(['sourceProfile', 'language', 'tag']),
  key: z.string().min(1),
  fixtureCount: z.int().min(0),
  caseIds: z.array(z.string().min(1)),
  metrics: EvalMetricsSchema
})

// How the numbers in a report were COMPUTED, as opposed to `schemaVersion`,
// which describes the shape they are written in. Bump it whenever a change
// alters what a metric would report for identical review output, INCLUDING a
// metric that is merely added whose value cannot be recovered for a report saved
// earlier.
//
// The version id, the ordered history behind it, and -- critically -- what each
// bump actually changed all live in `eval-metrics-versions.ts`. A bump is not a
// string edit: it is a new history entry declaring its blast radius, because
// comparison derives per-metric comparability from that declaration rather than
// refusing every metric at once.
export { EVAL_METRICS_VERSION } from './versions/eval-metrics-versions.js'

export const EvalReportSchema = z.strictObject({
  // '1.0', and it stays there while the product is unreleased. This literal was
  // briefly bumped to '2.0' on the theory that a version which does not move when
  // the payload does asserts a compatibility that does not hold — but the incident
  // behind that theory refutes it. When the case result's four per-classification
  // finding arrays became one `producedFindings`, about a hundred engine-pinned
  // archives stopped opening, and they were rejected ON UNKNOWN KEYS: the strict
  // shape below did the catching, while the version literal still matched and
  // caught nothing. Bumping it afterwards reopened no archive.
  //
  // Nothing in this repository dispatches on the value — no migration, no branch,
  // no reader that behaves differently per version — so it is documentation, and
  // it documents one schema generation. `metricsVersion` is the opposite case and
  // is genuinely versioned: an ordered history with a declared `affects` set per
  // entry, where the value changes what the code does. See spec 06.
  schemaVersion: z.literal('1.0'),
  // This is the PRODUCER contract, and it carries no tolerance for an artifact an
  // older build wrote: a report that does not satisfy it was not written by a
  // compatible build and cannot be rendered field-for-field. Reading across
  // versions is `eval-comparison-view.ts`, deliberately and in one place — a
  // sentinel default here would put that job in the layer that disclaims it, and
  // would turn a missing field into a plausible measured-looking value.
  metricsVersion: z.string().min(1),
  generatedAt: z.iso.datetime(),
  fixtureCount: z.int().min(0),
  selection: EvalReportSelectionSchema,
  // Required for the same reason as `metricsVersion`: the producer always writes
  // provenance, so an artifact without it is not one this build produced.
  provenance: EvalReportProvenanceSchema,
  // Required: the producer always writes scoring. Defaulting it would let a
  // report carrying no scoring data silently claim `judgeTrustworthy: true`.
  scoring: EvalReportScoringSchema,
  caseResults: z.array(EvalCaseReportSchema),
  metrics: EvalMetricsSchema,
  metricGroups: z.array(EvalMetricGroupSchema),
  regressionGate: EvalRegressionGateSchema
})

export type EvalContextLedgerEntry = z.infer<typeof EvalContextLedgerEntrySchema>
export type EvalCaseOutput = z.infer<typeof EvalCaseOutputSchema>
export type EvalRegressionThresholds = z.infer<
  typeof EvalRegressionThresholdsSchema
>
export type EvalRegressionGateOutcome = z.infer<
  typeof EvalRegressionGateOutcomeSchema
>
export type EvalReportSelection = z.infer<typeof EvalReportSelectionSchema>
export type EvalReportScoring = z.infer<typeof EvalReportScoringSchema>
export type EvalReportCapabilityFlags = z.infer<
  typeof EvalReportCapabilityFlagsSchema
>
export type EvalReportProvenance = z.infer<typeof EvalReportProvenanceSchema>
export type EvalReport = z.infer<typeof EvalReportSchema>
