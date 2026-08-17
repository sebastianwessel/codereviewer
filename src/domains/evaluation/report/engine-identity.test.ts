import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  findEngineCheckoutRoot,
  readEngineIdentity,
  readRunningEngineIdentity,
  ENGINE_COMMIT_UNKNOWN,
  engineCommitArgs,
  engineWorkingTreeArgs
} from './engine-identity.js'
import type { CorpusGitCommandRunner } from '../corpus/git-corpus-plumbing.js'

const scriptedGit = (
  responses: Readonly<Record<string, string | Error>>
): CorpusGitCommandRunner => {
  return async ({ args }) => {
    const key = args.join(' ')
    const response = responses[key]

    if (response === undefined) {
      throw new Error(`unscripted git invocation: ${key}`)
    }

    if (response instanceof Error) {
      throw response
    }

    return response
  }
}

const commitKey = engineCommitArgs().join(' ')
const statusKey = engineWorkingTreeArgs().join(' ')

describe('engine identity', () => {
  test('reads the commit and reports a clean working tree', async () => {
    expect(
      await readEngineIdentity({
        repositoryRoot: '/repo',
        runGit: scriptedGit({ [commitKey]: 'c3c0c3d\n', [statusKey]: '\n' })
      })
    ).toEqual({ commit: 'c3c0c3d', workingTreeClean: true })
  })

  // A number produced by uncommitted code is not reproducible from the commit it
  // names, and a report that named the commit alone would say it is.
  test('reports a dirty working tree rather than the commit alone', async () => {
    expect(
      await readEngineIdentity({
        repositoryRoot: '/repo',
        runGit: scriptedGit({
          [commitKey]: 'c3c0c3d\n',
          [statusKey]: ' M src/index.ts\n'
        })
      })
    ).toEqual({ commit: 'c3c0c3d', workingTreeClean: false })
  })

  test('an unreadable commit is unknown, never omitted', async () => {
    expect(
      await readEngineIdentity({
        repositoryRoot: '/repo',
        runGit: scriptedGit({ [commitKey]: new Error('not a git repository') })
      })
    ).toEqual({ commit: ENGINE_COMMIT_UNKNOWN })
  })

  // "The commit is known and the cleanliness is not" is a third state, and it
  // must not collapse into either of the other two.
  test('an unreadable status leaves cleanliness absent rather than claiming clean', async () => {
    const identity = await readEngineIdentity({
      repositoryRoot: '/repo',
      runGit: scriptedGit({
        [commitKey]: 'c3c0c3d\n',
        [statusKey]: new Error('status failed')
      })
    })

    expect(identity.commit).toBe('c3c0c3d')
    expect(identity).not.toHaveProperty('workingTreeClean')
  })

  test('an empty commit answer is unknown rather than an empty string', async () => {
    expect(
      await readEngineIdentity({
        repositoryRoot: '/repo',
        runGit: scriptedGit({ [commitKey]: '\n', [statusKey]: '' })
      })
    ).toMatchObject({ commit: ENGINE_COMMIT_UNKNOWN })
  })
})

const createTempDir = async (): Promise<string> => {
  const directory = path.join(tmpdir(), `codereviewer-engine-${crypto.randomUUID()}`)
  await mkdir(directory, { recursive: true })
  return directory
}

describe('running engine identity', () => {
  // THE DEFECT THIS REPLACED: `eval run`, `eval impact` and `eval intent` read the
  // identity with `{ repositoryRoot: options.cwd }`, so a run launched from any
  // directory other than the engine checkout stamped THAT directory's commit onto
  // a report describing this build. Git must be asked about the engine's own
  // checkout, whatever the caller's working directory is.
  test('asks git about the engine checkout, not the working directory', async () => {
    const invocations: string[] = []
    const identity = await readRunningEngineIdentity({
      findCheckoutRoot: async () => '/engine-checkout',
      runGit: async ({ args, cwd }) => {
        invocations.push(cwd)

        return args.join(' ') === commitKey ? 'c3c0c3d\n' : ''
      }
    })

    expect(identity).toEqual({ commit: 'c3c0c3d', workingTreeClean: true })
    expect(invocations).toEqual(['/engine-checkout', '/engine-checkout'])
  })

  // An npm-installed engine ships no checkout. `unknown` is the honest answer and
  // it must be reached WITHOUT running git: git started in a directory with no
  // repository walks upwards by itself and would answer with whatever repository
  // it found first — the consumer's — which is the failure being fixed, not a
  // fallback for it.
  test('answers unknown without invoking git when there is no engine checkout', async () => {
    let gitInvoked = false

    expect(
      await readRunningEngineIdentity({
        findCheckoutRoot: async () => undefined,
        runGit: async () => {
          gitInvoked = true

          return ''
        }
      })
    ).toEqual({ commit: ENGINE_COMMIT_UNKNOWN })
    expect(gitInvoked).toBe(false)
  })
})

describe('engine checkout resolution', () => {
  // Both layouts this code actually runs in — `src/` under tsx and the compiled
  // `dist/` — sit inside the checkout, so resolving from the module's own
  // location finds this repository no matter where the CLI was invoked from.
  test('resolves the checkout that contains this module', async () => {
    const repositoryRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../..'
    )

    expect(await findEngineCheckoutRoot()).toBe(repositoryRoot)
  })

  // THE STOP THAT KEEPS THE FIX FROM REINTRODUCING THE BUG. Installed from npm,
  // the engine lives under a consumer's `node_modules`, and an unguarded walk
  // upwards would sail past the package and report the CONSUMER's commit — the
  // same wrong answer as before, but now dressed as a real object name.
  test('stops at a node_modules boundary instead of reporting the consumer checkout', async () => {
    const consumerRoot = await createTempDir()

    try {
      const installedDist = path.join(
        consumerRoot,
        'node_modules/@sebastianwessel/codereviewer/dist/domains/evaluation/report'
      )
      await mkdir(path.join(consumerRoot, '.git'), { recursive: true })
      await mkdir(installedDist, { recursive: true })

      expect(
        await findEngineCheckoutRoot({ startDirectory: installedDist })
      ).toBeUndefined()
    } finally {
      await rm(consumerRoot, { recursive: true, force: true })
    }
  })

  // In a git worktree or a submodule `.git` is a FILE pointing at the real git
  // directory. Both are checkouts with a HEAD worth recording, so the probe must
  // not require a directory.
  test('accepts a .git file, as a worktree and a submodule have', async () => {
    const worktreeRoot = await createTempDir()

    try {
      const moduleDirectory = path.join(worktreeRoot, 'dist/domains/evaluation/report')
      await mkdir(moduleDirectory, { recursive: true })
      await writeFile(path.join(worktreeRoot, '.git'), 'gitdir: /elsewhere/.git/worktrees/x\n')

      expect(await findEngineCheckoutRoot({ startDirectory: moduleDirectory })).toBe(
        worktreeRoot
      )
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true })
    }
  })

  test('answers undefined when no ancestor holds a checkout', async () => {
    const isolatedRoot = await createTempDir()

    try {
      const moduleDirectory = path.join(isolatedRoot, 'dist/domains')
      await mkdir(moduleDirectory, { recursive: true })

      expect(
        await findEngineCheckoutRoot({ startDirectory: moduleDirectory })
      ).toBeUndefined()
    } finally {
      await rm(isolatedRoot, { recursive: true, force: true })
    }
  })
})
