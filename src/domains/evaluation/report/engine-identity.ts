// WHICH ENGINE PRODUCED A NUMBER.
//
// This repository has already had to void published figures because nobody could
// say which build produced them: every evaluation before 2026-08-01 ran an
// unpinned engine, and the scorers now refuse to pool runs whose engine identity
// disagrees. A rate is a property of a build and a model, not of a corpus.
//
// Two facts are recorded, and the second is the one people forget: the commit, and
// whether the working tree was CLEAN. A number produced by uncommitted code is not
// reproducible from the commit it names, and reporting the commit alone would say
// it is.
//
// Failure to read either is `unknown`, never a guess and never an omission. A
// report with no engine field would silently be poolable with anything.
//
// WHY A GIT CALL LIVES IN `evaluation`, AND WHAT IS OWED.
//
// Spec 01's ownership table does not list git access for `evaluation`, and gives
// "Git refs" to `repository-intake`. This file, and `corpus/`'s
// `CorpusGitCommandRunner`, are the exception, recorded rather than normalised.
//
// They are not the same git that `repository-intake` owns. `repository-intake`
// reads the repository UNDER REVIEW, at the refs a run was pointed at. These two
// read something else entirely: the identity of the ENGINE's own checkout, and
// upstream corpus checkouts a hydration script clones. Routing them through
// `repository-intake` would widen that domain from "the repo we are reviewing"
// to "any repo", which is a larger change to the ownership model than the
// problem justifies and is a decision for the spec, not for a refactor.
//
// So this stays here under a recorded divergence (spec 01, *Known Divergence:
// The Evaluation Harness's Git Seam*) until the spec either grants `evaluation`
// its own bounded git seam or names another owner. Do not read its presence as
// permission for other evaluation modules to shell out.

import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { CorpusGitCommandRunner } from '../corpus/git-corpus-plumbing.js'

const execFileAsync = promisify(execFile)

export const ENGINE_COMMIT_UNKNOWN = 'unknown'

export type EngineIdentity = {
  readonly commit: string
  // Absent when it could not be determined, which is a different statement from
  // "clean".
  readonly workingTreeClean?: boolean
}

const defaultGitRunner: CorpusGitCommandRunner = async ({ args, cwd }) => {
  const { stdout } = await execFileAsync('git', [...args], {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  })

  return stdout
}

export const engineCommitArgs = (): readonly string[] => [
  'rev-parse',
  '--verify',
  'HEAD'
]

export const engineWorkingTreeArgs = (): readonly string[] => [
  'status',
  '--porcelain'
]

export const readEngineIdentity = async (input: {
  readonly repositoryRoot: string
  readonly runGit?: CorpusGitCommandRunner
}): Promise<EngineIdentity> => {
  const runGit = input.runGit ?? defaultGitRunner
  let commit = ENGINE_COMMIT_UNKNOWN

  try {
    commit =
      (
        await runGit({ args: engineCommitArgs(), cwd: input.repositoryRoot })
      ).trim() || ENGINE_COMMIT_UNKNOWN
  } catch {
    return { commit: ENGINE_COMMIT_UNKNOWN }
  }

  try {
    const status = await runGit({
      args: engineWorkingTreeArgs(),
      cwd: input.repositoryRoot
    })

    return { commit, workingTreeClean: status.trim().length === 0 }
  } catch {
    // The commit is known and the cleanliness is not. Saying so beats claiming
    // either that the tree was clean or that the commit is unknown.
    return { commit }
  }
}

// WHERE THE ENGINE'S OWN CHECKOUT IS — WHICH IS NOT WHEREVER THE COMMAND WAS RUN.
//
// The three commands that stamp this field (`eval run`, `eval impact`, `eval
// intent`) each passed `options.cwd`, the directory the operator invoked the CLI
// from. In this repository that happens to be the engine checkout, so the value
// was right; run against a corpus in any other directory it stamped THAT
// directory's commit — some unrelated repository's HEAD — onto a report
// describing THIS engine's behaviour. A field whose entire purpose is to say
// which build produced a number cannot be read from a location the number does
// not depend on.
//
// So the checkout is located from this module's own URL. That is stable across
// the two layouts the code actually runs in: `src/` under `tsx` and the compiled
// `dist/`, both of which sit inside the checkout when there is one.
//
// THE `node_modules` STOP IS LOAD-BEARING. Installed from npm this module lives
// at `<consumer>/node_modules/@sebastianwessel/codereviewer/dist/...`, and an
// unguarded walk upwards would sail past the package and find the CONSUMER's
// `.git` — reintroducing the exact defect one directory further out, and more
// convincingly, because the answer would look like a real commit. Halting at the
// `node_modules` boundary means an npm-installed run reports `unknown`, which is
// the truth: a published tarball ships no checkout, so there is no commit to name.
//
// `.git` is probed with `stat` rather than tested for directory-ness because in a
// git worktree or a submodule it is a FILE pointing at the real git directory,
// and both are checkouts whose HEAD is worth recording.
const engineModuleDirectory = path.dirname(fileURLToPath(import.meta.url))

const containsGitMarker = async (directory: string): Promise<boolean> => {
  try {
    await stat(path.join(directory, '.git'))

    return true
  } catch {
    // Absent, unreadable, or denied — all of them mean "cannot claim a checkout
    // here", and none of them may fail a run that has already been paid for.
    return false
  }
}

/**
 * The root of the engine's own git checkout, or `undefined` when this build does
 * not run from one (an npm install, a copied `dist/`, a tarball).
 *
 * `undefined` is a first-class answer, not a failure: the callers turn it into
 * the `unknown` commit that the pooling guard already treats as its own identity.
 */
export const findEngineCheckoutRoot = async (
  input: { readonly startDirectory?: string } = {}
): Promise<string | undefined> => {
  let currentDirectory = input.startDirectory ?? engineModuleDirectory

  while (true) {
    if (path.basename(currentDirectory) === 'node_modules') {
      return undefined
    }

    if (await containsGitMarker(currentDirectory)) {
      return currentDirectory
    }

    const parentDirectory = path.dirname(currentDirectory)

    if (parentDirectory === currentDirectory) {
      return undefined
    }

    currentDirectory = parentDirectory
  }
}

/**
 * The identity of the build that is executing, read from the engine's own
 * checkout rather than from the caller's working directory.
 *
 * This is what `eval run`, `eval impact` and `eval intent` stamp. It never
 * throws, for the same reason `readEngineIdentity` does not: it is read after a
 * run has already spent money, and an unreadable identity must degrade to
 * `unknown`, never destroy the run's results.
 */
export const readRunningEngineIdentity = async (
  input: {
    readonly runGit?: CorpusGitCommandRunner
    readonly findCheckoutRoot?: () => Promise<string | undefined>
  } = {}
): Promise<EngineIdentity> => {
  const checkoutRoot = await (input.findCheckoutRoot ?? findEngineCheckoutRoot)()

  if (checkoutRoot === undefined) {
    // No git call at all. Running `git` from a directory with no checkout would
    // let git walk upwards on its own and answer with whatever repository it
    // found first, which is the failure this function exists to prevent.
    return { commit: ENGINE_COMMIT_UNKNOWN }
  }

  return readEngineIdentity({
    repositoryRoot: checkoutRoot,
    ...(input.runGit === undefined ? {} : { runGit: input.runGit })
  })
}
