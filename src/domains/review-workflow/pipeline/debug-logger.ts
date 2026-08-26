/**
 * The only logging capability the workflow stages use.
 *
 * Narrow and duck-typed on purpose: it does not require callers — least of all
 * tests, which have no interest in one — to thread a full `@purista/harness`
 * `Logger` through every stage. Declared once because four stages had written out
 * the identical shape under four different names.
 */
export type DebugLogger = {
  readonly debug: (
    message: string,
    metadata?: Readonly<Record<string, unknown>>
  ) => void
}

/**
 * A logger that can also report something an operator is meant to SEE.
 *
 * `debug` is the right level for progress a reader only wants when they went
 * looking for it. It is the wrong level for a failure: a run whose tasks failed
 * emitted its per-task detail — which task, on which worker, with which error
 * code — only at `debug`, so an operator running at `warn` got no line at all
 * for it. Required rather than optional, so a stage that needs to report a
 * failure cannot be handed a logger that silently cannot.
 */
export type WorkflowLogger = DebugLogger & {
  readonly warn: (
    message: string,
    metadata?: Readonly<Record<string, unknown>>
  ) => void
}
