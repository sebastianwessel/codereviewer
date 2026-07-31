// How this capability's two work bounds choose what to keep when they bind.
//
// Both bounds — `maxChangedDeclarations` over the seed declarations and
// `maxPeerFiles` over the sibling files read for peers — used to be a sort
// followed by `slice(0, limit)`. Sorting is what makes a bounded run
// reproducible, so it cannot go; but a path-sorted list sliced at the front is
// not a sample of the change, it is the part of the repository whose paths sort
// first.
//
// Measured on this repository over `HEAD~20..HEAD` — 171 changed files, 100
// changed declarations against a cap of 50 — the prefix landed entirely inside
// `src/cli` and the early `src/domains`, and the run reported ZERO divergences
// while 23 sat in the half the cap had amputated. Raising the cap alone recovered
// all 23. A reader was told the capability had nothing to say about their pull
// request when it had never looked at most of it, and the wider the change the
// more of it went unread — the failure grew with the size of the review.
//
// So a bound that binds now takes an EVENLY SPREAD sample of the whole instead of
// its front, and which mechanism does the spreading depends on how the budget
// compares to the number of groups:
//
//   - budget SMALLER than the group count — one item from each of `limit` groups,
//     the groups picked at a constant stride across the whole group list. Simply
//     interleaving would not do: round one alone would exhaust the budget and the
//     alphabetical amputation would return intact, which is the case this
//     repository is actually in at `HEAD~40..HEAD` (more changed files than the
//     default cap of 50).
//   - budget LARGER than the group count — every group contributes. The budget is
//     shared out one item at a time until it runs out or a group does, so no
//     group can be starved while another has spare quota, and each group's share
//     is then taken at a stride through that group rather than off its front.
//
// The stride is applied to the groups or within a group, never to the interleaved
// sequence: striding across an interleave aliases against the round length and
// re-concentrates the sample on a few groups — with 26 two-item groups and a
// budget of 6 it selects both items of 3 groups and nothing from the other 23.
//
// Every step is an order-preserving function of the caller's stable order, so two
// runs over the same commit select the same items.

// `count` items taken at a constant stride through `items`. Consecutive indices
// differ by `items.length / count >= 1`, so the sample never repeats an item and
// never runs past the end.
const strideSample = <Item>(
  items: readonly Item[],
  count: number
): readonly Item[] => {
  const sampled: Item[] = []

  for (let index = 0; index < count; index += 1) {
    const item = items[Math.floor((index * items.length) / count)]

    if (item !== undefined) {
      sampled.push(item)
    }
  }

  return sampled
}

// The interleaved sequence: one item from each group in turn, in the group order
// the caller supplied and the item order inside each group.
const interleaveGroups = <Item>(
  groups: readonly (readonly Item[])[]
): readonly Item[] => {
  const ordered: Item[] = []
  const depth = Math.max(0, ...groups.map((group) => group.length))

  for (let round = 0; round < depth; round += 1) {
    for (const group of groups) {
      const item = group[round]

      if (item !== undefined) {
        ordered.push(item)
      }
    }
  }

  return ordered
}

// How much of the budget each group gets: handed out a single item at a time,
// round after round, so the shares differ by at most one except where a group ran
// out of items first.
const shareOutBudget = (
  sizes: readonly number[],
  limit: number
): readonly number[] => {
  const quotas = sizes.map(() => 0)
  let remaining = limit

  while (remaining > 0) {
    let progressed = false

    for (const [index, size] of sizes.entries()) {
      if (remaining === 0) {
        break
      }

      if ((quotas[index] ?? 0) < size) {
        quotas[index] = (quotas[index] ?? 0) + 1
        remaining -= 1
        progressed = true
      }
    }

    if (!progressed) {
      break
    }
  }

  return quotas
}

/**
 * Takes up to `limit` items, spread evenly across the groups and across each
 * group.
 *
 * Returns them in selection order rather than sorted: only the caller knows what
 * its output order has to be, and both call sites re-sort.
 */
export const selectSpreadAcrossGroups = <Item>(
  groups: readonly (readonly Item[])[],
  limit: number
): readonly Item[] => {
  if (limit <= 0) {
    return []
  }

  const populated = groups.filter((group) => group.length > 0)
  const total = populated.reduce((sum, group) => sum + group.length, 0)

  if (total <= limit) {
    return interleaveGroups(populated)
  }

  if (populated.length >= limit) {
    return strideSample(populated, limit).map((group) => group[0] as Item)
  }

  const quotas = shareOutBudget(
    populated.map((group) => group.length),
    limit
  )

  return interleaveGroups(
    populated.map((group, index) => strideSample(group, quotas[index] ?? 0))
  )
}

/**
 * Groups items by a key, preserving the order items arrive in within each group
 * and ordering the groups by their key.
 *
 * The key order is what makes the selection above reproducible across runs, and
 * it is applied here rather than left to the caller so the two call sites cannot
 * drift apart on it.
 */
export const groupByKeyInOrder = <Item>(
  items: readonly Item[],
  keyOf: (item: Item) => string
): readonly (readonly Item[])[] => {
  const byKey = new Map<string, Item[]>()

  for (const item of items) {
    const key = keyOf(item)
    const bucket = byKey.get(key) ?? []

    bucket.push(item)
    byKey.set(key, bucket)
  }

  return [...byKey.keys()].sort().map((key) => byKey.get(key) ?? [])
}
