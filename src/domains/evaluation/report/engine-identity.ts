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
