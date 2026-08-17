import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  assertReadOnlyGitArgs,
  collectRepositoryIntake,
  parseChangedLines,
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

  // A head already contained in base has NOTHING for the diff to report, so every
  // downstream stage sees an empty change set and the run reports a PASSING quality
  // gate over zero files. That is the dangerous shape: swapping --base-ref and
  // --head-ref, or pointing at a branch that is behind, produced a green CI gate on
  // a review that examined nothing.
  test('refuses a git-derived review whose refs differ by no files', async () => {
    const repositoryRoot = await createFixtureRepository()
    const runGit = scriptedGitRunner({
      'merge-base main HEAD': `${mergeBaseSha}\n`,
      [`diff --name-status ${mergeBaseSha} HEAD`]: ''
    })

    await expect(
      collectRepositoryIntake({
        repositoryRoot,
        baseRef: 'main',
        headRef: 'HEAD',
        runGit
      })
    ).rejects.toMatchObject({
      code: 'no_reviewable_change',
      category: 'repository',
      exitCode: 3
    })
  })

  test('still reviews when the head has its own commits', async () => {
    const repositoryRoot = await createFixtureRepository()
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

  // The two failures a first run actually hits, and the two that used to be
  // reported as the raw `Command failed: git merge-base …` string this engine
  // built — a command the reader never typed, with git's own fatal line and no
  // remedy attached to either.
  test('explains an unresolvable ref instead of echoing the git command', async () => {
    await expect(
      collectRepositoryIntake({
        repositoryRoot: '/repo',
        baseRef: 'origin/main',
        headRef: 'HEAD',
        runGit: async () => {
          throw Object.assign(
            new Error(
              'Command failed: git merge-base origin/main HEAD\nfatal: Not a valid object name origin/main\n'
            ),
            {
              code: 128,
              stderr: 'fatal: Not a valid object name origin/main\n'
            }
          )
        }
      })
    ).rejects.toMatchObject({
      code: 'repository_error',
      category: 'repository',
      exitCode: 3,
      message: expect.stringContaining(
        '"origin/main" does not resolve to a commit in this repository'
      ),
      details: { cause: 'ref_not_found' }
    })
  })

  test('explains a working directory that is not a git repository', async () => {
    await expect(
      collectRepositoryIntake({
        repositoryRoot: '/repo',
        baseRef: 'main',
        headRef: 'HEAD',
        runGit: async () => {
          throw Object.assign(
            new Error('Command failed: git merge-base main HEAD'),
            {
              code: 128,
              stderr:
                'fatal: not a git repository (or any of the parent directories): .git\n'
            }
          )
        }
      })
    ).rejects.toMatchObject({
      code: 'repository_error',
      message: expect.stringContaining('not inside a git repository'),
      details: { cause: 'not_a_git_repository' }
    })
  })

  // A timeout or an abort is classified by the error normalizer from its own
  // message. Rewriting every git failure into a repository error here would take
  // `repository_timeout` away from it, so an unrecognized failure still escapes.
  test('leaves an unrecognized git failure to its own classification', async () => {
    await expect(
      collectRepositoryIntake({
        repositoryRoot: '/repo',
        baseRef: 'main',
        headRef: 'HEAD',
        runGit: async () => {
          throw Object.assign(new Error('git timed out'), { code: 143 })
        }
      })
    ).rejects.toMatchObject({
      code: 'repository_timeout',
      category: 'repository'
    })
  })

  // The other way a run reaches every later stage with nothing to review.
  // `--file`/`--files` bypasses the diff, so the empty-diff refusal above cannot
  // see it: a named file that does not exist, is binary, or is excluded was
  // recorded as skipped and the run reported zero findings, gate PASSED, exit 0.
  test('refuses an explicit-file review in which nothing was reviewable', async () => {
    const repositoryRoot = await mkdtemp(
      path.join(tmpdir(), 'codereviewer-intake-explicit-')
    )

    await expect(
      collectRepositoryIntake({
        repositoryRoot,
        explicitFiles: ['src/absent.ts'],
        runGit: async () => {
          throw new Error('git should not be called for explicit file intake')
        }
      })
    ).rejects.toMatchObject({
      code: 'no_reviewable_change',
      category: 'repository',
      exitCode: 3,
      message: expect.stringContaining(
        '"src/absent.ts" could not be read (it does not exist, or is not readable)'
      )
    })
  })

  test('names the filter that skipped every explicitly reviewed file', async () => {
    await expect(
      collectRepositoryIntake({
        repositoryRoot: '/repo',
        explicitFiles: ['package-lock.json'],
        excludePatterns: ['**/package-lock.json'],
        pathFlavor: 'posix',
        runGit: async () => {
          throw new Error('git should not be called for explicit file intake')
        },
        fileSystem: {
          statFile: async () => ({ size: 3 }),
          readFile: async () => Buffer.from('abc')
        }
      })
    ).rejects.toMatchObject({
      code: 'no_reviewable_change',
      message: expect.stringContaining(
        '"package-lock.json" is matched by paths.exclude'
      )
    })
  })

  // One reviewable file among skipped ones is a review, not a refusal.
  test('reviews an explicit file list in which only some files were skipped', async () => {
    const intake = await collectRepositoryIntake({
      repositoryRoot: '/repo',
      explicitFiles: ['src/app.ts', 'package-lock.json'],
      excludePatterns: ['**/package-lock.json'],
      pathFlavor: 'posix',
      runGit: async () => {
        throw new Error('git should not be called for explicit file intake')
      },
      fileSystem: {
        statFile: async () => ({ size: 3 }),
        readFile: async () => Buffer.from('abc')
      }
    })

    expect(intake.changedFiles.map((file) => file.path)).toEqual(['src/app.ts'])
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

  // G1 (spec 22): a deleted exported symbol is the maximal contract change, but
  // intake drops deleted paths into `skippedFiles` and restricts the unified diff
  // to the surviving paths, so the deletion is invisible to every consumer.
  describe('includeDeletedPaths', () => {
    const deletedFixtureGit = (): Readonly<Record<string, string>> => ({
      'merge-base main HEAD': `${mergeBaseSha}\n`,
      [`diff --name-status ${mergeBaseSha} HEAD`]:
        'M\tsrc/app.ts\nD\tsrc/gone.ts\n',
      [`diff --unified=0 ${mergeBaseSha} HEAD -- src/app.ts`]:
        'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,0 +1,1 @@\n+export const value = 1\n',
      [`diff --unified=0 ${mergeBaseSha} HEAD -- src/app.ts src/gone.ts`]:
        'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,0 +1,1 @@\n+export const value = 1\n' +
        'diff --git a/src/gone.ts b/src/gone.ts\ndeleted file mode 100644\n--- a/src/gone.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-export const removed = 1\n-const internal = 2\n'
    })

    // The byte-for-byte guarantee the option rests on: without it, nothing about
    // the intake -- including the git argument vectors -- differs from before.
    test('is off by default, and the default run issues the same git commands', async () => {
      const repositoryRoot = await createFixtureRepository()
      const issuedCommands: string[][] = []
      const outputs = deletedFixtureGit()
      const runGit: GitCommandRunner = async (args) => {
        issuedCommands.push([...args])
        const output = outputs[args.join(' ')]

        if (output === undefined) {
          throw new Error(`Unexpected git command: ${args.join(' ')}`)
        }

        return output
      }

      const intake = await collectRepositoryIntake({
        repositoryRoot,
        baseRef: 'main',
        headRef: 'HEAD',
        runGit
      })

      expect(issuedCommands).toEqual([
        ['merge-base', 'main', 'HEAD'],
        ['diff', '--name-status', mergeBaseSha, 'HEAD'],
        ['diff', '--unified=0', mergeBaseSha, 'HEAD', '--', 'src/app.ts']
      ])
      expect(intake.deletedFiles).toEqual([])
      expect(intake.skippedFiles).toEqual([
        { path: 'src/gone.ts', reason: 'deleted' }
      ])
      expect(intake.diffMaps.map((diffMap) => diffMap.path)).toEqual([
        'src/app.ts'
      ])
    })

    test('surfaces deleted paths with their pre-change content when requested', async () => {
      const repositoryRoot = await createFixtureRepository()
      const runGit = scriptedGitRunner(deletedFixtureGit())

      const intake = await collectRepositoryIntake({
        repositoryRoot,
        baseRef: 'main',
        headRef: 'HEAD',
        includeDeletedPaths: true,
        runGit
      })

      expect(intake.deletedFiles).toEqual([
        {
          path: 'src/gone.ts',
          content: 'export const removed = 1\nconst internal = 2',
          sizeBytes: 43,
          contentHash: expect.stringMatching(/^[0-9a-f]{64}$/u)
        }
      ])
      // Opting in adds a view; it never removes one. The deleted path is still
      // reported as skipped from review, and the surviving file is untouched.
      expect(intake.skippedFiles).toEqual([
        { path: 'src/gone.ts', reason: 'deleted' }
      ])
      expect(intake.changedFiles.map((file) => file.path)).toEqual([
        'src/app.ts'
      ])
      expect(
        intake.diffMaps.map((diffMap) => [diffMap.path, diffMap.changeKind])
      ).toEqual([
        ['src/app.ts', 'modified'],
        ['src/gone.ts', 'deleted']
      ])
    })

    test('reports no deleted files when the change deletes nothing', async () => {
      const repositoryRoot = await createFixtureRepository()
      const runGit = scriptedGitRunner({
        'merge-base main HEAD': `${mergeBaseSha}\n`,
        [`diff --name-status ${mergeBaseSha} HEAD`]: 'M\tsrc/app.ts\n',
        [`diff --unified=0 ${mergeBaseSha} HEAD -- src/app.ts`]:
          'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,0 +1,1 @@\n+export const value = 1\n'
      })

      const intake = await collectRepositoryIntake({
        repositoryRoot,
        baseRef: 'main',
        headRef: 'HEAD',
        includeDeletedPaths: true,
        runGit
      })

      expect(intake.deletedFiles).toEqual([])
    })
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

describe('changed line parser', () => {
  test('numbers additions and removals in head-side coordinates', () => {
    // Both sides have to share one coordinate system, because the consumer
    // intersects them with a line span it can only know on the head side. A
    // replacement anchors its removals on the same head line as the additions
    // that replaced them, which is what keeps one edit's two sides together.
    const changed = parseChangedLines(
      [
        'diff --git a/src/app.ts b/src/app.ts',
        '--- a/src/app.ts',
        '+++ b/src/app.ts',
        '@@ -4,1 +4,2 @@',
        '-const value = old()',
        '+const value = next()',
        '+const extra = 1'
      ].join('\n')
    )

    expect(changed.get('src/app.ts')).toEqual({
      added: [
        { line: 4, text: 'const value = next()' },
        { line: 5, text: 'const extra = 1' }
      ],
      removed: [{ line: 4, text: 'const value = old()' }]
    })
  })

  test('anchors a pure deletion on the surviving line above it', () => {
    // `+9,0` means nothing occupies that position on the head side; git names the
    // line the removal sits after. That is the closest surviving anchor there is,
    // and it is the same position `parseGitDiffMaps` reports as touched, so the
    // hunk that seeds a symbol and the lines attributed to it cannot disagree.
    const changed = parseChangedLines(
      [
        'diff --git a/src/app.ts b/src/app.ts',
        '--- a/src/app.ts',
        '+++ b/src/app.ts',
        '@@ -10,2 +9,0 @@',
        '-  first()',
        '-  second()'
      ].join('\n')
    )

    expect(changed.get('src/app.ts')?.removed).toEqual([
      { line: 9, text: '  first()' },
      { line: 9, text: '  second()' }
    ])
  })

  test('ignores file headers, which carry the same marker characters', () => {
    // `--- a/<path>` and `+++ b/<path>` start with `-` and `+` without being hunk
    // body lines. Collecting them would put the diff's own plumbing into the text
    // a contract claim is derived from.
    const changed = parseChangedLines(
      [
        'diff --git a/src/app.ts b/src/app.ts',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/src/app.ts',
        '@@ -0,0 +1,1 @@',
        '+const value = 1',
        '\\ No newline at end of file'
      ].join('\n')
    )

    expect(changed.get('src/app.ts')).toEqual({
      added: [{ line: 1, text: 'const value = 1' }],
      removed: []
    })
  })
})
