// The shape every CLI command takes and returns.
//
// It lives here rather than in `index.ts` because every command module needs
// both types and `index.ts` imports every command module: declaring them in the
// dispatcher would make each command import back into it, which is a cycle.
// `index.ts` re-exports them, so the package's `./cli` entrypoint is unchanged.
import type { ReviewLogSink } from '../domains/observability/index.js'
import type { ProviderImport } from '../domains/provider-resolution/index.js'

export type CliResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export type CliRunOptions = {
  readonly cwd: string
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly logSink?: ReviewLogSink
  readonly providerImport?: ProviderImport
  // Wall clock used to stamp `generatedAt` on eval reports. Defaults to the
  // real clock in production; tests inject a fixed function so a saved report
  // stays byte-for-byte reproducible without reaching into `Date` deep inside
  // the eval pipeline (the eval runner itself falls back to `new Date()` when
  // no `generatedAt` is supplied at all, so this stays a thin seam rather than
  // a second source of truth for the clock).
  readonly now?: () => Date
  // Monotonic clock used to measure `metrics.elapsedMs` on eval reports: the
  // WHOLE run's wall-clock time (per-case review execution plus judge/
  // plausibility scoring), as opposed to `metrics.durationMs`, which only sums
  // each case's own review time. Deliberately a separate seam from `now`
  // above: `now` stamps a point in time (`generatedAt`), this measures a
  // monotonic duration, and `Date.now()` is not monotonic (it can jump on a
  // clock adjustment), so the two must never share one clock. Defaults to
  // `performance.now` in production; tests inject a deterministic function so
  // a saved report stays byte-for-byte reproducible.
  readonly monotonicNow?: () => number
}
