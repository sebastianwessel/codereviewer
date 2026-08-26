import { referencedDefinitionBounds } from './referenced-definitions.js'

// The user-facing half of the referenced-definition counters.
//
// `referenced-definitions.ts` already measured the omission and said why it must
// be reported: "a run that silently drops context looks identical to one that had
// none to add". `assembly-state.ts` then disclosed it through `logger.warn` — and
// `observability.logging.level` defaults to `'silent'`, where `createReviewLogger`
// returns a no-op logger. So on a DEFAULT run the deliberate disclosure emitted
// nothing at all, and the counters' own measurement says the caps bind on roughly
// half of TypeScript/JavaScript changed files.
//
// These strings are the report channel for the same two counts. They are built
// here rather than in `assembly-state.ts` so the run's warning text is a pure
// function of two numbers — testable without a logger, an observability recorder
// or a filesystem — and so the log line and the report line cannot drift apart
// silently: both stages read this module's counts, and only one of them can be
// switched off by configuration.
//
// The caps are interpolated from `referencedDefinitionBounds` rather than written
// out, because a warning that names a limit the engine no longer applies sends a
// reader to the wrong knob.

export const referencedDefinitionContextWarnings = (input: {
  readonly droppedCount: number
  readonly unreadableCount: number
}): readonly string[] => [
  // Only when it actually happened: a warning that fires on every run is one
  // nobody reads, and zero dropped dependencies is the ordinary shape of a small
  // change.
  ...(input.droppedCount > 0
    ? [
        `Referenced-definition context was capped: ${input.droppedCount} imported dependency file(s) resolved but were not shown to the reviewer, because this run's per-task dependency-digest caps (at most ${referencedDefinitionBounds.maxFiles} files, ${referencedDefinitionBounds.totalByteBudget} bytes total, ${referencedDefinitionBounds.perFileByteBudget} bytes per file) were already full. Findings about calls into those files were reasoned about without their definitions.`
      ]
    : []),
  // Kept as its own message rather than added to the count above, for the reason
  // `assembly-state.ts` states at length: both end with context the reviewer never
  // saw, but only one of them is this engine's caps binding. Saying "capped" about
  // a file that vanished or could not be opened points the reader at a knob that
  // would not have helped.
  ...(input.unreadableCount > 0
    ? [
        `Referenced-definition dependencies were unreadable: ${input.unreadableCount} imported dependency file(s) resolved and then could not be read, so they were not shown to the reviewer. This is not the caps binding — check that those files exist and are readable by the account running the review.`
      ]
    : [])
]
