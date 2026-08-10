// ONE run, ONE set of shared work.
//
// The review, intent and impact stages each answer a different question about the
// same change, and each used to recompute the whole foundation to do it: three
// `git merge-base`/`diff --name-status`/`diff` subprocess sets, three reads of
// every changed file, two ast-grep extractions over the same sources, two sweeps
// of the external context providers. Run from CI as three separate processes,
// none of it could be shared even in principle.
//
// This module does NOT merge the stages or unify their semantics — that would be
// the dangerous version of the same idea. Impact asks intake for deleted paths and
// the others do not; intent filters its files differently again. Every one of
// those differences is deliberate and stays.
//
// What is shared is strictly the EXPENSIVE PRIMITIVES, through the injection
// seams the lanes already had. A memoized git runner returns the same output for
// the same argv, which is what git itself would do over an unchanging worktree, so
// a stage asking a question another stage already asked gets the recorded answer
// and a stage asking a different question still runs its own command. Identical
// reasoning for file reads and for the AST extraction.
//
// The consequence worth stating: this is behaviour-neutral BY CONSTRUCTION, not by
// review. A memo cannot change what a stage computes, only how often the work
// happens underneath it.
import type { CodeReviewerConfig } from '../../shared/contracts/index.js'
import type { GitCommandRunner } from '../repository-intake/index.js'

export type ChangedFileReader = (path: string) => Promise<string | undefined>

/**
 * Wraps a git runner so identical commands run once per run context.
 *
 * Keyed on the full argv AND the working directory, because the same argv in two
 * roots is two different questions. The in-flight promise is cached rather than
 * its result, so two stages racing the same command share one subprocess instead
 * of starting a second before the first resolves.
 *
 * A REJECTION IS NOT CACHED. A failed git call is re-run for the next caller: a
 * cached failure would turn one transient error into an identical failure for
 * every stage, which reads as a systematic finding about the repository rather
 * than the one flaky subprocess it was.
 */
export const createSharedGitRunner = (
  runGit: GitCommandRunner
): GitCommandRunner => {
  const inFlight = new Map<string, Promise<string>>()

  return async (args, options) => {
    const key = JSON.stringify([options.cwd, ...args])
    const cached = inFlight.get(key)

    if (cached !== undefined) {
      return await cached
    }

    const pending = runGit(args, options)
    inFlight.set(key, pending)

    try {
      return await pending
    } catch (error) {
      inFlight.delete(key)
      throw error
    }
  }
}

/**
 * Wraps a changed-file reader so each path is read once per run context.
 *
 * `undefined` — the reader's "this file could not be read" answer — IS cached,
 * unlike a rejection. It is a fact about the change (a deleted or binary path),
 * every stage would compute the same answer, and re-deriving it per stage buys
 * nothing but syscalls.
 */
export const createSharedChangedFileReader = (
  readChangedFile: ChangedFileReader
): ChangedFileReader => {
  const inFlight = new Map<string, Promise<string | undefined>>()

  return async (path) => {
    const cached = inFlight.get(path)

    if (cached !== undefined) {
      return await cached
    }

    const pending = readChangedFile(path)
    inFlight.set(path, pending)

    try {
      return await pending
    } catch (error) {
      inFlight.delete(path)
      throw error
    }
  }
}

/**
 * The shared foundation for one invocation. Stages take this instead of building
 * their own; the CLI builds exactly one, whether it is running a single stage or
 * all of them.
 */
export type RunContext = {
  readonly repositoryRoot: string
  readonly config: CodeReviewerConfig
  readonly runGit: GitCommandRunner
  readonly readChangedFile: ChangedFileReader
  readonly signal?: AbortSignal
}

export const createRunContext = (input: {
  readonly repositoryRoot: string
  readonly config: CodeReviewerConfig
  readonly runGit: GitCommandRunner
  readonly readChangedFile: ChangedFileReader
  readonly signal?: AbortSignal
}): RunContext => ({
  repositoryRoot: input.repositoryRoot,
  config: input.config,
  runGit: createSharedGitRunner(input.runGit),
  readChangedFile: createSharedChangedFileReader(input.readChangedFile),
  ...(input.signal === undefined ? {} : { signal: input.signal })
})
