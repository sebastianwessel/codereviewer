// WHICH METRICS SURVIVE A SCORING-RULE CHANGE — the mechanism, once.
//
// `eval-metrics-versions.ts` records this repository's original reason for the
// mechanism and is still the place the diff reviewer's history is declared. This
// module holds only the part that is not about any particular metric set: an
// ordered list of scoring-rule versions, each declaring what it changed, and the
// derivation of "may these two reports be compared on key K".
//
// It is generic over the comparability key because a second corpus arrived with a
// different metric set. Two corpora that answer different questions must not share
// one version history — a bump to the diff reviewer's matching rules says nothing
// about a change-impact recall figure, and pooling them would make every bump on
// either side refuse comparisons on the other. What they DO share is the rule that
// an undeclared version, or a version declaring an unbounded change, refuses
// everything.
//
// THE FALLBACK IS ALWAYS "NOTHING IS COMPARABLE". Guessing narrow would publish a
// delta measured across a ruler change, which is the failure this exists to
// prevent.

export type MetricsVersionEntry<TKey extends string> = {
  readonly id: string
  // Keys this version changed for IDENTICAL engine output, or `'all'` when the
  // change was broad enough that no key can be assumed to survive it.
  readonly affects: 'all' | readonly TKey[]
  readonly note: string
}

export type MetricsVersionDivergenceOf<TKey extends string> =
  | { readonly kind: 'same' }
  | {
      // No key may be compared. Either a version id is not in the declared
      // history, or a version between the two declared an unbounded change.
      readonly kind: 'all'
      readonly reason: string
    }
  | {
      readonly kind: 'partial'
      readonly affected: ReadonlySet<TKey>
      readonly reason: string
    }

export type MetricComparabilityOf<TKey extends string> = {
  readonly divergence: MetricsVersionDivergenceOf<TKey>
  // The reason this key may not be compared, or `undefined` when it may.
  readonly refusalReason: (key: TKey) => string | undefined
  readonly refusedKeys: (keys: readonly TKey[]) => readonly TKey[]
}

export type MetricsVersionHistory<TKey extends string> = {
  readonly history: readonly MetricsVersionEntry<TKey>[]
  // The rules the current build scores under: the newest declared entry. Derived
  // rather than declared twice, which is what stops a bump from landing without a
  // recorded blast radius.
  readonly currentVersion: string
  readonly metricsAffectedBetween: (
    baseId: string,
    headId: string
  ) => MetricsVersionDivergenceOf<TKey>
  readonly metricComparability: (
    baseVersion: string,
    headVersion: string
  ) => MetricComparabilityOf<TKey>
}

export const createMetricsVersionHistory = <TKey extends string>(
  history: readonly MetricsVersionEntry<TKey>[]
): MetricsVersionHistory<TKey> => {
  const latestEntry = history.at(-1)

  if (latestEntry === undefined) {
    throw new Error('A metrics-version history must not be empty.')
  }

  const indexOfVersion = (id: string): number =>
    history.findIndex((entry) => entry.id === id)

  // Order-insensitive: comparing an older head against a newer base crosses the
  // same boundaries.
  const metricsAffectedBetween = (
    baseId: string,
    headId: string
  ): MetricsVersionDivergenceOf<TKey> => {
    if (baseId === headId) {
      return { kind: 'same' }
    }

    const baseIndex = indexOfVersion(baseId)
    const headIndex = indexOfVersion(headId)

    if (baseIndex === -1 || headIndex === -1) {
      const unknownIds = [
        ...(baseIndex === -1 ? [baseId] : []),
        ...(headIndex === -1 ? [headId] : [])
      ]

      return {
        kind: 'all',
        reason: `metrics version ${unknownIds.join(' and ')} is not in the declared scoring-rule history, so nothing is known about what it changed`
      }
    }

    const lowerIndex = Math.min(baseIndex, headIndex)
    const upperIndex = Math.max(baseIndex, headIndex)
    const crossed = history.slice(lowerIndex + 1, upperIndex + 1)
    const unbounded = crossed.find((entry) => entry.affects === 'all')

    if (unbounded !== undefined) {
      return {
        kind: 'all',
        reason: `scoring rules changed in ${unbounded.id}: ${unbounded.note}`
      }
    }

    const affected = new Set<TKey>()

    for (const entry of crossed) {
      if (entry.affects === 'all') {
        continue
      }

      for (const key of entry.affects) {
        affected.add(key)
      }
    }

    return {
      kind: 'partial',
      affected,
      reason: `scoring rules changed between ${baseId} and ${headId} (${crossed
        .map((entry) => entry.id)
        .join(', ')})`
    }
  }

  const metricComparability = (
    baseVersion: string,
    headVersion: string
  ): MetricComparabilityOf<TKey> => {
    const divergence = metricsAffectedBetween(baseVersion, headVersion)
    const refusalReason = (key: TKey): string | undefined => {
      if (divergence.kind === 'same') {
        return undefined
      }

      if (divergence.kind === 'all') {
        return divergence.reason
      }

      return divergence.affected.has(key) ? divergence.reason : undefined
    }

    return {
      divergence,
      refusalReason,
      refusedKeys: (keys) => keys.filter((key) => refusalReason(key) !== undefined)
    }
  }

  return {
    history,
    currentVersion: latestEntry.id,
    metricsAffectedBetween,
    metricComparability
  }
}
