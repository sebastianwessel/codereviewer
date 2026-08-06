import {
  collectArmOutcomes,
  compareArms,
  type ArmOutcomes,
  type ExpectationKey,
  type PairedComparison,
  type PairedScoredRun
} from './eval-significance.js'
import { allDiffScopes } from './eval-diff-scope.js'
import { type EvalComparisonRun } from './eval-comparison-view.js'
import { type MetricComparability } from './eval-metrics-versions.js'

// THE PRIMARY VERDICT FOR A RECALL DIFFERENCE.
//
// Run-level mean ± standard deviation over three seeds is a weak instrument. An
// sd from n=3 is barely an estimate: the two most recent figures on this corpus
// (0.96pp and 2.89pp) carry 95% intervals of roughly [0.50, 6.04] and
// [1.50, 18.17], which overlap almost entirely. Deciding a few-point recall
// difference with that is deciding it with noise.
//
// The sharper instrument was already built and simply was not wired in. Both
// arms score the SAME expectations, so pairing on the expectation removes the
// between-run variance the arms share, and the discordant pairs -- expectations
// one arm found and the other missed -- carry all the information. That needs no
// extra provider spend because the per-expectation outcome is already in every
// report.
//
// Two properties of that verdict are what this module owns.
//
// PER POPULATION, NOT BLENDED. The corpus holds two populations with
// structurally different behaviour: in-diff expectations, which move, and
// out-of-diff expectations, which are a measured hard zero in every arm of every
// run because the reviewer is diff-scoped. The out-of-diff expectations are ties
// in every pairing, so they contribute nothing to the test -- but blended they
// inflate the denominator, make the reported recall the figure the spec already
// says is uninterpretable on its own, and make the verdict's prose describe a
// population that cannot move. Measured: on the three matched run pairs of the
// 2026-08-02 and 2026-08-05 sweeps the blended verdict read "does NOT clear
// p < 0.05" three times over; the same data, adjudicated on the in-diff
// population and pooled across the runs, is 12 gained against 3 lost, p =
// 0.0352. The blended framing hid a real effect.
//
// ONE OBSERVATION PER EXPECTATION PER ARM. An arm may hold several runs, and it
// still contributes one observation per expectation -- how many of its runs
// found it. Pooling per-pair discordant counts across run pairs instead would
// count the same expectation once per pair, which is not more evidence, only the
// same evidence repeated.

// Conventional two-sided threshold. It is a reporting convention, not a decision
// on its own: this project's own rule (docs/05-quality/comparing-runs.md) also
// requires precision not to degrade and the cost to be defensible.
export const PAIRED_SIGNIFICANCE_ALPHA = 0.05

// Populations that are always adjudicated and always rendered, in this order,
// even when empty. Saying "this population holds no expectation" is information;
// silently omitting it lets a reader assume it was covered.
export const ALWAYS_REPORTED_DIFF_SCOPES = ['in-diff', 'out-of-diff'] as const

// The population whose verdict is the headline. It is the only one on this
// corpus that can move.
export const HEADLINE_DIFF_SCOPE = 'in-diff'

export const SCOPE_NOT_RECORDED_POPULATION = 'scope-not-recorded'
export const SCOPE_DIVERGENT_POPULATION = 'scope-divergent'
export const BLENDED_POPULATION = 'blended'

export type PairedPopulationKind =
  | 'diff-scope'
  | 'scope-not-recorded'
  | 'scope-divergent'
  | 'blended'

// Why a population reports what it reports. The distinction matters because
// three of these four are NOT results: a population with no expectations, a
// population neither arm ever found anything in, and a population where nothing
// moved all yield no p-value, and each has to say which of the three it is
// rather than print a test over nothing.
export type PairedPopulationFinding =
  | 'no-expectations'
  | 'hard-zero-in-both-arms'
  | 'no-discordant-pairs'
  | 'tested'

export type PairedPopulationVerdict = {
  readonly id: string
  readonly kind: PairedPopulationKind
  readonly headline: boolean
  readonly finding: PairedPopulationFinding
  readonly comparison: PairedComparison
  readonly significant: boolean
  readonly direction: 'improved' | 'regressed' | 'unchanged'
}

export type PairedArmSummary = {
  readonly runCount: number
  readonly runLabels: readonly string[]
}

export type PairedRecallVerdict =
  | {
      readonly status: 'unavailable'
      readonly reason: string
    }
  | {
      readonly status: 'available'
      readonly base: PairedArmSummary
      readonly head: PairedArmSummary
      readonly populations: readonly PairedPopulationVerdict[]
      // Reported, but never the headline: it mixes populations whose behaviour
      // differs structurally, so it moves with the fixture set's in/out ratio as
      // much as with the reviewer.
      readonly blended: PairedPopulationVerdict
    }

// A run can only take part if it recorded, for every case, both the expectations
// it scored and the matches it made. Absence is refused rather than read as an
// empty set: an arm silently missing its expectations would score 0% recall and
// look like a catastrophic regression.
const expectationIndexes = (
  findings: readonly { readonly expectedIndex?: number | undefined }[]
): readonly { readonly expectedIndex: number }[] | undefined => {
  const indexes: { readonly expectedIndex: number }[] = []

  for (const finding of findings) {
    if (finding.expectedIndex === undefined) {
      return undefined
    }

    indexes.push({ expectedIndex: finding.expectedIndex })
  }

  return indexes
}

const asPairedScoredRun = (
  run: EvalComparisonRun,
  armLabel: string
): PairedScoredRun | string => {
  const { report } = run
  const caseResults = report.caseResults
  const label = `${armLabel} report ${run.label}`

  if (caseResults === undefined) {
    return `${label} records no case results`
  }

  const runCases: PairedScoredRun['caseResults'][number][] = []

  for (const caseResult of caseResults) {
    const { expectedFindings, matchedFindings } = caseResult

    if (expectedFindings === undefined || matchedFindings === undefined) {
      return `${label} case ${caseResult.caseId} does not record its expected or matched findings`
    }

    const expected = expectationIndexes(expectedFindings)
    const matched = expectationIndexes(matchedFindings)

    if (expected === undefined || matched === undefined) {
      return `${label} case ${caseResult.caseId} records a finding without an expectation index`
    }

    runCases.push({
      caseId: caseResult.caseId,
      expectedFindings: expected.map((entry, position) => ({
        expectedIndex: entry.expectedIndex,
        diffScope: expectedFindings[position]?.diffScope
      })),
      matchedFindings: matched
    })
  }

  return {
    metricsVersion: report.metricsVersion,
    // Read by the pooling guard, which refuses an arm whose runs were scored
    // against different answer keys. Cross-ARM divergence is caught by the
    // comparison's own per-case digest refusal before this module is reached.
    provenance: {
      answerKeyDigest: report.provenance?.answerKeyDigest ?? 'unrecorded'
    },
    caseResults: runCases
  }
}

// Every run of an arm, or the first reason the arm cannot be adjudicated.
const scoredArm = (
  runs: readonly EvalComparisonRun[],
  armLabel: string
): readonly PairedScoredRun[] | string => {
  const scoredRuns: PairedScoredRun[] = []

  for (const run of runs) {
    const scored = asPairedScoredRun(run, armLabel)

    if (typeof scored === 'string') {
      return scored
    }

    scoredRuns.push(scored)
  }

  return scoredRuns
}

// The population an expectation belongs to, decided from every scope label both
// arms recorded for it. Diff scope is a property of the EXPECTATION -- derived
// from the case's own diff -- so the arms must agree; where they do not, the
// expectation is adjudicated in its own population rather than assigned to
// whichever arm's label was read first.
const populationOf = (
  key: ExpectationKey,
  base: ArmOutcomes,
  head: ArmOutcomes
): { readonly id: string; readonly kind: PairedPopulationKind } => {
  const recorded = new Set([
    ...(base.outcomeByExpectation.get(key)?.scopes ?? []),
    ...(head.outcomeByExpectation.get(key)?.scopes ?? [])
  ])

  if (recorded.size === 0) {
    return { id: SCOPE_NOT_RECORDED_POPULATION, kind: 'scope-not-recorded' }
  }

  if (recorded.size > 1) {
    return { id: SCOPE_DIVERGENT_POPULATION, kind: 'scope-divergent' }
  }

  const [only] = [...recorded]

  return only === undefined
    ? { id: SCOPE_NOT_RECORDED_POPULATION, kind: 'scope-not-recorded' }
    : { id: only, kind: 'diff-scope' }
}

// Render order. The two populations the corpus is built around come first and
// are always reported; then any other declared scope; then any scope label a
// later build introduced, which arrives here as a string this build does not
// know rather than as a parse failure; then the two buckets for expectations
// that could not be placed at all.
const populationOrder = (populationIds: readonly string[]): readonly string[] => {
  const alwaysReported: readonly string[] = ALWAYS_REPORTED_DIFF_SCOPES
  const declared: readonly string[] = [
    ...alwaysReported,
    ...allDiffScopes.filter((scope) => !alwaysReported.includes(scope))
  ]
  const unplaceable: readonly string[] = [
    SCOPE_NOT_RECORDED_POPULATION,
    SCOPE_DIVERGENT_POPULATION
  ]
  const undeclared = populationIds
    .filter((id) => !declared.includes(id) && !unplaceable.includes(id))
    .sort()

  return [...declared, ...undeclared, ...unplaceable]
}

const findingOf = (comparison: PairedComparison): PairedPopulationFinding => {
  if (comparison.expectationCount === 0) {
    return 'no-expectations'
  }

  // Checked before the general no-discordant case because it is a stronger and
  // more useful statement: not merely "nothing moved" but "no run in either arm
  // ever found any of these", which is what the out-of-diff population is by
  // design and what a reader must not mistake for a tie between two working
  // arms.
  if (comparison.neverFound === comparison.expectationCount) {
    return 'hard-zero-in-both-arms'
  }

  return comparison.discordantCount === 0 ? 'no-discordant-pairs' : 'tested'
}

const populationVerdict = (
  input: {
    readonly id: string
    readonly kind: PairedPopulationKind
    readonly comparison: PairedComparison
  }
): PairedPopulationVerdict => ({
  id: input.id,
  kind: input.kind,
  headline: input.kind === 'diff-scope' && input.id === HEADLINE_DIFF_SCOPE,
  finding: findingOf(input.comparison),
  comparison: input.comparison,
  significant:
    input.comparison.pValue !== undefined &&
    input.comparison.pValue < PAIRED_SIGNIFICANCE_ALPHA,
  direction:
    input.comparison.delta > 0
      ? 'improved'
      : input.comparison.delta < 0
        ? 'regressed'
        : 'unchanged'
})

export const pairedRecallVerdict = (
  input: {
    readonly base: readonly EvalComparisonRun[]
    readonly head: readonly EvalComparisonRun[]
    readonly comparability: MetricComparability
  }
): PairedRecallVerdict => {
  // An arm of no runs has no outcomes, and a base of three runs against a head
  // of one is not a paired design: the two arms' per-expectation values would be
  // measured to different resolutions, so a 2/3 against a 1/1 would count as
  // movement that is an artifact of the run counts. Refused loudly rather than
  // adjudicated on whatever happens to line up.
  if (input.base.length === 0 || input.head.length === 0) {
    throw new Error(
      'Refusing to adjudicate a paired recall verdict with an empty arm: each arm needs at least one scored report.'
    )
  }

  if (input.base.length !== input.head.length) {
    throw new Error(
      `Refusing to adjudicate a paired recall verdict across arms of different sizes: base has ${input.base.length} run(s) and head has ${input.head.length}. Per-expectation outcomes measured over different run counts are not paired observations.`
    )
  }

  const recallRefusal = input.comparability.refusalReason('recall')

  if (recallRefusal !== undefined) {
    return {
      status: 'unavailable',
      reason: `recall is not comparable across these reports: ${recallRefusal}`
    }
  }

  const baseRuns = scoredArm(input.base, 'base')
  const headRuns = scoredArm(input.head, 'head')

  if (typeof baseRuns === 'string') {
    return { status: 'unavailable', reason: baseRuns }
  }

  if (typeof headRuns === 'string') {
    return { status: 'unavailable', reason: headRuns }
  }

  const base = collectArmOutcomes(baseRuns)
  const head = collectArmOutcomes(headRuns)

  const keysByPopulation = new Map<
    string,
    { readonly kind: PairedPopulationKind; readonly keys: Set<ExpectationKey> }
  >()
  const allKeys = new Set([
    ...base.outcomeByExpectation.keys(),
    ...head.outcomeByExpectation.keys()
  ])

  for (const key of allKeys) {
    const population = populationOf(key, base, head)
    const bucket = keysByPopulation.get(population.id) ?? {
      kind: population.kind,
      keys: new Set<ExpectationKey>()
    }

    bucket.keys.add(key)
    keysByPopulation.set(population.id, bucket)
  }

  const blended = populationVerdict({
    id: BLENDED_POPULATION,
    kind: 'blended',
    comparison: compareArms(base, head)
  })

  if (blended.comparison.expectationCount === 0) {
    return {
      status: 'unavailable',
      reason: 'the two arms share no expectation, so nothing can be paired'
    }
  }

  const alwaysReported: readonly string[] = ALWAYS_REPORTED_DIFF_SCOPES
  const populations = populationOrder([...keysByPopulation.keys()])
    .flatMap((id) => {
      const bucket = keysByPopulation.get(id)

      // A population with no expectations is still reported when it is one of
      // the two the corpus is built around: "this population holds nothing" is
      // information, where an omitted section reads as a covered one. Any other
      // empty population is genuinely absent and is not invented.
      if (bucket === undefined) {
        return alwaysReported.includes(id)
          ? [
              populationVerdict({
                id,
                kind: 'diff-scope',
                comparison: compareArms(base, head, new Set())
              })
            ]
          : []
      }

      return [
        populationVerdict({
          id,
          kind: bucket.kind,
          comparison: compareArms(base, head, bucket.keys)
        })
      ]
    })

  return {
    status: 'available',
    base: {
      runCount: base.runCount,
      runLabels: input.base.map((run) => run.label)
    },
    head: {
      runCount: head.runCount,
      runLabels: input.head.map((run) => run.label)
    },
    populations,
    blended
  }
}
