import { EvalReportSchema, type EvalReport } from './eval-report-contracts.js'

// Paired, finding-level comparison of two evaluation arms.
//
// The existing comparison contrasts run-level means, which throws away the fact
// that both arms scored the SAME expectations. On a 42-expectation corpus with a
// ~4.8pp run-to-run deviation that costs most of the available power: a run-mean
// test at three seeds cannot resolve anything smaller than roughly ten points, so
// every change measured so far has been adjudicated by an instrument too blunt to
// see it. Pairing on the expectation removes the between-run variance that both
// arms share, and it needs no extra provider spend — the per-expectation outcome
// is already recorded in every report.
//
// The unit is one expectation (`caseId#expectedIndex`), not one run. An arm may
// hold SEVERAL runs, and it still contributes exactly ONE observation per
// expectation: the fraction of the arm's runs that matched it. Pooling the
// per-pair discordant counts of several run pairs instead would count the same
// expectation once per pair and manufacture independence that is not there.

export type ExpectationKey = string

// The minimum a run must record to take part in a paired test. Declared
// structurally rather than as `EvalReport` so the same test serves both the
// producer contract and the tolerant comparison view -- and so a caller that
// only has some of a report cannot be tempted to fill the rest in with zeroes.
export type PairedScoredRun = {
  readonly metricsVersion: string
  readonly provenance: { readonly answerKeyDigest: string }
  readonly caseResults: readonly {
    readonly caseId: string
    readonly expectedFindings: readonly {
      readonly expectedIndex: number
      // The diff-scope label the run recorded for this expectation, or absent
      // when the report predates the field. Kept as a plain string rather than
      // the `DiffScope` enum so a label a later build introduces partitions into
      // its own population instead of failing to parse.
      readonly diffScope?: string | undefined
    }[]
    readonly matchedFindings: readonly { readonly expectedIndex: number }[]
  }[]
}

export type ExpectationOutcome = {
  // Fraction of this arm's runs in which the expectation was matched. Binary when
  // the arm has one run.
  readonly hitRate: number
  // Every distinct diff-scope label the arm's runs recorded for this expectation.
  // Empty when no run recorded one; more than one entry means the runs disagree,
  // which the verdict adjudicates as its own population rather than picking a
  // side.
  readonly scopes: ReadonlySet<string>
}

export type ArmOutcomes = {
  readonly runCount: number
  readonly outcomeByExpectation: ReadonlyMap<ExpectationKey, ExpectationOutcome>
}

export const expectationKey = (
  caseId: string,
  expectedIndex: number
): ExpectationKey => `${caseId}#${expectedIndex}`

// An expectation counts as found in a run when the matcher bound an admitted
// finding to it. Artifact-only and inconclusive outcomes are NOT matches, which
// keeps this consistent with how `recall` is defined.
const matchedKeysIn = (
  report: PairedScoredRun
): ReadonlySet<ExpectationKey> =>
  new Set(
    report.caseResults.flatMap((caseResult) =>
      caseResult.matchedFindings.map((match) =>
        expectationKey(caseResult.caseId, match.expectedIndex)
      )
    )
  )

const expectationsIn = (
  report: PairedScoredRun
): readonly {
  readonly key: ExpectationKey
  readonly diffScope: string | undefined
}[] =>
  report.caseResults.flatMap((caseResult) =>
    caseResult.expectedFindings.map((expected) => ({
      key: expectationKey(caseResult.caseId, expected.expectedIndex),
      diffScope: expected.diffScope
    }))
  )

// How many of an arm's runs are allowed to be missing an expectation: none. A
// run that did not score an expectation the rest of the arm scored has no
// outcome for it, and dividing its hits by the arm's run count would read that
// absence as a miss -- the recurring defect class where absence produces a
// plausible pessimistic number instead of an error.
const refuseIncompleteScoring = (
  scoredRunCount: ReadonlyMap<ExpectationKey, number>,
  runCount: number
): void => {
  const partial = [...scoredRunCount]
    .filter(([, count]) => count !== runCount)
    .map(([key, count]) => `${key} (scored by ${count} of ${runCount})`)
    .sort()

  if (partial.length > 0) {
    throw new Error(
      `Refusing to pool evaluation runs that did not all score the same expectations: ${partial.join(', ')}. An expectation a run never scored is not an expectation that run missed.`
    )
  }
}

export const collectArmOutcomes = (
  reports: readonly PairedScoredRun[]
): ArmOutcomes => {
  // Every run in an arm must have been scored by the same rules, for the same
  // reason the comparison refuses to mix them: a metrics-version change alters
  // what a metric reports for identical review output, so pooling across one
  // measures the scoring change.
  const versions = [...new Set(reports.map((report) => report.metricsVersion))]

  if (versions.length > 1) {
    throw new Error(
      `Refusing to pool evaluation runs scored by different rules: metrics versions ${versions.join(', ')}.`
    )
  }

  // Stricter than the comparison renderer, deliberately. Comparing two runs with
  // different case selections is ordinary work and only warrants a warning, but
  // POOLING them is never right: the runs form one arm whose per-expectation hit
  // rates share a denominator, so mixing selections silently computes a rate over
  // a population that never existed. An arm must be homogeneous, so the aggregate
  // digest is the correct test here even though it is too blunt for comparison.
  const answerKeyDigests = [
    ...new Set(reports.map((report) => report.provenance.answerKeyDigest))
  ]

  if (answerKeyDigests.length > 1) {
    throw new Error(
      `Refusing to pool evaluation runs scored against different answer keys: digests ${answerKeyDigests.join(', ')}.`
    )
  }

  const hits = new Map<ExpectationKey, number>()
  const scoredRunCount = new Map<ExpectationKey, number>()
  const scopes = new Map<ExpectationKey, Set<string>>()

  for (const report of reports) {
    const matched = matchedKeysIn(report)

    for (const { key, diffScope } of expectationsIn(report)) {
      hits.set(key, (hits.get(key) ?? 0) + (matched.has(key) ? 1 : 0))
      scoredRunCount.set(key, (scoredRunCount.get(key) ?? 0) + 1)

      const recorded = scopes.get(key) ?? new Set<string>()

      if (diffScope !== undefined) {
        recorded.add(diffScope)
      }

      scopes.set(key, recorded)
    }
  }

  const runCount = reports.length

  refuseIncompleteScoring(scoredRunCount, runCount)

  const outcomeByExpectation = new Map<ExpectationKey, ExpectationOutcome>()

  for (const [key, hitCount] of hits) {
    outcomeByExpectation.set(key, {
      hitRate: runCount === 0 ? 0 : hitCount / runCount,
      scopes: scopes.get(key) ?? new Set<string>()
    })
  }

  return { runCount, outcomeByExpectation }
}

// The one statistic this module reports, named in the type so the rendered
// output cannot describe a test other than the one that was run.
export const PAIRED_SIGNIFICANCE_TEST = 'exact-two-sided-sign-test' as const

export type PairedSignificanceTest = typeof PAIRED_SIGNIFICANCE_TEST

export type PairedComparison = {
  readonly expectationCount: number
  readonly baseRecall: number
  readonly headRecall: number
  readonly delta: number
  // Expectations whose outcome differs between arms. Only these carry information
  // about the change; everything else cancels in the pairing.
  readonly gained: readonly ExpectationKey[]
  readonly lost: readonly ExpectationKey[]
  readonly alwaysFound: number
  readonly neverFound: number
  readonly concordant: number
  readonly discordantCount: number
  // Exact two-sided sign test over the discordant expectations (McNemar's exact
  // test). Undefined when nothing is discordant, because the test is then
  // undefined rather than significant.
  readonly pValue: number | undefined
  readonly pValueMethod: PairedSignificanceTest | undefined
  readonly ci95: readonly [number, number]
  // Expectations only one arm scored. A non-empty list means the arms were run
  // against different answer keys and the comparison is not valid.
  readonly unpairedExpectations: readonly ExpectationKey[]
}

const mean = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length

// P(X <= upTo) for X ~ Binomial(trials, 0.5), summed term by term from the
// probability mass at zero so no binomial coefficient is ever materialised.
const binomialLowerTailAtHalf = (trials: number, upTo: number): number => {
  let term = Math.pow(0.5, trials)
  let total = term

  for (let successes = 1; successes <= upTo; successes += 1) {
    term = (term * (trials - successes + 1)) / successes
    total += term
  }

  return total
}

// EXACT, not a normal approximation. The discordant counts this corpus produces
// are small -- the 2026-08-02 vs 2026-08-05 sweeps discriminate on 15 pairs --
// and at that size the normal approximation is not a rounding difference: it
// reports p = 0.0201 where the exact test reports p = 0.0352, on the same 12
// gained against 3 lost. A verdict that clears its own threshold only under an
// approximation is a verdict about the approximation.
//
// Under the null a discordant expectation is equally likely to have been gained
// as lost, so the gained count is Binomial(discordant, 0.5) and the two-sided p
// is twice the smaller tail.
const exactTwoSidedSignTestPValue = (
  gained: number,
  lost: number
): number | undefined => {
  const discordant = gained + lost

  if (discordant === 0) {
    return undefined
  }

  return Math.min(
    1,
    2 * binomialLowerTailAtHalf(discordant, Math.min(gained, lost))
  )
}

// Deterministic PRNG. A bootstrap that used Math.random would make the reported
// interval move between invocations on identical inputs, which is exactly the
// kind of irreproducibility this evaluation exists to avoid.
const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BOOTSTRAP_RESAMPLES = 2000
const BOOTSTRAP_SEED = 0x5eed

// Paired bootstrap over expectations: resample the expectation set with
// replacement and recompute the delta, so the interval reflects which
// expectations happen to be in the corpus rather than assuming normality over a
// handful of runs.
const bootstrapInterval = (
  differences: readonly number[]
): readonly [number, number] => {
  if (differences.length === 0) {
    return [0, 0]
  }

  const random = createRandom(BOOTSTRAP_SEED)
  const deltas: number[] = []

  for (let resample = 0; resample < BOOTSTRAP_RESAMPLES; resample += 1) {
    let total = 0

    for (let draw = 0; draw < differences.length; draw += 1) {
      total += differences[Math.floor(random() * differences.length)] ?? 0
    }

    deltas.push(total / differences.length)
  }

  deltas.sort((left, right) => left - right)

  const lowerIndex = Math.floor(0.025 * deltas.length)
  const upperIndex = Math.min(deltas.length - 1, Math.ceil(0.975 * deltas.length) - 1)

  return [deltas[lowerIndex] ?? 0, deltas[upperIndex] ?? 0]
}

// `restrictTo` selects the population being adjudicated. Populations are
// adjudicated SEPARATELY rather than blended, so each one carries its own
// discordant counts, its own test and its own interpretation -- see
// `eval-paired-recall-verdict.ts`.
export const compareArms = (
  base: ArmOutcomes,
  head: ArmOutcomes,
  restrictTo?: ReadonlySet<ExpectationKey>
): PairedComparison => {
  const keys = [
    ...new Set([
      ...base.outcomeByExpectation.keys(),
      ...head.outcomeByExpectation.keys()
    ])
  ]
    .filter((key) => restrictTo === undefined || restrictTo.has(key))
    .sort()
  const unpairedExpectations = keys.filter(
    (key) =>
      !base.outcomeByExpectation.has(key) || !head.outcomeByExpectation.has(key)
  )
  const paired = keys.filter((key) => !unpairedExpectations.includes(key))

  const baseRates = paired.map(
    (key) => base.outcomeByExpectation.get(key)?.hitRate ?? 0
  )
  const headRates = paired.map(
    (key) => head.outcomeByExpectation.get(key)?.hitRate ?? 0
  )
  const differences = paired.map(
    (_, index) => (headRates[index] ?? 0) - (baseRates[index] ?? 0)
  )

  const gained = paired.filter(
    (_, index) => (headRates[index] ?? 0) > (baseRates[index] ?? 0)
  )
  const lost = paired.filter(
    (_, index) => (headRates[index] ?? 0) < (baseRates[index] ?? 0)
  )
  const alwaysFound = paired.filter(
    (_, index) => (headRates[index] ?? 0) === 1 && (baseRates[index] ?? 0) === 1
  ).length
  const neverFound = paired.filter(
    (_, index) => (headRates[index] ?? 0) === 0 && (baseRates[index] ?? 0) === 0
  ).length

  const discordantCount = gained.length + lost.length
  const pValue = exactTwoSidedSignTestPValue(gained.length, lost.length)

  return {
    expectationCount: paired.length,
    baseRecall: mean(baseRates),
    headRecall: mean(headRates),
    delta: mean(differences),
    gained,
    lost,
    alwaysFound,
    neverFound,
    concordant: paired.length - discordantCount,
    discordantCount,
    pValue,
    pValueMethod: pValue === undefined ? undefined : PAIRED_SIGNIFICANCE_TEST,
    ci95: bootstrapInterval(differences),
    unpairedExpectations
  }
}

export const parseEvalReport = (value: unknown): EvalReport =>
  EvalReportSchema.parse(value)
