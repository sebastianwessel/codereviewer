import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  assertReadOnlyGitArgs,
  collectRepositoryIntake,
  parseGitDiffMaps,
  type GitCommandRunner
} from './index.js'

const createFixtureRepository = async (): Promise<string> => {
  const rootPath = await mkdtemp(path.join(tmpdir(), 'codereviewer-intake-'))

  await mkdir(path.join(rootPath, 'src'), { recursive: true })
  await mkdir(path.join(rootPath, 'dist'), { recursive: true })
  await mkdir(path.join(rootPath, 'bin'), { recursive: true })
  await writeFile(path.join(rootPath, 'src', 'app.ts'), 'value=1\n')
  await writeFile(path.join(rootPath, 'dist', 'generated.js'), 'generated\n')
  await writeFile(path.join(rootPath, 'bin', 'blob.dat'), Buffer.from([0, 1, 2]))
  await writeFile(path.join(rootPath, 'large.txt'), '0123456789')

  return rootPath
}

// Stand-in for the commit `git merge-base` resolves for the fixture refs. The
// diff calls are keyed on this rather than on `main`, which is the whole point
// of the merge-base resolution.
const mergeBaseSha = '9f1c2ab3d4e5f60718293a4b5c6d7e8f90a1b2c3'

const scriptedGitRunner =
  (outputs: Readonly<Record<string, string>>): GitCommandRunner =>
  async (args) => {
    const key = args.join(' ')
    const output = outputs[key]

    if (output === undefined) {
      throw new Error(`Unexpected git command: ${key}`)
    }

    return output
  }

describe('repository intake', () => {
  test('allows only read-only git diff command shapes', () => {
    expect(() =>
      assertReadOnlyGitArgs(['diff', '--name-status', 'main', 'HEAD'])
    ).not.toThrow()
    expect(() =>
      assertReadOnlyGitArgs([
        'diff',
        '--unified=0',
        'main',
        'HEAD',
        '--',
        'src/app.ts'
      ])
    ).not.toThrow()

    expect(() =>
      assertReadOnlyGitArgs(['merge-base', 'main', 'HEAD'])
    ).not.toThrow()

    expect(() => assertReadOnlyGitArgs(['reset', '--hard'])).toThrow(TypeError)
    expect(() => assertReadOnlyGitArgs(['merge', 'main'])).toThrow(TypeError)
    expect(() =>
      assertReadOnlyGitArgs(['merge-base', 'main', 'HEAD', '--all'])
    ).toThrow(TypeError)
    expect(() =>
      assertReadOnlyGitArgs(['merge-base', '-bad', 'HEAD'])
    ).toThrow(expect.objectContaining({ code: 'invalid_git_ref' }))
    expect(() => assertReadOnlyGitArgs(['diff', '--name-status', '-bad', 'HEAD'])).toThrow(
      expect.objectContaining({ code: 'invalid_git_ref' })
    )
    expect(() =>
      assertReadOnlyGitArgs(['diff', '--unified=0', 'main', 'HEAD', 'src/app.ts'])
    ).toThrow(TypeError)
  })

  test('collects changed files, skipped files, and diff maps from a valid git diff', async () => {
    const repositoryRoot = await createFixtureRepository()
    const runGit = scriptedGitRunner({
      'merge-base main HEAD': `${mergeBaseSha}\n`,
      [`diff --name-status ${mergeBaseSha} HEAD`]:
        'M\tsrc/app.ts\nD\tsrc/deleted.ts\nM\tbin/blob.dat\nM\tlarge.txt\nM\tdist/generated.js\n',
      [`diff --unified=0 ${mergeBaseSha} HEAD -- src/app.ts`]:
        'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,0 +1,1 @@\n+export const value = 1\n'
    })

    const intake = await collectRepositoryIntake({
      repositoryRoot,
      baseRef: 'main',
      headRef: 'HEAD',
      excludePatterns: ['dist/**'],
      maxFileBytes: 8,
      runGit
    })

    expect(intake.changedFiles).toEqual([
      expect.objectContaining({
        path: 'src/app.ts',
        status: 'modified',
        sizeBytes: 8
      })
    ])
    expect(intake.skippedFiles).toEqual([
      { path: 'src/deleted.ts', reason: 'deleted' },
      { path: 'bin/blob.dat', reason: 'binary' },
      { path: 'large.txt', reason: 'too-large' },
      { path: 'dist/generated.js', reason: 'excluded' }
    ])
    expect(intake.diffMaps).toEqual([
      {
        path: 'src/app.ts',
        changeKind: 'modified',
        hunks: [
          {
            oldStartLine: 1,
            oldLineCount: 0,
            newStartLine: 1,
            newLineCount: 1
          }
        ]
      }
    ])
  })

  test('includePatterns narrows the reviewed set', async () => {
    const repositoryRoot = await createFixtureRepository()
    const runGit = scriptedGitRunner({
      'merge-base main HEAD': `${mergeBaseSha}\n`,
      [`diff --name-status ${mergeBaseSha} HEAD`]: 'M\tsrc/app.ts\n'
    })

    const intake = await collectRepositoryIntake({
      repositoryRoot,
      baseRef: 'main',
      headRef: 'HEAD',
      includePatterns: ['lib/**'],
      runGit
    })

    // src/app.ts does not match the include glob, so it is skipped as excluded.
    expect(intake.changedFiles).toEqual([])
    expect(intake.skippedFiles).toEqual([
      { path: 'src/app.ts', reason: 'excluded' }
    ])
  })

  test('rejects git refs that start with a dash before running git', async () => {
    let commandCount = 0
    const runGit: GitCommandRunner = async () => {
      commandCount += 1
      return ''
    }

    await expect(
      collectRepositoryIntake({
        repositoryRoot: '/repo',
        baseRef: '-main',
        headRef: 'HEAD',
        runGit
      })
    ).rejects.toMatchObject({
      code: 'invalid_git_ref',
      category: 'config',
      exitCode: 2
    })
    expect(commandCount).toBe(0)
  })

  test('rejects explicit files outside the repository root', async () => {
    await expect(
      collectRepositoryIntake({
        repositoryRoot: '/repo',
        explicitFiles: ['../outside.ts'],
        runGit: async () => ''
      })
    ).rejects.toMatchObject({
      code: 'repository_error',
      category: 'repository'
    })
  })

  test('explicit file intake bypasses git and emits portable Windows paths', async () => {
    const intake = await collectRepositoryIntake({
      repositoryRoot: 'C:\\repo',
      explicitFiles: ['src\\app.ts'],
      pathFlavor: 'win32',
      runGit: async () => {
        throw new Error('git should not be called for explicit file intake')
      },
      fileSystem: {
        statFile: async () => ({ size: 3 }),
        readFile: async () => Buffer.from('abc')
      }
    })

    expect(intake.changedFiles).toEqual([
      expect.objectContaining({
        path: 'src/app.ts',
        status: 'modified',
        sizeBytes: 3
      })
    ])
    expect(intake.skippedFiles).toEqual([])
  })

  test('keeps UTF-8 source files with control-character regex literals reviewable', async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'codereviewer-intake-text-'))
    await mkdir(path.join(repositoryRoot, 'src'), { recursive: true })
    await mkdir(path.join(repositoryRoot, 'bin'), { recursive: true })
    await writeFile(
      path.join(repositoryRoot, 'src', 'reporting.ts'),
      Buffer.concat([
        Buffer.from('value.replace(/[', 'utf8'),
        Buffer.from([0, 45, 31, 127]),
        Buffer.from(']/gu, " ")\n', 'utf8')
      ])
    )
    await writeFile(path.join(repositoryRoot, 'bin', 'blob.dat'), Buffer.from([0, 1, 2]))

    const intake = await collectRepositoryIntake({
      repositoryRoot,
      explicitFiles: ['src/reporting.ts', 'bin/blob.dat'],
      runGit: async () => {
        throw new Error('git should not be called for explicit file intake')
      }
    })

    expect(intake.changedFiles.map((file) => file.path)).toEqual([
      'src/reporting.ts'
    ])
    expect(intake.skippedFiles).toEqual([
      { path: 'bin/blob.dat', reason: 'binary' }
    ])
  })

  test('enforces maxFiles before reading excess reviewable files', async () => {
    const readPaths: string[] = []
    const intake = await collectRepositoryIntake({
      repositoryRoot: '/repo',
      explicitFiles: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      maxFiles: 2,
      pathFlavor: 'posix',
      runGit: async () => {
        throw new Error('git should not be called for explicit file intake')
      },
      fileSystem: {
        statFile: async () => ({ size: 3 }),
        readFile: async (filePath) => {
          readPaths.push(filePath)
          return Buffer.from('abc')
        }
      }
    })

    expect(intake.changedFiles.map((file) => file.path)).toEqual([
      'src/a.ts',
      'src/b.ts'
    ])
    expect(readPaths).toHaveLength(2)
    expect(intake.skippedFiles).toEqual([
      {
        path: 'src/c.ts',
        reason: 'too-many-files',
        message: 'Skipped because review.maxFiles is 2.'
      }
    ])
  })

  test('does not count deleted or excluded files toward maxFiles', async () => {
    const repositoryRoot = await createFixtureRepository()
    const runGit = scriptedGitRunner({
      'merge-base main HEAD': `${mergeBaseSha}\n`,
      [`diff --name-status ${mergeBaseSha} HEAD`]:
        'D\tsrc/deleted.ts\nM\tdist/generated.js\nM\tsrc/app.ts\nM\tlarge.txt\n',
      [`diff --unified=0 ${mergeBaseSha} HEAD -- src/app.ts`]: ''
    })

    const intake = await collectRepositoryIntake({
      repositoryRoot,
      baseRef: 'main',
      headRef: 'HEAD',
      excludePatterns: ['dist/**'],
      maxFiles: 1,
      runGit
    })

    expect(intake.changedFiles.map((file) => file.path)).toEqual(['src/app.ts'])
    expect(intake.skippedFiles).toEqual([
      { path: 'src/deleted.ts', reason: 'deleted' },
      { path: 'dist/generated.js', reason: 'excluded' },
      {
        path: 'large.txt',
        reason: 'too-many-files',
        message: 'Skipped because review.maxFiles is 1.'
      }
    ])
  })

  test('diffs against the merge base so base-branch commits are not reviewed', async () => {
    const repositoryRoot = await createFixtureRepository()
    const issuedCommands: string[] = []
    const runGit: GitCommandRunner = async (args) => {
      issuedCommands.push(args.join(' '))

      if (args[0] === 'merge-base') {
        return `${mergeBaseSha}\n`
      }

      return args[1] === '--name-status' ? 'M\tsrc/app.ts\n' : ''
    }

    const intake = await collectRepositoryIntake({
      repositoryRoot,
      baseRef: 'main',
      headRef: 'HEAD',
      runGit
    })

    expect(issuedCommands[0]).toBe('merge-base main HEAD')
    // Neither diff may reference `main` directly; both are pinned to the base.
    expect(
      issuedCommands.slice(1).every((command) => command.includes(mergeBaseSha))
    ).toBe(true)
    expect(
      issuedCommands.slice(1).some((command) => / main /u.test(command))
    ).toBe(false)
    expect(intake.repositorySnapshot.mergeBaseRef).toBe(mergeBaseSha)
  })

  test('excludes base-branch commits the head branch never had', async () => {
    const repositoryRoot = await createFixtureRepository()
    // Two-dot `diff main HEAD` would report dist/generated.js as deleted here,
    // because it exists on the base branch but not on the feature branch.
    const runGit = scriptedGitRunner({
      'merge-base main HEAD': `${mergeBaseSha}\n`,
      [`diff --name-status ${mergeBaseSha} HEAD`]: 'M\tsrc/app.ts\n',
      [`diff --unified=0 ${mergeBaseSha} HEAD -- src/app.ts`]: ''
    })

    const intake = await collectRepositoryIntake({
      repositoryRoot,
      baseRef: 'main',
      headRef: 'HEAD',
      runGit
    })

    expect(intake.changedFiles.map((file) => file.path)).toEqual(['src/app.ts'])
    expect(intake.skippedFiles).toEqual([])
  })

  test('fails with merge_base_unavailable when the refs share no history', async () => {
    await expect(
      collectRepositoryIntake({
        repositoryRoot: '/repo',
        baseRef: 'main',
        headRef: 'HEAD',
        runGit: async () => {
          throw Object.assign(new Error('git exited with code 1'), { code: 1 })
        }
      })
    ).rejects.toMatchObject({
      code: 'merge_base_unavailable',
      category: 'repository',
      exitCode: 3
    })
  })

  test('fails with merge_base_unavailable when merge-base prints nothing', async () => {
    await expect(
      collectRepositoryIntake({
        repositoryRoot: '/repo',
        baseRef: 'main',
        headRef: 'HEAD',
        runGit: async () => ''
      })
    ).rejects.toMatchObject({
      code: 'merge_base_unavailable',
      category: 'repository'
    })
  })

  test('explicit file intake needs no merge base', async () => {
    const repositoryRoot = await createFixtureRepository()

    const intake = await collectRepositoryIntake({
      repositoryRoot,
      explicitFiles: ['src/app.ts'],
      runGit: async () => {
        throw new Error('git must not be called for explicit file intake')
      }
    })

    expect(intake.changedFiles.map((file) => file.path)).toEqual(['src/app.ts'])
    expect(intake.repositorySnapshot.mergeBaseRef).toBeUndefined()
  })

  test('normalizes timeout-shaped git failures as repository errors', async () => {
    await expect(
      collectRepositoryIntake({
        repositoryRoot: '/repo',
        baseRef: 'main',
        headRef: 'HEAD',
        runGit: async () => {
          throw new Error('git operation timed out')
        }
      })
    ).rejects.toMatchObject({
      code: 'repository_timeout',
      category: 'repository'
    })
  })
})

describe('git diff map parser', () => {
  test('parses POSIX and Windows-style diff paths into portable paths', () => {
    expect(
      parseGitDiffMaps(
        [
          'diff --git a/src/app.ts b/src/app.ts',
          '--- a/src/app.ts',
          '+++ b/src/app.ts',
          '@@ -2,2 +2,3 @@',
          'diff --git "a/src\\win.ts" "b/src\\win.ts"',
          '--- "a/src\\win.ts"',
          '+++ "b/src\\win.ts"',
          '@@ -1 +1,2 @@'
        ].join('\n')
      )
    ).toEqual([
      {
        path: 'src/app.ts',
        changeKind: 'modified',
        hunks: [
          {
            oldStartLine: 2,
            oldLineCount: 2,
            newStartLine: 2,
            newLineCount: 3
          }
        ]
      },
      {
        path: 'src/win.ts',
        changeKind: 'modified',
        hunks: [
          {
            oldStartLine: 1,
            oldLineCount: 1,
            newStartLine: 1,
            newLineCount: 2
          }
        ]
      }
    ])
  })

  test('records new and deleted file change kinds from git diff headers', () => {
    expect(
      parseGitDiffMaps(
        [
          'diff --git a/src/new.ts b/src/new.ts',
          'new file mode 100644',
          '--- /dev/null',
          '+++ b/src/new.ts',
          '@@ -0,0 +1,2 @@',
          'diff --git a/src/old.ts b/src/old.ts',
          'deleted file mode 100644',
          '--- a/src/old.ts',
          '+++ /dev/null',
          '@@ -1,2 +0,0 @@'
        ].join('\n')
      )
    ).toEqual([
      {
        path: 'src/new.ts',
        changeKind: 'new',
        hunks: [
          {
            oldStartLine: 0,
            oldLineCount: 0,
            newStartLine: 1,
            newLineCount: 2
          }
        ]
      },
      {
        path: 'src/old.ts',
        changeKind: 'deleted',
        hunks: [
          {
            oldStartLine: 1,
            oldLineCount: 2,
            newStartLine: 0,
            newLineCount: 0
          }
        ]
      }
    ])
  })
})
