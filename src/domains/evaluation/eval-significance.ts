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
// The unit is one expectation (`caseId#expectedIndex`), not one run.

export type ExpectationKey = string

export type ArmOutcomes = {
  readonly runCount: number
  // Fraction of this arm's runs in which the expectation was matched. Binary when
  // the arm has one run.
  readonly hitRateByExpectation: ReadonlyMap<ExpectationKey, number>
}

export const expectationKey = (
  caseId: string,
  expectedIndex: number
): ExpectationKey => `${caseId}#${expectedIndex}`

// An expectation counts as found in a run when the matcher bound an admitted
// finding to it. Artifact-only and inconclusive outcomes are NOT matches, which
// keeps this consistent with how `recall` is defined.
const matchedKeysIn = (report: EvalReport): ReadonlySet<ExpectationKey> =>
  new Set(
    report.caseResults.flatMap((caseResult) =>
      caseResult.matchedFindings.map((match) =>
        expectationKey(caseResult.caseId, match.expectedIndex)
      )
    )
  )

const expectedKeysIn = (report: EvalReport): readonly ExpectationKey[] =>
  report.caseResults.flatMap((caseResult) =>
    caseResult.expectedFindings.map((expected) =>
      expectationKey(caseResult.caseId, expected.expectedIndex)
    )
  )

export const collectArmOutcomes = (
  reports: readonly EvalReport[]
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

  // Same refusal, one layer down: a shared metrics version only proves every
  // report computed its numbers the same WAY. Pooling reports scored against
  // DIFFERENT answer keys would silently average together runs that were never
  // measuring the same thing -- the same failure mode `metricsVersion`
  // mismatches already guard against, reusing that pattern rather than a
  // second one.
  const answerKeyDigests = [
    ...new Set(reports.map((report) => report.provenance.answerKeyDigest))
  ]

  if (answerKeyDigests.length > 1) {
    throw new Error(
      `Refusing to pool evaluation runs scored against different answer keys: digests ${answerKeyDigests.join(', ')}.`
    )
  }

  const hits = new Map<ExpectationKey, number>()

  for (const report of reports) {
    const matched = matchedKeysIn(report)

    for (const key of expectedKeysIn(report)) {
      hits.set(key, (hits.get(key) ?? 0) + (matched.has(key) ? 1 : 0))
    }
  }

  const runCount = reports.length
  const hitRateByExpectation = new Map<ExpectationKey, number>()

  for (const [key, hitCount] of hits) {
    hitRateByExpectation.set(key, runCount === 0 ? 0 : hitCount / runCount)
  }

  return { runCount, hitRateByExpectation }
}

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
  readonly discordantCount: number
  // Normal approximation to McNemar's statistic over the discordant expectations.
  // Undefined when nothing is discordant, because the test is then undefined
  // rather than significant.
  readonly z: number | undefined
  readonly pValue: number | undefined
  readonly ci95: readonly [number, number]
  // Expectations only one arm scored. A non-empty list means the arms were run
  // against different answer keys and the comparison is not valid.
  readonly unpairedExpectations: readonly ExpectationKey[]
}

const mean = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length

// Abramowitz-Stegun 7.1.26 error function; enough precision for a reported p.
const erf = (value: number): number => {
  const sign = value < 0 ? -1 : 1
  const absolute = Math.abs(value)
  const t = 1 / (1 + 0.3275911 * absolute)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-absolute * absolute)

  return sign * y
}

const twoSidedPValue = (z: number): number =>
  Math.min(1, 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2))))

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

export const compareArms = (
  base: ArmOutcomes,
  head: ArmOutcomes
): PairedComparison => {
  const keys = [
    ...new Set([
      ...base.hitRateByExpectation.keys(),
      ...head.hitRateByExpectation.keys()
    ])
  ].sort()
  const unpairedExpectations = keys.filter(
    (key) =>
      !base.hitRateByExpectation.has(key) || !head.hitRateByExpectation.has(key)
  )
  const paired = keys.filter((key) => !unpairedExpectations.includes(key))

  const baseRates = paired.map((key) => base.hitRateByExpectation.get(key) ?? 0)
  const headRates = paired.map((key) => head.hitRateByExpectation.get(key) ?? 0)
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
  const z =
    discordantCount === 0
      ? undefined
      : (gained.length - lost.length) / Math.sqrt(discordantCount)

  return {
    expectationCount: paired.length,
    baseRecall: mean(baseRates),
    headRecall: mean(headRates),
    delta: mean(differences),
    gained,
    lost,
    alwaysFound,
    neverFound,
    discordantCount,
    z,
    pValue: z === undefined ? undefined : twoSidedPValue(z),
    ci95: bootstrapInterval(differences),
    unpairedExpectations
  }
}

export const parseEvalReport = (value: unknown): EvalReport =>
  EvalReportSchema.parse(value)
