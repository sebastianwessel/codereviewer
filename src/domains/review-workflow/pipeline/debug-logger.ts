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
