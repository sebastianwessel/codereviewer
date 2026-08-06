// The change-impact evaluation report: contract, artefact names, and the builder.
//
// DELIBERATELY NOT THE EVAL REPORT. Spec 22 forbids pooling this corpus with spec
// 17's — "different question, different orientation, different answer key" — and a
// shared report shape is one of the ways two corpora get pooled by accident. So:
//
// - `reportKind` is a literal. An `eval-report.json` cannot parse as this report
//   and this report cannot parse as an `eval-report.json`, so a mis-pointed path
//   is a parse error rather than a silently wrong table.
// - the artefact names and the artefact directory are distinct from the eval
//   run's, and the command that writes them takes `--case-root`, never
//   `--slice-root`. A `--slice-root` typo cannot reach this scorer at all: the
//   option is unknown to it.
// - the metrics version comes from the change-impact history, which is a separate
//   ordered history from the diff reviewer's.

import { z } from 'zod'
import { LaneUsageSchema } from '../costs/index.js'
import { AdjudicationStatusSchema } from '../change-impact/index.js'
import { CHANGE_IMPACT_METRICS_VERSION } from './change-impact-metrics-versions.js'
import { ImpactReachabilitySchema } from './change-impact-corpus.schema.js'
import { CorpusSplitSchema } from './real-repo-corpus.schema.js'
import { type ChangeImpactScore } from './change-impact-scoring.js'

export const CHANGE_IMPACT_EVAL_REPORT_ARTIFACT_NAME =
  'change-impact-eval-report.json'
export const CHANGE_IMPACT_EVAL_SUMMARY_ARTIFACT_NAME =
  'change-impact-eval-summary.md'
// Its own root, not a sibling of `.codereviewer/eval/eval-report.json`.
export const CHANGE_IMPACT_EVAL_ARTIFACT_ROOT =
  '.codereviewer/eval/change-impact'

const RateSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('measured'),
    matched: z.int().min(0),
    total: z.int().min(1),
    rate: z.number().min(0).max(1)
  }),
  z.strictObject({
    status: z.literal('not-measured'),
    reason: z.string().min(1)
  })
])

const RecallSchema = z.strictObject({
  measured: RateSchema,
  unmeasuredExpectedCount: z.int().min(0)
})

const PrecisionBoundSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('known'), value: z.number().min(0).max(1) }),
  z.strictObject({ status: z.literal('not-measured') }),
  z.strictObject({ status: z.literal('unknown') })
])

// The two bounds are one field so neither can travel alone. On this corpus the
// upper bound is ALWAYS `not-measured`: eleven dependents across ten changes is
// not an enumeration of everything each change broke, so an unmatched prediction
// cannot be shown to be a false positive.
const PrecisionBracketSchema = z.strictObject({
  lower: PrecisionBoundSchema,
  upper: PrecisionBoundSchema,
  upperTrustworthy: z.boolean()
})

// Every dimension is spelled out rather than generated from the key arrays, so
// the report's shape is readable at a glance and a strict object refuses a class
// nobody declared. `change-impact-eval-report.test.ts` pins these key sets
// against the exported vocabularies, which is what stops the two from drifting.
const RecallByReachabilitySchema = z.strictObject({
  'caller-of-changed-symbol': RecallSchema,
  'callee-of-changed-code': RecallSchema,
  'attribute-owner': RecallSchema,
  'whole-repo-search': RecallSchema
})

const RecallBySplitSchema = z.strictObject({
  dev: RecallSchema,
  'held-out': RecallSchema
})

const UnmeasuredByReasonSchema = z.strictObject({
  'not-hydrated': z.int().min(0),
  'stale-checkout': z.int().min(0),
  'engine-error': z.int().min(0),
  'capability-disabled': z.int().min(0)
})

const ArmMetricsSchema = z.strictObject({
  arm: z.enum(['reference', 'adjudicated']),
  byReachability: RecallByReachabilitySchema,
  directlyReachable: RecallSchema,
  wholeRepoSearch: RecallSchema,
  bySplit: RecallBySplitSchema,
  precision: PrecisionBracketSchema,
  predictedFileCount: z.int().min(0),
  matchedPredictedFileCount: z.int().min(0)
})

const AdjudicationDeltaSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('not-measured'),
    reason: z.string().min(1)
  }),
  z.strictObject({
    status: z.literal('measured'),
    caseCount: z.int().min(1),
    referenceFileCount: z.int().min(0),
    adjudicatedFileCount: z.int().min(0),
    removedFileCount: z.int().min(0),
    // Removals the corpus PROVES were wrong.
    removedProvenDependentCount: z.int().min(0),
    // Removals whose correctness this corpus cannot settle. Never credited as
    // correct: the answer key lists the dependents upstream had to repair, not
    // every file that was fine to drop.
    removedUnknownCorrectnessCount: z.int().min(0),
    retainedProvenDependentCount: z.int().min(0),
    // Must be zero: the impact admission gate refuses a finding naming a
    // dependent the run never located. Reported so a gate that stopped working is
    // visible rather than silent.
    addedNotInReferenceListCount: z.int().min(0)
  })
])

const UnmeasuredReasonSchema = z.enum([
  'not-hydrated',
  'stale-checkout',
  'engine-error',
  'capability-disabled'
])

const CaseResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    caseId: z.string().min(1),
    split: CorpusSplitSchema,
    status: z.literal('scored'),
    adjudicationStatus: AdjudicationStatusSchema,
    adjudicationMeasured: z.boolean(),
    // Every pair was settled. Only then does an unreported dependent mean a miss
    // rather than a pair nobody checked.
    adjudicationExhaustive: z.boolean(),
    unadjudicatedPairCount: z.int().min(0),
    adjudicationCallsTruncated: z.boolean(),
    referenceFileCount: z.int().min(0),
    adjudicatedFileCount: z.int().min(0).optional(),
    expectations: z.array(
      z.strictObject({
        caseId: z.string().min(1),
        path: z.string().min(1),
        reachability: ImpactReachabilitySchema,
        directlyReachable: z.boolean(),
        split: CorpusSplitSchema,
        inReferenceList: z.boolean(),
        // Absent, never `false`, when the adjudicated arm did not answer.
        inAdjudicatedList: z.boolean().optional()
      })
    ),
    removedFiles: z.array(z.string().min(1)),
    removedProvenDependents: z.array(z.string().min(1)),
    addedFiles: z.array(z.string().min(1))
  }),
  z.strictObject({
    caseId: z.string().min(1),
    split: CorpusSplitSchema,
    status: z.literal('unmeasured'),
    reason: UnmeasuredReasonSchema,
    detail: z.string().min(1),
    expectedImpactCount: z.int().min(0)
  })
])

export const ChangeImpactEvalReportSchema = z.strictObject({
  // The anti-pooling literal. Nothing else in this repository writes it.
  reportKind: z.literal('change-impact-dependents'),
  schemaVersion: z.literal('1.0'),
  // The SCORING rules, from the change-impact history — never the diff reviewer's.
  metricsVersion: z.string().min(1),
  generatedAt: z.iso.datetime(),
  datasetId: z.string().min(1),
  selection: z.strictObject({
    manifestPath: z.string().min(1),
    caseRoot: z.string().min(1),
    caseFilters: z.array(z.string().min(1)),
    selectedCaseIds: z.array(z.string().min(1))
  }),
  // WHICH ENGINE PRODUCED THE PREDICTIONS. A rate is a property of an engine and a
  // model, not of a corpus, and this repository has already had to void figures
  // that could not name either. `unknown` is a legitimate value and is rendered as
  // such; it is never omitted.
  engine: z.strictObject({
    commit: z.string().min(1),
    workingTreeClean: z.boolean().optional(),
    // What the run ASKED for, as opposed to `adjudicationStatus`, which is what
    // each case got.
    adjudicationRequested: z.boolean()
  }),
  provenance: z.strictObject({
    // Digest over the answer-key content of every selected case, so a future
    // reader can tell a re-run from a run scored against a changed key.
    answerKeyDigest: z.string().min(1),
    answerKeyDigestByCase: z.record(z.string(), z.string()),
    configHash: z.string().min(1),
    providerId: z.string().min(1).optional(),
    modelName: z.string().min(1).optional()
  }),
  coverage: z.strictObject({
    totalCaseCount: z.int().min(0),
    scoredCaseCount: z.int().min(0),
    unmeasuredCaseCount: z.int().min(0),
    unmeasuredByReason: UnmeasuredByReasonSchema,
    adjudicationMeasuredCaseCount: z.int().min(0),
    adjudicationExhaustiveCaseCount: z.int().min(0),
    unadjudicatedPairCount: z.int().min(0),
    adjudicationCallsTruncatedCaseCount: z.int().min(0),
    totalExpectedCount: z.int().min(0),
    scoredExpectedCount: z.int().min(0)
  }),
  arms: z.strictObject({
    reference: ArmMetricsSchema,
    adjudicated: ArmMetricsSchema
  }),
  adjudicatedRecallWithinReferenceList: RecallSchema,
  adjudicationDelta: AdjudicationDeltaSchema,
  caseResults: z.array(CaseResultSchema),
  usage: LaneUsageSchema.optional(),
  warnings: z.array(z.string())
})

export type ChangeImpactEvalReport = z.infer<
  typeof ChangeImpactEvalReportSchema
>

export type BuildChangeImpactEvalReportInput = {
  readonly score: ChangeImpactScore
  readonly generatedAt: Date
  readonly datasetId: string
  readonly selection: ChangeImpactEvalReport['selection']
  readonly engine: ChangeImpactEvalReport['engine']
  readonly provenance: ChangeImpactEvalReport['provenance']
  readonly usage?: ChangeImpactEvalReport['usage']
  readonly warnings: readonly string[]
}

export const buildChangeImpactEvalReport = (
  input: BuildChangeImpactEvalReportInput
): ChangeImpactEvalReport =>
  ChangeImpactEvalReportSchema.parse({
    reportKind: 'change-impact-dependents',
    schemaVersion: '1.0',
    metricsVersion: CHANGE_IMPACT_METRICS_VERSION,
    generatedAt: input.generatedAt.toISOString(),
    datasetId: input.datasetId,
    selection: input.selection,
    engine: input.engine,
    provenance: input.provenance,
    coverage: input.score.coverage,
    arms: {
      reference: input.score.reference,
      adjudicated: input.score.adjudicated
    },
    adjudicatedRecallWithinReferenceList:
      input.score.adjudicatedRecallWithinReferenceList,
    adjudicationDelta: input.score.adjudicationDelta,
    caseResults: input.score.caseScores,
    ...(input.usage === undefined ? {} : { usage: input.usage }),
    warnings: [...input.warnings]
  })

export const parseChangeImpactEvalReport = (
  value: unknown
): ChangeImpactEvalReport => ChangeImpactEvalReportSchema.parse(value)
