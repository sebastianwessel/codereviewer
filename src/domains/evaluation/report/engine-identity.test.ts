import { describe, expect, test } from 'vitest'
import {
  readEngineIdentity,
  ENGINE_COMMIT_UNKNOWN,
  engineCommitArgs,
  engineWorkingTreeArgs
} from './engine-identity.js'
import type { CorpusGitCommandRunner } from '../corpus/real-repo-corpus-hydration.js'

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
