// Deduplicate and locale-sort a list of strings. Reused wherever a stable,
// duplicate-free ordering of paths/ids is written into a report or contract so
// output is deterministic across runs regardless of input order.
export const uniqueSorted = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right))
