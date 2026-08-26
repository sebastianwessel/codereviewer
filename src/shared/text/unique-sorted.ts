// Deduplicate and locale-sort a list of strings. Reused wherever a stable,
// duplicate-free ordering of paths/ids is written into a report or contract so
// output is deterministic across runs regardless of input order.
// Accepts any iterable, not just an array, so a caller holding a Set or a
// generator does not have to materialize an array first — and so no caller has a
// reason to re-implement this beside it.
export const uniqueSorted = (values: Iterable<string>): readonly string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right))
