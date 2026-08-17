// The bar an exemption declared inside a document has to clear.
//
// Two checkers let a document opt out of a check by declaring why nothing can
// check it — `artifact-example-checker.ts` with a `no-contract <reason>` fence
// tag, `config-default-table-checker.ts` with a `no-literal-default` or
// `covers-subtree` comment in the row. Both require a reason, and both required
// it to be at least this long, in two separately declared constants; the second
// one's comment said the length was the first one's, which is a threshold
// documenting its own drift risk rather than avoiding it.
//
// A reason short enough to be a shrug is not a reason. `no-contract x` would make
// the escape hatch a silent skip list with extra characters, which is exactly
// what it must not become.
export const minimumExemptionReasonLength = 20
