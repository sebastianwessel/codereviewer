import { describe, expect, test } from 'vitest'
import {
  createRunContext,
  createSharedChangedFileReader,
  createSharedGitRunner
} from './run-context.js'
import { CodeReviewerConfigSchema } from '../../shared/contracts/index.js'

const config = CodeReviewerConfigSchema.parse({})

describe('createSharedGitRunner', () => {
  test('runs one subprocess for a command two stages both ask for', async () => {
    const calls: string[][] = []
    const runGit = createSharedGitRunner(async (args) => {
      calls.push([...args])

      return 'merged'
    })

    const [first, second] = await Promise.all([
      runGit(['merge-base', 'main', 'HEAD'], { cwd: '/repo' }),
      runGit(['merge-base', 'main', 'HEAD'], { cwd: '/repo' })
    ])

    expect(first).toBe('merged')
    expect(second).toBe('merged')
    expect(calls).toHaveLength(1)
  })

  test('a different command is still its own subprocess', async () => {
    const calls: string[][] = []
    const runGit = createSharedGitRunner(async (args) => {
      calls.push([...args])

      return args.join(' ')
    })

    await runGit(['diff', '--name-status'], { cwd: '/repo' })
    await runGit(['diff', '--unified=0'], { cwd: '/repo' })

    expect(calls).toHaveLength(2)
  })

  test('the same command in a different root is a different question', async () => {
    let callCount = 0
    const runGit = createSharedGitRunner(async () => {
      callCount += 1

      return 'out'
    })

    await runGit(['status'], { cwd: '/repo-a' })
    await runGit(['status'], { cwd: '/repo-b' })

    expect(callCount).toBe(2)
  })

  // A cached rejection would turn one flaky subprocess into an identical failure
  // reported by every stage, which reads as a finding about the repository.
  test('a failure is retried rather than replayed to every later caller', async () => {
    let callCount = 0
    const runGit = createSharedGitRunner(async () => {
      callCount += 1

      if (callCount === 1) {
        throw new Error('transient')
      }

      return 'recovered'
    })

    await expect(runGit(['status'], { cwd: '/repo' })).rejects.toThrow(
      'transient'
    )
    await expect(runGit(['status'], { cwd: '/repo' })).resolves.toBe('recovered')
    expect(callCount).toBe(2)
  })
})

describe('createSharedChangedFileReader', () => {
  test('reads a file once however many stages ask for it', async () => {
    const reads: string[] = []
    const read = createSharedChangedFileReader(async (path) => {
      reads.push(path)

      return 'contents'
    })

    await Promise.all([read('src/app.ts'), read('src/app.ts'), read('src/app.ts')])

    expect(reads).toEqual(['src/app.ts'])
  })

  // Unlike a rejection, this is a fact about the change every stage would derive
  // identically, so it is worth keeping.
  test('an unreadable file stays unreadable without a second syscall', async () => {
    let callCount = 0
    const read = createSharedChangedFileReader(async () => {
      callCount += 1

      return undefined
    })

    expect(await read('deleted.ts')).toBeUndefined()
    expect(await read('deleted.ts')).toBeUndefined()
    expect(callCount).toBe(1)
  })
})

describe('createRunContext', () => {
  test('shares both primitives across the stages that take it', async () => {
    let gitCalls = 0
    let fileReads = 0
    const context = createRunContext({
      repositoryRoot: '/repo',
      config,
      runGit: async () => {
        gitCalls += 1

        return 'out'
      },
      readChangedFile: async () => {
        fileReads += 1

        return 'contents'
      }
    })

    await context.runGit(['diff'], { cwd: '/repo' })
    await context.runGit(['diff'], { cwd: '/repo' })
    await context.readChangedFile('src/app.ts')
    await context.readChangedFile('src/app.ts')

    expect(gitCalls).toBe(1)
    expect(fileReads).toBe(1)
  })
})
