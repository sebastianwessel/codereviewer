// WHETHER TWO FINISHED RUNS MAY BE POOLED INTO ONE NUMBER.
//
// Pooling is not comparing. `eval compare` puts two arms side by side and prints
// a delta; POOLING merges several runs into a single statistic whose denominator
// they share -- the significance module's per-expectation hit rate, and
// `eval recall-report`'s `k/n` column and its always/never/flaky summary. A
// statistic pooled over runs that were not measuring the same thing is a rate
// over a population that never existed, and nothing downstream can recover the
// fact afterwards.
//
// This decision had TWO implementations and one hole. `eval-significance.ts`
// refused a mixed metrics version and a mixed answer key; `eval-compare.ts`
// refused a mixed judge; and `eval recall-report` -- which pools exactly the same
// per-expectation outcomes the significance module does -- read no provenance at
// all and pooled whatever it was handed. This module is the one owner, and the
// two existing refusals delegate to it rather than restating it.
//
// THE THREE THINGS THAT MUST AGREE, and why each one is not optional:
//
//   - the ANSWER KEY. `caseId#expectedIndex` is a positional address into a
//     case's expected findings. Two runs scored against different keys can put
//     different defects at the same address, so merging their outcomes does not
//     merely blend two rates -- it writes two different expectations into one
//     row. This repository has already published a recall figure (78.8%) that was
//     scored against an answer key that had changed underneath it, with nothing
//     in the artifact revealing it.
//   - the SCORING RULES (`metricsVersion`). A metrics-version bump alters what a
//     metric reports for identical review output, so a pool that spans one
//     measures the ruler.
//   - the JUDGE. The semantic judge is the sole authority on whether an admitted
//     finding IS the expected defect, so "matched" means whatever the judge said.
//     Pooling runs scored by different judges mixes two definitions of a match.
//
// WHAT ABOUT THE ENGINE? It is NOT checked here, and that is a stated gap rather
// than an oversight: `EvalReportProvenanceSchema` records no engine identity, so
// no reader can check one. `eval compare` does not refuse a mixed-engine pool
// either -- it cannot. Spec 06 says so outright ("No scored artifact records
// engine identity today either, and no guard covers it"), and closing it means
// adding a producer field, which is a spec decision and not a reader change.
// `report/engine-identity.ts` reads the fact today for the intent, impact and
// advisory eval reports, which DO carry it; the main eval report does not.
//
// ABSENCE IS AN IDENTITY, NOT A WILDCARD.
//
// 121 of the 516 eval reports on disk in this repository carry neither
// `metricsVersion` nor `provenance` -- they were written before either existed.
// Requiring the fields would re-break archive reading, which is the exact failure
// `eval-recall-view.ts` was written to end. Defaulting them to "matches anything"
// would make a silent archive poolable with every report ever written, which is
// the silent-optimism defect class this repository has fixed seven times.
//
// So absence resolves to its own identity value, `unrecorded`. A report that
// cannot state its answer key therefore refuses to pool with one that can, and
// pools with another report that equally cannot -- because `unrecorded` is the
// same value, not because anything was verified. That is the rule
// `eval-paired-recall-verdict.ts` already applies when it maps an absent digest
// to `'unrecorded'` before handing an arm to the pooling guard, and the rule
// `eval-compare.ts` already applies to an unrecorded judge. It is deliberately
// permissive in exactly one place, so `poolIdentityWarnings` says so out loud
// there.
//
// A POOL OF ONE IS NOT A POOL. One report is rendered exactly as before: nothing
// is merged, so there is nothing to disagree about, and every one of those 121
// archives still opens on its own.

export type PoolIdentityProvenance = {
  readonly answerKeyDigest?: string | undefined
  readonly modelName?: string | undefined
  readonly judgeModelName?: string | undefined
}

export type PoolCandidate = {
  // What to name in a refusal -- a report path, for a CLI that was handed
  // several. Omitted by callers that hold no name for the run (the significance
  // module's arm is a list of parsed reports), and then the refusal names the
  // conflicting VALUES alone.
  readonly label?: string | undefined
  readonly metricsVersion?: string | undefined
  readonly provenance?: PoolIdentityProvenance | undefined
}

// The one spelling of "the report did not say", shared with
// `eval-paired-recall-verdict.ts`, which already writes this literal when it maps
// an archived report into an arm.
export const POOL_IDENTITY_UNRECORDED = 'unrecorded'

/**
 * The judge a report was scored by.
 *
 * A report written before `evaluation.judgeModel` became pinnable records no
 * `judgeModelName`, and on those runs the judge WAS the reviewer's model — so
 * `modelName` is the correct fallback identity rather than an unknown. That keeps
 * two archived reports poolable with each other, and keeps an archived report
 * poolable with a pinned one naming the same model, while still refusing a
 * genuine mismatch.
 */
export const judgeIdentityOf = (
  provenance: PoolIdentityProvenance | undefined
): string =>
  provenance?.judgeModelName ??
  provenance?.modelName ??
  POOL_IDENTITY_UNRECORDED

type PoolIdentityDimension = {
  readonly identityOf: (candidate: PoolCandidate) => string
  // Reads as `Refusing to pool evaluation runs <refusal>: <values>.` The
  // "different rules" and "different answer keys" wordings are load-bearing: the
  // significance module's tests match on them, and they are the words spec 06
  // uses.
  readonly refusal: string
  // What a pool in which NOBODY stated the value cannot rule out.
  readonly unrecordedRisk: string
}

const POOL_IDENTITY_DIMENSIONS: readonly PoolIdentityDimension[] = [
  {
    identityOf: (candidate) =>
      candidate.metricsVersion ?? POOL_IDENTITY_UNRECORDED,
    refusal: 'scored by different rules: metrics versions',
    unrecordedRisk:
      'records the scoring rules its numbers were computed under (metricsVersion), so pooling them cannot rule out that a metrics-version change moved what a match means'
  },
  {
    identityOf: (candidate) =>
      candidate.provenance?.answerKeyDigest ?? POOL_IDENTITY_UNRECORDED,
    refusal: 'scored against different answer keys: digests',
    unrecordedRisk:
      'records the answer key it was scored against, so pooling them cannot rule out that one expectation address holds a different expected finding in each report'
  },
  {
    identityOf: (candidate) => judgeIdentityOf(candidate.provenance),
    refusal: 'scored by different judges: judge models',
    unrecordedRisk:
      'names the model its semantic judge scored with, so pooling them cannot rule out that "matched" was decided by two different scorers'
  }
]

// Labels grouped under the identity they stated, in first-seen order so a
// refusal reads in the order the caller listed its reports.
const labelsByIdentity = (
  candidates: readonly PoolCandidate[],
  identityOf: (candidate: PoolCandidate) => string
): ReadonlyMap<string, readonly string[]> => {
  const grouped = new Map<string, string[]>()

  for (const candidate of candidates) {
    const identity = identityOf(candidate)
    const labels = grouped.get(identity) ?? []

    if (candidate.label !== undefined) {
      labels.push(candidate.label)
    }

    grouped.set(identity, labels)
  }

  return grouped
}

const describeIdentities = (
  grouped: ReadonlyMap<string, readonly string[]>
): string =>
  [...grouped.entries()]
    .map(([identity, labels]) =>
      labels.length === 0 ? identity : `${identity} (${labels.join(', ')})`
    )
    .join(', ')

/**
 * Every reason these runs may not be pooled into one statistic, or an empty list
 * when they may.
 *
 * Fewer than two candidates is never a refusal: nothing is being merged.
 */
export const poolIdentityRefusals = (
  candidates: readonly PoolCandidate[]
): readonly string[] => {
  if (candidates.length < 2) {
    return []
  }

  return POOL_IDENTITY_DIMENSIONS.flatMap((dimension) => {
    const grouped = labelsByIdentity(candidates, dimension.identityOf)

    return grouped.size > 1
      ? [
          `Refusing to pool evaluation runs ${dimension.refusal} ${describeIdentities(grouped)}.`
        ]
      : []
  })
}

/**
 * The pools this module lets through on the strength of a shared silence.
 *
 * When no report states a dimension they all resolve to `unrecorded`, agree, and
 * pool — which is a decision about archive readability, not evidence that they
 * agree. Saying so is the price of that permissiveness; staying quiet is how a
 * pool of archives from two different builds becomes one number.
 */
export const poolIdentityWarnings = (
  candidates: readonly PoolCandidate[]
): readonly string[] => {
  if (candidates.length < 2) {
    return []
  }

  return POOL_IDENTITY_DIMENSIONS.flatMap((dimension) =>
    candidates.every(
      (candidate) =>
        dimension.identityOf(candidate) === POOL_IDENTITY_UNRECORDED
    )
      ? [
          `Warning: none of these reports ${dimension.unrecordedRisk}. Absent means not recorded, never that they agree.`
        ]
      : []
  )
}
