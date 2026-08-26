// The "user-configured exact secret values" spec 07's minimum pattern list ends
// with, held for the process instead of passed per call.
//
// WHY PROCESS STATE, WHICH THIS REPOSITORY OTHERWISE AVOIDS: redaction is
// ambient. `redactText` and `createRedactor()` are called at more than twenty
// production seams — reporters, the admission gate, error normalization,
// refutation evidence, the mediated reader, intake — and none of them takes
// configuration or sits anywhere near the layer that has any. Threading an option
// to all of them would make this capability's correctness a thing every future
// seam has to remember, and the defect being fixed here is precisely a capability
// that shipped wired, typed and unit-tested while no production caller could
// reach it. One writer (`applyConfiguredSecretRedaction`, called where
// configuration and environment meet) and every seam reads it.
//
// The values are SECRETS. They are never logged, never put in an error message,
// and never returned anywhere but into a compiled pattern — the only thing this
// module hands out is the list itself, to the redactor that turns it into
// patterns.
//
// THE BOUND, stated because it is a security capability and a silent bound would
// be the worse defect: this holds ONE policy per process, so it serves one
// configuration at a time. Every shipped entry point satisfies that — the CLI, the
// GitHub pipeline and `eval run` each load one configuration per process. A LIBRARY
// consumer running two reviews concurrently over different repositories in one
// process does not: the second `setConfiguredExactSecrets` replaces the first, and
// the run still in flight would redact against the wrong policy.
//
// Not solved with `AsyncLocalStorage` (the mechanism this repository uses for
// per-task scope elsewhere) because that binds a value to an async context, and
// these seams are reached from contexts the review never established — a reporter
// rendering an artifact after the run, an error normalizer on a rejected promise.
// A partial scope would redact in some places and not others, which is worse than
// a bound that is written down. If a concurrent multi-configuration consumer ever
// exists, this needs a scope that covers every seam, not a wider default here.
let configuredExactSecrets: readonly string[] = []

/**
 * Replaces the process's configured exact secrets.
 *
 * A fresh frozen array every time, so a cached redactor can decide by identity
 * whether the policy it compiled its patterns from is still the current one.
 *
 * An empty list is not a special case, it is the ground state: no exact-secret
 * pattern is compiled at all, which is byte-for-byte the behaviour of every run
 * before this was configurable. Passing `[]` is therefore also how a caller
 * clears a policy rather than a separate "reset" nobody would keep honest.
 */
export const setConfiguredExactSecrets = (
  secrets: readonly string[]
): void => {
  configuredExactSecrets = Object.freeze([...secrets])
}

export const currentConfiguredExactSecrets = (): readonly string[] =>
  configuredExactSecrets
