import { z } from 'zod'

// READING A REPORT THE CURRENT CONTRACT DID NOT WRITE.
//
// `EvalReportSchema` is the PRODUCER contract: strict, exhaustive, and correct
// for the report this build writes. It is the wrong contract for reading an
// archived report, and the difference is not academic -- `eval compare` exists
// to compare runs across engine changes, and an engine change is exactly what
// adds a field to the report. Comparing the 2026-08-02 baseline against the
// 2026-08-05 re-baseline died on
// `caseResults.0.discovery.totals.cappedByLimitCount: expected number, received
// undefined` and 69 more, and the comparison had to be done by hand.
//
// Loosening the producer contract would have been the wrong fix. A missing
// counter defaulted to 0 reports "no discovery calls" where the truth is "not
// recorded" -- this codebase's documented recurring defect class, where absence
// produces a plausible optimistic answer instead of an error.
//
// So comparison reads through this view instead:
//
//   - every leaf is OPTIONAL and carries NO DEFAULT, so absence survives parsing
//     as `undefined` and can never be mistaken for a measured zero;
//   - every object STRIPS unknown keys, so a field a future build adds is
//     ignored rather than fatal;
//   - only what comparison actually renders is modelled. This is a read model,
//     not a second copy of the report contract, and a metric that becomes worth
//     comparing is added here deliberately.
//
// Every renderer downstream takes `number | undefined` and prints "unknown" for
// the absent case. There is no path by which an unrecorded value becomes a
// number in the output.

const optionalNumber = z.number().optional()
const optionalInteger = z.int().optional()
const optionalNullableNumber = z.number().nullable().optional()

const ComparisonScopeCountsSchema = z
  .record(
    z.string(),
    z.object({
      expected: optionalInteger,
      matched: optionalInteger
    })
  )
  .optional()

// Exported so the producer's metric list can be checked against it: a metric
// added to `EvalMetricsSchema` and forgotten here would render as "unknown"
// forever, and nothing else in the system would say so.
export const ComparisonMetricsSchema = z.object({
  recall: optionalNumber,
  precision: optionalNumber,
  adjustedPrecision: optionalNumber,
  f1: optionalNumber,
  severityWeightedF1: optionalNumber,
  falsePositiveCount: optionalInteger,
  genuineFalsePositiveCount: optionalInteger,
  unlistedRealFindingCount: optionalInteger,
  plausibilityJudgeAgreement: optionalNumber,
  securityObviousRecall: optionalNumber,
  securityHardRecall: optionalNumber,
  providerErrorRate: optionalNumber,
  providerIssueRate: optionalNumber,
  providerIssueCount: optionalInteger,
  refutationFalseNegativeCount: optionalInteger,
  refutationFalsePositiveCount: optionalInteger,
  // Nullable AND optional, for the same reason `recallByDiffScope` below is:
  // `null` is a rate the run scored over an empty denominator (the fix lane
  // produced nothing to measure, which is every run with `fix.enabled` off),
  // `undefined` is a rate the report never recorded. A report archived while
  // these were floored to 0 records a number, and it is the WRONG number -- the
  // scoring-rule history is what refuses that delta, not this view.
  fixJudgmentAccuracy: optionalNullableNumber,
  fixFalsePositiveDetectionRate: optionalNullableNumber,
  fixProduceRate: optionalNullableNumber,
  fixApplyFailureRate: optionalNullableNumber,
  durationMs: optionalInteger,
  durationUnavailableCount: optionalInteger,
  usageUnavailableCount: optionalInteger,
  inputTokens: optionalInteger,
  cachedInputTokens: optionalInteger,
  outputTokens: optionalInteger,
  costUsd: optionalNumber,
  costUnavailableCount: optionalInteger,
  // Nullable AND optional, and the two mean different things: `null` is a rate
  // over an empty denominator (measured nothing), `undefined` is a rate the
  // report never recorded.
  recallByDiffScope: z.record(z.string(), optionalNullableNumber).optional(),
  diffScopeCounts: ComparisonScopeCountsSchema
})

export type EvalComparisonMetrics = z.infer<typeof ComparisonMetricsSchema>

const ComparisonExpectationSchema = z.object({
  expectedIndex: optionalInteger,
  // Read as a free string, not as the `DiffScope` enum. Recall is adjudicated
  // per diff-scope population, and a label a later build introduces must
  // partition into its own population rather than fail the whole report's parse
  // -- the same tolerance every other leaf here has. Absent (a report written
  // before the field existed) stays absent: "scope not recorded" is its own
  // population and is never folded into in-diff or out-of-diff.
  diffScope: z.string().min(1).optional()
})

const ComparisonCaseSchema = z.object({
  caseId: z.string().min(1),
  parseValid: z.boolean().optional(),
  providerErrored: z.boolean().optional(),
  unmatchedExpectedIndexes: z.array(z.unknown()).optional(),
  falsePositiveFindingIds: z.array(z.unknown()).optional(),
  noFindingZoneFalsePositiveIds: z.array(z.unknown()).optional(),
  expectedFindings: z.array(ComparisonExpectationSchema).optional(),
  matchedFindings: z.array(ComparisonExpectationSchema).optional(),
  contextLedger: z
    .array(z.object({ kind: z.string().min(1) }))
    .optional(),
  agenticStages: z
    .array(
      z.object({
        stage: z.string().min(1),
        count: optionalInteger
      })
    )
    .optional()
})

export type EvalComparisonCase = z.infer<typeof ComparisonCaseSchema>

const ComparisonMetricGroupSchema = z.object({
  groupBy: z.string().min(1),
  key: z.string().min(1),
  fixtureCount: optionalInteger,
  metrics: ComparisonMetricsSchema
})

export type EvalComparisonMetricGroup = z.infer<
  typeof ComparisonMetricGroupSchema
>

export const EvalComparisonReportSchema = z.object({
  // The one field that is defaulted, and only to the recorded sentinel for the
  // era before scoring rules were versioned. That sentinel is itself a declared
  // history entry meaning "nothing is known about these rules", so it refuses
  // every metric rather than asserting comparability.
  metricsVersion: z.string().min(1).default('pre-2026-07-26'),
  generatedAt: z.string().min(1).optional(),
  fixtureCount: optionalInteger,
  selection: z
    .object({
      fixtureSource: z.string().min(1).optional(),
      sliceRoot: z.string().min(1).optional(),
      caseFilters: z.array(z.string()).optional(),
      selectedCaseIds: z.array(z.string()).optional()
    })
    .optional(),
  provenance: z
    .object({
      answerKeyDigest: z.string().min(1).optional(),
      answerKeyDigestByCase: z.record(z.string(), z.string()).optional(),
      // The reviewer's model, and the model the JUDGES ran on. Read here so a
      // comparison can refuse arms scored by different judges: a difference
      // between two arms whose scorer also moved has two explanations and no way
      // to tell them apart. `judgeModelName` is absent on every report written
      // before the judge became pinnable, and on those the judge WAS the
      // reviewer's model -- so `modelName` is the correct fallback identity, not
      // an unknown.
      modelName: z.string().min(1).optional(),
      judgeModelName: z.string().min(1).optional(),
      // The run's optional-capability flags. Read as a free-form
      // `Record<string, boolean>` and NOT as the producer's closed key set, for
      // the same reason `diffScope` above is read as a free string: a capability
      // a later build adds must show up in the difference report rather than
      // fail the whole report's parse. Absent means the report never recorded
      // its capabilities, which is a different statement from "none were
      // enabled" and is reported as such.
      capabilities: z.record(z.string(), z.boolean()).optional()
    })
    .optional(),
  scoring: z
    .object({
      judgeAgreement: optionalNumber,
      judgeTrustworthy: z.boolean().optional(),
      plausibilityJudgeAgreement: optionalNumber,
      adjustedPrecisionTrustworthy: z.boolean().optional(),
      plausibilityJudged: z.boolean().optional()
    })
    .optional(),
  // Both spellings of the gate verdict, because this is the READ model over
  // archived reports (see the module header): every report written before the
  // gate gained a third outcome recorded a boolean `passed`, and that is a
  // verdict the run genuinely reached, not an absent value to be defaulted.
  // Reading it is the tolerance this view exists for; the PRODUCER contract
  // carries `outcome` alone.
  regressionGate: z
    .object({
      outcome: z.enum(['passed', 'failed', 'not-evaluable']).optional(),
      passed: z.boolean().optional()
    })
    .optional(),
  caseResults: z.array(ComparisonCaseSchema).optional(),
  metrics: ComparisonMetricsSchema.optional(),
  metricGroups: z.array(ComparisonMetricGroupSchema).optional()
})

export type EvalComparisonReport = z.infer<typeof EvalComparisonReportSchema>

export const parseEvalComparisonReport = (
  value: unknown
): EvalComparisonReport => EvalComparisonReportSchema.parse(value)

// One scored run inside an arm, carrying the label the reader identifies it by
// (its report path). An arm is a SET of these: this project's own decision rule
// requires several runs per arm, and adjudicating one report against one report
// discards most of the evidence that was paid for.
export type EvalComparisonRun = {
  readonly label: string
  readonly report: EvalComparisonReport
}
