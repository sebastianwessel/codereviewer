// False-positive bait: a shallow reviewer may flag the `== null` comparison as a
// loose-equality bug, but `== null` is the correct, intentional idiom for
// catching both null and undefined. Reading the file grounds the fix lane's
// judgment: there is no defect here, so the lane should judge `false-positive`
// and produce no fix.
export const isMissing = (value: unknown): boolean => {
  return value == null
}
