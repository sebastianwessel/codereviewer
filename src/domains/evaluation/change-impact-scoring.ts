// Scoring for the change-impact corpus (spec 22 §Evaluation).
//
// THE UNIT IS THE DESTINATION FILE. Not a preference: spec 22's prior-art section
// records that scoring the identical predictions at file granularity rather than
// method granularity moved precision 28.2% -> 60.9% and F1 25.0 -> 54.6, and the
// pre-registered decision rule states the unit outright — "A predicted file counts
// as correct when the corpus's proven-broken dependent is that file."
//
// THREE ARMS, AND THE COMPARISON BETWEEN THEM IS THE POINT.
//
//   1. `reference`   — every destination file dependent discovery enumerates.
//                      This is the baseline the capability must beat: spec 22's
//                      removal criterion is stated against it ("Remove if it
//                      cannot beat naming the changed symbols and letting the
//                      human grep"). Without this arm the measurement cannot
//                      answer the only question that decides the capability's
//                      fate.
//   2. `adjudicated` — the files adjudication actually reports.
//   3. the DIFFERENCE — what adjudication removed, and whether what it removed
//                      was correct. Correctness is knowable in exactly one
//                      direction here; see `ChangeImpactAdjudicationDelta`.
//
// NOTHING IS POOLED. Recall is reported per reachability class and per
// contamination split, because spec 22 requires both: "a capability that finds
// direct callers and misses indirect ones is useful and should not be scored as
// if those were the same problem", and "Eight of ten cases are old enough that the
// model has very likely seen both the change and its upstream fix". There is
// deliberately no single blended recall figure for anyone to quote.
//
// PRECISION IS A LOWER BOUND AND NOTHING ELSE. Eleven dependents across ten
// changes is not an enumeration of everything each change broke, so a predicted
// file absent from the answer key is NOT thereby wrong. It is expressed as a
// bracket whose upper bound is `not-measured`, reusing the same type the diff
// reviewer's scorer publishes, so a single bound can never travel alone.
//
// ABSENCE IS NEVER ZERO. A case that failed to hydrate, a checkout that no longer
// matches the manifest, a run that produced no report, an arm no run answered, and
// a dimension with no expectations all render as not-measured. A 0.0% recall cell
// in this report means the engine looked and missed, and only that.

import { precisionBracket, type PrecisionBracket } from './eval-precision-bracket.js'
import { normalizeRepositoryRelativePath } from '../../platform/repository-path.js'
import type { CorpusSplit } from './real-repo-corpus.schema.js'
import {
  isDirectlyReachable,
  type ChangeImpactCorpusCase,
  type ExpectedImpact,
  type ImpactReachability
} from './change-impact-corpus.schema.js'
import type {
  AdjudicationStatus,
  ChangeImpactReferenceReport,
  ModelVerdictCounts
} from '../change-impact/index.js'

export const changeImpactArms = ['reference', 'adjudicated'] as const

export type ChangeImpactArm = (typeof changeImpactArms)[number]

export const impactReachabilityClasses: readonly ImpactReachability[] = [
  'caller-of-changed-symbol',
  'callee-of-changed-code',
  'attribute-owner',
  'whole-repo-search'
]

export const corpusSplits: readonly CorpusSplit[] = ['dev', 'held-out']

// Why a case produced no answer. Each is a different fact about the run, and none
// of them is a score.
export const changeImpactUnmeasuredReasons = [
  // No hydrated case artefact under the case root.
  'not-hydrated',
  // The hydrated case no longer matches the manifest it was built from. Spec 17
  // records what happens without this check: a baseline scored against an answer
  // key that had since changed underneath it, which had to be voided.
  'stale-checkout',
  // The engine threw, or intake could not read the checkout.
  'engine-error',
  // The engine reported `status: "disabled"`, so it analysed nothing.
  'capability-disabled'
] as const

export type ChangeImpactUnmeasuredReason =
  (typeof changeImpactUnmeasuredReasons)[number]

export type ChangeImpactCaseOutcome =
  | { readonly status: 'scored'; readonly report: ChangeImpactReferenceReport }
  | {
      readonly status: 'unmeasured'
      readonly reason: ChangeImpactUnmeasuredReason
      readonly detail: string
    }

export type ChangeImpactCaseInput = {
  readonly corpusCase: ChangeImpactCorpusCase
  readonly outcome: ChangeImpactCaseOutcome
}

// One expected dependent, and what each arm said about it.
export type ScoredExpectation = {
  readonly caseId: string
  readonly path: string
  readonly reachability: ImpactReachability
  readonly directlyReachable: boolean
  readonly split: CorpusSplit
  readonly inReferenceList: boolean
  // `undefined` when the adjudicated arm produced no answer about THIS dependent:
  // adjudication was disabled, no model was available, or the run left pairs
  // unadjudicated so an absence cannot be told from a decision. NOT `false`: "we
  // did not check" and "we checked and it is not there" are different facts, and
  // only one of them is a miss. A HIT is never ambiguous, so a reported dependent
  // counts even in a partially adjudicated run.
  readonly inAdjudicatedList: boolean | undefined
}

export type ChangeImpactCaseScore =
  | {
      readonly caseId: string
      readonly split: CorpusSplit
      readonly status: 'scored'
      readonly adjudicationStatus: AdjudicationStatus
      // Adjudication produced predictions for this case: both tiers ran.
      readonly adjudicationMeasured: boolean
      // Adjudication settled EVERY pair. Only then is a dependent's absence from
      // the finding list a MISS rather than a pair nobody checked — the call cap,
      // a failed call and an undecided answer all leave a dependent unreported
      // without anything having decided it is unaffected, and spec 22 names that
      // explicitly: "Absence from impactFindings is not a statement that a
      // dependent is unaffected."
      readonly adjudicationExhaustive: boolean
      readonly unadjudicatedPairCount: number
      readonly adjudicationCallsTruncated: boolean
      // MODEL CALLS THIS CASE SPENT. Zero is the value that changes what every
      // other adjudication figure on this case means: no removal it reports can
      // be a model's judgement, because the model was never asked. Spec 22's
      // voided first measurement is exactly this shape, and the report carried
      // nothing that could show it.
      readonly adjudicationCallCount: number
      // Pairs the deterministic tier settled without a call, and what the model
      // answered on the ones it was given. Kept apart for the same reason.
      readonly deterministicNoImpactPairCount: number
      readonly modelVerdictCounts: ModelVerdictCounts
      readonly referenceFileCount: number
      // `undefined` when the adjudicated arm was not measured for this case.
      readonly adjudicatedFileCount: number | undefined
      readonly expectations: readonly ScoredExpectation[]
      // Files the reference list carried that adjudication dropped.
      readonly removedFiles: readonly string[]
      // Of those, the ones the corpus PROVES were dependents. These are removals
      // that were wrong.
      readonly removedProvenDependents: readonly string[]
      // Files adjudication reported that the reference list did not carry. The
      // impact admission gate refuses a finding naming a dependent the run never
      // located, so this must be empty; it is computed rather than assumed so a
      // gate that stopped working is visible instead of silent.
      readonly addedFiles: readonly string[]
    }
  | {
      readonly caseId: string
      readonly split: CorpusSplit
      readonly status: 'unmeasured'
      readonly reason: ChangeImpactUnmeasuredReason
      readonly detail: string
      readonly expectedImpactCount: number
    }

// A rate, or an explicit statement that there is none. A union rather than a
// nullable number so no renderer can print an absent measurement as 0.0%.
export type ChangeImpactRate =
  | {
      readonly status: 'measured'
      readonly matched: number
      readonly total: number
      readonly rate: number
    }
  | { readonly status: 'not-measured'; readonly reason: string }

export type ChangeImpactRecall = {
  readonly measured: ChangeImpactRate
  // Expected dependents in this dimension that no answer covers: their case did
  // not produce a report, or this arm did not run on it. Reported beside the rate
  // rather than folded into its denominator, because a missing answer is not a
  // miss.
  readonly unmeasuredExpectedCount: number
}

export type ChangeImpactArmMetrics = {
  readonly arm: ChangeImpactArm
  readonly byReachability: Readonly<
    Record<ImpactReachability, ChangeImpactRecall>
  >
  // The population spec 22 scores the promote-to-default bar on, and its
  // complement. Both are present so the pair reads as a split rather than as one
  // headline with a footnote.
  readonly directlyReachable: ChangeImpactRecall
  readonly wholeRepoSearch: ChangeImpactRecall
  readonly bySplit: Readonly<Record<CorpusSplit, ChangeImpactRecall>>
  // Pooled across cases, because a PREDICTED file carries no reachability label
  // and no split of its own — those are properties of the answer key, not of a
  // prediction. The upper bound is never known on this corpus.
  readonly precision: PrecisionBracket
  readonly predictedFileCount: number
  readonly matchedPredictedFileCount: number
}

// Arm 3. What adjudication removed relative to the reference list, PER TIER.
//
// There is deliberately NO "correct removals" count. A removed file that the
// corpus proves was a dependent was removed WRONGLY, and that is provable. A
// removed file absent from the answer key might have been noise or might have
// been a dependent nobody listed — the corpus cannot tell, so it is counted as
// unknown-correctness and never credited.
//
// AND THERE IS DELIBERATELY NO POOLED TOTAL EITHER. Spec 22's first adjudication
// measurement reported "15 reference files in, 0 out, 3 provably wrong removals"
// as what ADJUDICATION removed. The model had been called zero times: every one of
// those removals came from the deterministic tier's `no-impact` branch, and the
// figure was read as a judgement failure by a layer that never ran.
//
// The treatment is ATTRIBUTION, not exclusion. Excluding zero-call cases — the
// other option, and the one the non-exhaustive exclusion below uses — would be
// wrong here, because those exclusions exist for a different reason: a partially
// adjudicated case cannot tell "removed" from "never checked", so its removals are
// genuinely unknowable. A zero-call case hides nothing. Its removals happened, they
// are correctly reported, and the corpus can still prove some of them wrong; only
// WHO removed them was missing. Deleting sound data to prevent a misreading costs
// more than labelling it, so the delta is split into two groups that are never
// added together for the reader.
export type ChangeImpactAdjudicationDeltaGroup = {
  readonly caseCount: number
  readonly caseIds: readonly string[]
  readonly modelCallCount: number
  readonly referenceFileCount: number
  readonly adjudicatedFileCount: number
  readonly removedFileCount: number
  readonly removedProvenDependentCount: number
  readonly removedUnknownCorrectnessCount: number
  readonly retainedProvenDependentCount: number
  readonly addedNotInReferenceListCount: number
}

export type ChangeImpactAdjudicationDelta =
  | { readonly status: 'not-measured'; readonly reason: string }
  | {
      readonly status: 'measured'
      // Fully adjudicated cases in which the model was NEVER called. Every removal
      // here is the deterministic tier's, and `modelCallCount` is 0 by
      // construction. Nothing in this group is evidence about the judge.
      readonly deterministicTierOnly: ChangeImpactAdjudicationDeltaGroup
      // Fully adjudicated cases in which at least one call was spent. Their
      // removals are a MIXTURE of both tiers: the report is file-granular and a
      // file's pairs can be settled by either, so no finer attribution than the
      // case is available and none is invented here.
      readonly modelInvolved: ChangeImpactAdjudicationDeltaGroup
    }

export type ChangeImpactCoverage = {
  readonly totalCaseCount: number
  readonly scoredCaseCount: number
  readonly unmeasuredCaseCount: number
  readonly unmeasuredByReason: Readonly<
    Record<ChangeImpactUnmeasuredReason, number>
  >
  // Cases whose adjudicated arm produced predictions.
  readonly adjudicationMeasuredCaseCount: number
  // Of those, the ones that settled every pair. Only these can say what
  // adjudication REMOVED; the rest can only say what it reported.
  readonly adjudicationExhaustiveCaseCount: number
  // Pairs no adjudicator settled, across every adjudicated case. Non-zero means
  // some dependents were never looked at, which is why a non-hit in those cases
  // is undetermined rather than a miss.
  readonly unadjudicatedPairCount: number
  readonly adjudicationCallsTruncatedCaseCount: number
  // DID THE JUDGE RUN, AND ON WHAT. Model calls across every adjudicated case,
  // the cases that spent none, and the distribution of what came back. A run
  // whose model never fired is visible here and nowhere else; establishing it for
  // the voided 2026-08-06 measurement took a bespoke replay probe.
  readonly adjudicationCallCount: number
  readonly noAdjudicationCallCaseCount: number
  readonly modelVerdictCounts: ModelVerdictCounts
  // Pairs the deterministic tier settled with no call. Reported beside the model
  // verdicts, never added to them.
  readonly deterministicNoImpactPairCount: number
  readonly totalExpectedCount: number
  readonly scoredExpectedCount: number
}

export type ChangeImpactScore = {
  readonly coverage: ChangeImpactCoverage
  readonly reference: ChangeImpactArmMetrics
  readonly adjudicated: ChangeImpactArmMetrics
  // The pre-registered decision rule's own denominator: "recall >= 40% OF THE
  // DEPENDENTS THE REFERENCE LIST ITSELF CONTAINS". Adjudication cannot report a
  // file discovery never found, so scoring it against the full answer key would
  // charge it for discovery's misses.
  readonly adjudicatedRecallWithinReferenceList: ChangeImpactRecall
  readonly adjudicationDelta: ChangeImpactAdjudicationDelta
  readonly caseScores: readonly ChangeImpactCaseScore[]
}

const NO_EXPECTATIONS = 'no expected dependents in this dimension'

const normalizePath = (value: string): string => {
  try {
    return normalizeRepositoryRelativePath(value)
  } catch {
    // A path the normalizer refuses cannot match an answer-key entry either way;
    // keeping it verbatim makes it visible in the per-case detail rather than
    // crashing the whole score.
    return value
  }
}

const uniqueSorted = (values: Iterable<string>): readonly string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right))

// Every destination file the deterministic reference list enumerates —
// production and test alike. A test that calls a changed symbol is a real
// dependent (spec 22 keeps the two lists apart for the reader, not for the
// scorer), and no expected dependent in this corpus is excluded on that basis.
export const referenceDestinationFiles = (
  report: ChangeImpactReferenceReport
): readonly string[] =>
  uniqueSorted(
    [...report.impactedFiles, ...report.impactedTestFiles].map((file) =>
      normalizePath(file.path)
    )
  )

export const adjudicatedDestinationFiles = (
  report: ChangeImpactReferenceReport
): readonly string[] =>
  uniqueSorted(report.impactFindings.map((finding) => normalizePath(finding.path)))

// The adjudicated arm answered only when both tiers ran. `disabled` (the layer is
// off) and `no-model` (the residue never ran) both produce an empty or partial
// finding list that is an ABSENCE, not an answer, and scoring either as zero
// recall would publish a number for a layer that never executed.
export const isAdjudicationMeasured = (
  report: ChangeImpactReferenceReport
): boolean => report.adjudicationStatus === 'completed'

// Adjudication settled EVERY pair. Spec 22's known-not-reported list is explicit
// that "Absence from `impactFindings` is not a statement that a dependent is
// unaffected", and names four situations that produce it — two of which (a failed
// call, and the `maxCalls` cap) can occur inside a run that completed. When any
// pair is left unadjudicated, an unreported dependent may simply never have been
// looked at, so a non-hit is undetermined rather than a miss.
export const isAdjudicationExhaustive = (
  report: ChangeImpactReferenceReport
): boolean =>
  isAdjudicationMeasured(report) && report.summary.unadjudicatedPairCount === 0

const scoreCase = (input: ChangeImpactCaseInput): ChangeImpactCaseScore => {
  const { corpusCase, outcome } = input

  if (outcome.status === 'unmeasured') {
    return {
      caseId: corpusCase.id,
      split: corpusCase.split,
      status: 'unmeasured',
      reason: outcome.reason,
      detail: outcome.detail,
      expectedImpactCount: corpusCase.expectedImpact.length
    }
  }

  const { report } = outcome

  if (report.status === 'disabled') {
    return {
      caseId: corpusCase.id,
      split: corpusCase.split,
      status: 'unmeasured',
      reason: 'capability-disabled',
      detail:
        'The engine reported status "disabled", so change-impact review analysed nothing for this case.',
      expectedImpactCount: corpusCase.expectedImpact.length
    }
  }

  const referenceFiles = referenceDestinationFiles(report)
  const adjudicationMeasured = isAdjudicationMeasured(report)
  const adjudicationExhaustive = isAdjudicationExhaustive(report)
  const adjudicatedFiles = adjudicatedDestinationFiles(report)
  const referenceSet = new Set(referenceFiles)
  const adjudicatedSet = new Set(adjudicatedFiles)
  const expectedPaths = new Set(
    corpusCase.expectedImpact.map((expected: ExpectedImpact) =>
      normalizePath(expected.path)
    )
  )
  const removedFiles = referenceFiles.filter(
    (file) => !adjudicatedSet.has(file)
  )

  return {
    caseId: corpusCase.id,
    split: corpusCase.split,
    status: 'scored',
    adjudicationStatus: report.adjudicationStatus,
    adjudicationMeasured,
    adjudicationExhaustive,
    unadjudicatedPairCount: report.summary.unadjudicatedPairCount,
    adjudicationCallsTruncated: report.summary.adjudicationCallsTruncated,
    adjudicationCallCount: report.summary.adjudicationCallCount,
    deterministicNoImpactPairCount:
      report.summary.deterministicNoImpactPairCount,
    modelVerdictCounts: report.summary.modelVerdictCounts,
    referenceFileCount: referenceFiles.length,
    adjudicatedFileCount: adjudicationMeasured
      ? adjudicatedFiles.length
      : undefined,
    expectations: corpusCase.expectedImpact.map((expected) => {
      const expectedPath = normalizePath(expected.path)

      return {
        caseId: corpusCase.id,
        path: expectedPath,
        reachability: expected.reachability,
        directlyReachable: isDirectlyReachable(expected.reachability),
        split: corpusCase.split,
        inReferenceList: referenceSet.has(expectedPath),
        // A hit is unambiguous whatever else the run left unchecked. A non-hit is
        // a MISS only when every pair was settled; otherwise this dependent may
        // simply never have been looked at, and calling that a miss would score
        // the call cap as a failure of the model.
        inAdjudicatedList: !adjudicationMeasured
          ? undefined
          : adjudicatedSet.has(expectedPath)
            ? true
            : adjudicationExhaustive
              ? false
              : undefined
      }
    }),
    // Arm 3 needs "adjudication decided not to report this", which a partially
    // adjudicated run cannot supply: its unreported files mix decided-no-impact
    // with never-checked. Such a case contributes nothing to the delta rather
    // than contributing a number that means two things.
    removedFiles: adjudicationExhaustive ? removedFiles : [],
    removedProvenDependents: adjudicationExhaustive
      ? removedFiles.filter((file) => expectedPaths.has(file))
      : [],
    addedFiles: adjudicationExhaustive
      ? adjudicatedFiles.filter((file) => !referenceSet.has(file))
      : []
  }
}

type ArmHit = (expectation: ScoredExpectation) => boolean | undefined

const recallOver = (input: {
  readonly scoredExpectations: readonly ScoredExpectation[]
  readonly unmeasuredExpectedCount: number
  readonly hit: ArmHit
}): ChangeImpactRecall => {
  let matched = 0
  let total = 0
  let unmeasured = input.unmeasuredExpectedCount

  for (const expectation of input.scoredExpectations) {
    const outcome = input.hit(expectation)

    if (outcome === undefined) {
      unmeasured += 1
      continue
    }

    total += 1

    if (outcome) {
      matched += 1
    }
  }

  return {
    measured:
      total === 0
        ? {
            status: 'not-measured',
            reason:
              unmeasured > 0
                ? `${unmeasured} expected dependent(s) in this dimension produced no answer`
                : NO_EXPECTATIONS
          }
        : { status: 'measured', matched, total, rate: matched / total },
    unmeasuredExpectedCount: unmeasured
  }
}

const armMetrics = (input: {
  readonly arm: ChangeImpactArm
  readonly scoredExpectations: readonly ScoredExpectation[]
  readonly unmeasuredExpectationsFor: (
    predicate: (expectation: ExpectedImpactDimension) => boolean
  ) => number
  readonly hit: ArmHit
  readonly predictedFileCount: number
  readonly matchedPredictedFileCount: number
  readonly precisionMeasured: boolean
}): ChangeImpactArmMetrics => {
  const recallFor = (
    predicate: (dimension: ExpectedImpactDimension) => boolean
  ): ChangeImpactRecall =>
    recallOver({
      scoredExpectations: input.scoredExpectations.filter((expectation) =>
        predicate(expectation)
      ),
      unmeasuredExpectedCount: input.unmeasuredExpectationsFor(predicate),
      hit: input.hit
    })

  return {
    arm: input.arm,
    byReachability: Object.fromEntries(
      impactReachabilityClasses.map((reachability) => [
        reachability,
        recallFor((dimension) => dimension.reachability === reachability)
      ])
    ) as Readonly<Record<ImpactReachability, ChangeImpactRecall>>,
    directlyReachable: recallFor((dimension) => dimension.directlyReachable),
    wholeRepoSearch: recallFor((dimension) => !dimension.directlyReachable),
    bySplit: Object.fromEntries(
      corpusSplits.map((split) => [
        split,
        recallFor((dimension) => dimension.split === split)
      ])
    ) as Readonly<Record<CorpusSplit, ChangeImpactRecall>>,
    // The lower bound is raw precision, which charges every unmatched prediction
    // as wrong. The upper bound is `not-measured` and stays that way: this corpus
    // lists the dependents upstream had to repair, not every file each change
    // affected, so an unmatched prediction cannot be shown to be a false positive
    // and nothing here has examined one.
    precision: precisionBracket({
      precision: input.precisionMeasured
        ? input.predictedFileCount === 0
          ? undefined
          : input.matchedPredictedFileCount / input.predictedFileCount
        : undefined,
      adjustedPrecision: undefined,
      plausibilityJudged: false,
      adjustedPrecisionTrustworthy: undefined
    }),
    predictedFileCount: input.predictedFileCount,
    matchedPredictedFileCount: input.matchedPredictedFileCount
  }
}

// The dimensions a recall cell can be filtered on, available for both scored and
// unmeasured expectations so a dimension's unmeasured count is exact rather than
// approximated from the case level.
type ExpectedImpactDimension = {
  readonly reachability: ImpactReachability
  readonly directlyReachable: boolean
  readonly split: CorpusSplit
}

const dimensionsOf = (
  corpusCase: ChangeImpactCorpusCase
): readonly ExpectedImpactDimension[] =>
  corpusCase.expectedImpact.map((expected) => ({
    reachability: expected.reachability,
    directlyReachable: isDirectlyReachable(expected.reachability),
    split: corpusCase.split
  }))

type ScoredCase = Extract<ChangeImpactCaseScore, { status: 'scored' }>

export const scoreChangeImpactCases = (
  inputs: readonly ChangeImpactCaseInput[]
): ChangeImpactScore => {
  const caseScores = inputs.map(scoreCase)
  const scoredCases = caseScores.filter(
    (score): score is ScoredCase => score.status === 'scored'
  )
  const scoredExpectations = scoredCases.flatMap((score) => score.expectations)
  // Dimensions of every expectation whose CASE produced no answer at all. These
  // are unmeasured for both arms. Paired by position rather than by id lookup:
  // `caseScores` is `inputs.map(scoreCase)`, so index correspondence is exact and
  // survives two cases sharing an id, which a lookup would silently mis-attribute.
  const unmeasuredCaseDimensions = inputs.flatMap((input, index) =>
    caseScores[index]?.status === 'unmeasured'
      ? dimensionsOf(input.corpusCase)
      : []
  )
  const unmeasuredExpectationsFor = (
    predicate: (dimension: ExpectedImpactDimension) => boolean
  ): number => unmeasuredCaseDimensions.filter(predicate).length

  const referenceArm = armMetrics({
    arm: 'reference',
    scoredExpectations,
    unmeasuredExpectationsFor,
    hit: (expectation) => expectation.inReferenceList,
    predictedFileCount: scoredCases.reduce(
      (total, score) => total + score.referenceFileCount,
      0
    ),
    matchedPredictedFileCount: scoredExpectations.filter(
      (expectation) => expectation.inReferenceList
    ).length,
    precisionMeasured: scoredCases.length > 0
  })

  const adjudicationMeasuredCases = scoredCases.filter(
    (score) => score.adjudicationMeasured
  )
  const adjudicatedArm = armMetrics({
    arm: 'adjudicated',
    scoredExpectations,
    unmeasuredExpectationsFor,
    hit: (expectation) => expectation.inAdjudicatedList,
    predictedFileCount: adjudicationMeasuredCases.reduce(
      (total, score) => total + (score.adjudicatedFileCount ?? 0),
      0
    ),
    matchedPredictedFileCount: scoredExpectations.filter(
      (expectation) => expectation.inAdjudicatedList === true
    ).length,
    precisionMeasured: adjudicationMeasuredCases.length > 0
  })

  // Only the expectations the reference list actually carried, which is the
  // denominator the pre-registered decision rule names.
  const withinReferenceList = recallOver({
    scoredExpectations: scoredExpectations.filter(
      (expectation) => expectation.inReferenceList
    ),
    unmeasuredExpectedCount: 0,
    hit: (expectation) => expectation.inAdjudicatedList
  })

  const unmeasuredByReason = Object.fromEntries(
    changeImpactUnmeasuredReasons.map((reason) => [
      reason,
      caseScores.filter(
        (score) => score.status === 'unmeasured' && score.reason === reason
      ).length
    ])
  ) as Readonly<Record<ChangeImpactUnmeasuredReason, number>>

  // Arm 3 needs "adjudication decided not to report this file". Only a case that
  // settled every pair supplies it; a partially adjudicated one mixes
  // decided-no-impact with never-checked in the same absence.
  const exhaustiveCases = scoredCases.filter(
    (score) => score.adjudicationExhaustive
  )
  const deltaGroup = (
    cases: readonly ScoredCase[]
  ): ChangeImpactAdjudicationDeltaGroup => {
    const caseIds = new Set(cases.map((score) => score.caseId))

    return {
      caseCount: cases.length,
      caseIds: cases.map((score) => score.caseId),
      modelCallCount: cases.reduce(
        (total, score) => total + score.adjudicationCallCount,
        0
      ),
      referenceFileCount: cases.reduce(
        (total, score) => total + score.referenceFileCount,
        0
      ),
      adjudicatedFileCount: cases.reduce(
        (total, score) => total + (score.adjudicatedFileCount ?? 0),
        0
      ),
      removedFileCount: cases.reduce(
        (total, score) => total + score.removedFiles.length,
        0
      ),
      removedProvenDependentCount: cases.reduce(
        (total, score) => total + score.removedProvenDependents.length,
        0
      ),
      removedUnknownCorrectnessCount: cases.reduce(
        (total, score) =>
          total +
          (score.removedFiles.length - score.removedProvenDependents.length),
        0
      ),
      retainedProvenDependentCount: scoredExpectations.filter(
        (expectation) =>
          caseIds.has(expectation.caseId) &&
          expectation.inReferenceList &&
          expectation.inAdjudicatedList === true
      ).length,
      addedNotInReferenceListCount: cases.reduce(
        (total, score) => total + score.addedFiles.length,
        0
      )
    }
  }
  const adjudicationDelta: ChangeImpactAdjudicationDelta =
    exhaustiveCases.length === 0
      ? {
          status: 'not-measured',
          reason:
            adjudicationMeasuredCases.length === 0
              ? 'No case produced an adjudicated answer, so there is no difference to report against the reference list.'
              : `Every adjudicated case left pairs unadjudicated (${adjudicationMeasuredCases.reduce((total, score) => total + score.unadjudicatedPairCount, 0)} in total), so an unreported file cannot be told from one nobody checked. Raise changeImpact.adjudication.maxCalls, or investigate the failed calls, and re-run.`
        }
      : {
          status: 'measured',
          deterministicTierOnly: deltaGroup(
            exhaustiveCases.filter(
              (score) => score.adjudicationCallCount === 0
            )
          ),
          modelInvolved: deltaGroup(
            exhaustiveCases.filter((score) => score.adjudicationCallCount > 0)
          )
        }

  return {
    coverage: {
      totalCaseCount: caseScores.length,
      scoredCaseCount: scoredCases.length,
      unmeasuredCaseCount: caseScores.length - scoredCases.length,
      unmeasuredByReason,
      adjudicationMeasuredCaseCount: adjudicationMeasuredCases.length,
      adjudicationExhaustiveCaseCount: exhaustiveCases.length,
      unadjudicatedPairCount: adjudicationMeasuredCases.reduce(
        (total, score) => total + score.unadjudicatedPairCount,
        0
      ),
      adjudicationCallsTruncatedCaseCount: adjudicationMeasuredCases.filter(
        (score) => score.adjudicationCallsTruncated
      ).length,
      adjudicationCallCount: adjudicationMeasuredCases.reduce(
        (total, score) => total + score.adjudicationCallCount,
        0
      ),
      noAdjudicationCallCaseCount: adjudicationMeasuredCases.filter(
        (score) => score.adjudicationCallCount === 0
      ).length,
      modelVerdictCounts: adjudicationMeasuredCases.reduce(
        (totals, score) => ({
          relies: totals.relies + score.modelVerdictCounts.relies,
          'does-not-rely':
            totals['does-not-rely'] +
            score.modelVerdictCounts['does-not-rely'],
          undetermined:
            totals.undetermined + score.modelVerdictCounts.undetermined
        }),
        { relies: 0, 'does-not-rely': 0, undetermined: 0 }
      ),
      deterministicNoImpactPairCount: adjudicationMeasuredCases.reduce(
        (total, score) => total + score.deterministicNoImpactPairCount,
        0
      ),
      totalExpectedCount: inputs.reduce(
        (total, input) => total + input.corpusCase.expectedImpact.length,
        0
      ),
      scoredExpectedCount: scoredExpectations.length
    },
    reference: referenceArm,
    adjudicated: adjudicatedArm,
    adjudicatedRecallWithinReferenceList: withinReferenceList,
    adjudicationDelta,
    caseScores
  }
}
