import { execFile } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

// The git seam every corpus hydrator shares (spec 01 *Known Divergence: The
// Evaluation Harness's Git Seam*). It reads UPSTREAM repositories a case names,
// never the repository under review, and it is the only place in this domain
// that starts a git process.
//
// It lives apart from any one corpus because three hydrators — spec 17's
// backwards-read fixes, spec 22's forward-read changes and spec 23's local
// history — run the same plumbing against different commits. They used to carry
// a copy each, and the copies had already drifted.

const execFileAsync = promisify(execFile)

// Git diffs of a whole commit can be large; the default 1 MB stdout cap would
// truncate them into invalid patches.
const gitOutputByteCap = 64 * 1024 * 1024

export type CorpusGitCommandRunner = (input: {
  readonly args: readonly string[]
  readonly cwd: string
}) => Promise<string>

export const defaultCorpusGitRunner: CorpusGitCommandRunner = async ({
  args,
  cwd
}) => {
  const { stdout } = await execFileAsync('git', [...args], {
    cwd,
    maxBuffer: gitOutputByteCap,
    // Repository content is untrusted input: never let a hydration run inherit
    // an interactive credential or editor prompt that would hang CI.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  })

  return stdout
}

// A case directory holds the reviewed working tree and, beside it, the git
// directory that must stay out of it.
export const CORPUS_WORK_TREE_DIRECTORY = 'repo'
export const CORPUS_GIT_DIRECTORY = 'git'

// Git argument builders. They are pure so the exact plumbing a case runs can be
// asserted in tests without touching the network.

// A separate git directory keeps `repo/` a clean working tree: only a small
// `.git` pointer file sits beside the sources, so the reviewed fixture root is
// the repository content and nothing else.
export const gitInitArgs = (input: {
  readonly gitDirectory: string
  readonly workTreeDirectory: string
}): readonly string[] => [
  '-c',
  'init.defaultBranch=main',
  'init',
  '--quiet',
  '--separate-git-dir',
  input.gitDirectory,
  input.workTreeDirectory
]

export const gitRemoteArgs = (repositoryUrl: string): readonly string[] => [
  'remote',
  'add',
  'origin',
  repositoryUrl
]

// Checked-out bytes must not depend on the host: line-ending translation would
// shift every expected line range on Windows.
export const gitDisableAutoCrlfArgs = (): readonly string[] => [
  'config',
  'core.autocrlf',
  'false'
]

// Depth 2 is exactly what a case needs: the pinned commit and its parent, which
// is the pair every corpus here reviews whichever way round it reads them.
// Fetching one commit by object name avoids downloading the repository's history.
export const gitFetchArgs = (input: {
  readonly commit: string
}): readonly string[] => [
  'fetch',
  '--quiet',
  '--no-tags',
  '--depth',
  '2',
  'origin',
  input.commit
]

export const gitParentOfArgs = (commit: string): readonly string[] => [
  'rev-parse',
  '--verify',
  `${commit}^`
]

export const gitHeadArgs = (): readonly string[] => [
  'rev-parse',
  '--verify',
  'HEAD'
]

// Takes any commit: spec 17 checks out the fix's PARENT and reads the fix
// backwards, spec 22 checks out the commit that INTRODUCED the change. The
// argument list is the same either way, which is why one helper serves both.
export const gitCheckoutArgs = (commit: string): readonly string[] => [
  '-c',
  'advice.detachedHead=false',
  'checkout',
  '--quiet',
  '--detach',
  '--force',
  commit
]

export const readHeadCommit = async (input: {
  readonly runGit: CorpusGitCommandRunner
  readonly workTreeDirectory: string
}): Promise<string | undefined> => {
  try {
    return (
      await input.runGit({
        args: gitHeadArgs(),
        cwd: input.workTreeDirectory
      })
    ).trim()
  } catch {
    // No git directory, a broken checkout, or an interrupted fetch: all mean the
    // case must be rebuilt, and none of them is worth distinguishing here.
    return undefined
  }
}

// Materialises one case's working tree at `checkoutCommit` and returns the
// reviewed diff.
//
// The orientation is the caller's: which commit is fetched, which is checked
// out, and how the reviewed diff is expressed are all arguments, because that is
// the ONLY thing that differs between the corpora. `caseLabel` is the message
// prefix a corpus identifies its own cases by, so a failure names the case in
// the corpus's own wording.
export const checkoutCorpusCase = async (input: {
  readonly caseLabel: string
  readonly caseDirectory: string
  readonly repositoryUrl: string
  readonly fetchCommit: string
  readonly declaredParentCommit: string
  readonly checkoutCommit: string
  readonly reviewedDiffArgs: readonly string[]
  readonly runGit: CorpusGitCommandRunner
}): Promise<string> => {
  const workTreeDirectory = path.join(
    input.caseDirectory,
    CORPUS_WORK_TREE_DIRECTORY
  )
  const gitDirectory = path.join(input.caseDirectory, CORPUS_GIT_DIRECTORY)

  // Every case is built from an empty directory. `git init` is idempotent but
  // `git remote add` is not, so re-running against leftover material fails with
  // "remote origin already exists" — and a directory left by an interrupted
  // hydration reads as absent rather than stale, because it has neither a
  // resolvable HEAD nor a slice. Rebuilding unconditionally also discards
  // partial fetches, which cannot be trusted to describe the commit they claim.
  await rm(input.caseDirectory, { recursive: true, force: true })
  await mkdir(workTreeDirectory, { recursive: true })
  await input.runGit({
    args: gitInitArgs({ gitDirectory, workTreeDirectory }),
    cwd: input.caseDirectory
  })
  await input.runGit({
    args: gitDisableAutoCrlfArgs(),
    cwd: workTreeDirectory
  })
  await input.runGit({
    args: gitRemoteArgs(input.repositoryUrl),
    cwd: workTreeDirectory
  })
  await input.runGit({
    args: gitFetchArgs({ commit: input.fetchCommit }),
    cwd: workTreeDirectory
  })

  const parentCommit = (
    await input.runGit({
      args: gitParentOfArgs(input.fetchCommit),
      cwd: workTreeDirectory
    })
  ).trim()

  // The manifest's commit pair is ground truth for every expected line range. If
  // upstream history was rewritten, the case must be re-captured, not reviewed.
  if (parentCommit !== input.declaredParentCommit) {
    throw new Error(
      `${input.caseLabel}: upstream parent of ${input.fetchCommit} is ${parentCommit}, but the manifest declares ${input.declaredParentCommit}.`
    )
  }

  await input.runGit({
    args: gitCheckoutArgs(input.checkoutCommit),
    cwd: workTreeDirectory
  })

  const headCommit = await readHeadCommit({
    runGit: input.runGit,
    workTreeDirectory
  })

  if (headCommit !== input.checkoutCommit) {
    throw new Error(
      `${input.caseLabel}: checkout landed on ${headCommit ?? 'an unknown commit'} instead of ${input.checkoutCommit}.`
    )
  }

  return input.runGit({
    args: input.reviewedDiffArgs,
    cwd: workTreeDirectory
  })
}
