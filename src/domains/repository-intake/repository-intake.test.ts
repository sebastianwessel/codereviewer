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

    expect(() => assertReadOnlyGitArgs(['reset', '--hard'])).toThrow(TypeError)
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
      'diff --name-status main HEAD':
        'M\tsrc/app.ts\nD\tsrc/deleted.ts\nM\tbin/blob.dat\nM\tlarge.txt\nM\tdist/generated.js\n',
      'diff --unified=0 main HEAD -- src/app.ts':
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
      'diff --name-status main HEAD':
        'D\tsrc/deleted.ts\nM\tdist/generated.js\nM\tsrc/app.ts\nM\tlarge.txt\n',
      'diff --unified=0 main HEAD -- src/app.ts': ''
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
