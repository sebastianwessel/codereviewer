import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import { runCli } from './index.js'

const createTempDir = async (): Promise<string> => {
  const directory = join(tmpdir(), `codereviewer-ctx-cli-${crypto.randomUUID()}`)
  await mkdir(directory, { recursive: true })
  return directory
}

const seedRepo = async (root: string): Promise<void> => {
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'docs'), { recursive: true })
  await mkdir(join(root, '.codereviewer', 'context'), { recursive: true })
  await writeFile(join(root, 'src', 'app.ts'), 'export const value = 1\n')
  await writeFile(
    join(root, 'docs', 'intent.md'),
    '# Intent\nTighten the token timeout to five minutes.\n'
  )
  await writeFile(
    join(root, '.codereviewer', 'context', 'jira-1.md'),
    '---\nsource: jira\nid: PROJ-1\ntitle: Reject expired tokens\n---\nReject tokens older than five minutes.\n'
  )
}

const readLedger = async (
  root: string,
  artifactDir: string
): Promise<readonly { reason: string }[]> => {
  const ledger = JSON.parse(
    await readFile(join(root, artifactDir, 'context-ledger.json'), 'utf8')
  )
  return Array.isArray(ledger) ? ledger : (ledger.entries ?? [])
}

describe('context ingestion CLI', () => {
  test('injects a change-intent ledger entry when enabled', async () => {
    const root = await createTempDir()

    try {
      await seedRepo(root)
      await writeFile(
        join(root, '.codereviewer', 'config.json'),
        JSON.stringify({
          contextSources: {
            enabled: true,
            providers: [
              { type: 'inbox', dir: '.codereviewer/context' },
              { type: 'changed-files', include: ['**/*.md'] }
            ]
          }
        })
      )

      const result = await runCli(
        ['review', '--file', 'src/app.ts', '--file', 'docs/intent.md'],
        { cwd: root, environment: {} }
      )
      expect(result.exitCode).toBe(0)

      const artifactDir = JSON.parse(result.stdout).artifactDir as string
      const ledger = await readLedger(root, artifactDir)
      expect(
        ledger.some((entry) => entry.reason === 'task-context-change-intent')
      ).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // The opt-out has to be written out now that `contextSources` is on by default
  // (2026-08-11). This test used to rely on the default being `false` and would
  // otherwise have silently started asserting the feature works.
  test('injects nothing when the feature is explicitly disabled', async () => {
    const root = await createTempDir()

    try {
      await seedRepo(root)
      await writeFile(
        join(root, '.codereviewer', 'config.json'),
        JSON.stringify({ contextSources: { enabled: false } })
      )
      const result = await runCli(
        ['review', '--file', 'src/app.ts', '--file', 'docs/intent.md'],
        { cwd: root, environment: {} }
      )
      expect(result.exitCode).toBe(0)

      const artifactDir = JSON.parse(result.stdout).artifactDir as string
      const ledger = await readLedger(root, artifactDir)
      expect(
        ledger.some((entry) => entry.reason === 'task-context-change-intent')
      ).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // ZERO CONFIG IS WHAT MAKES THE PROMOTED DEFAULT DEFENSIBLE, so it is asserted
  // rather than assumed. `contextSources` was turned on by default on 2026-08-11
  // over a provider set pointing at `.codereviewer/context` and changed markdown.
  // A repository that has neither must get a REVIEW — exit 0, no change-intent
  // entry, no error, and no warning phrased as though the operator broke
  // something. Spec 11 still requires the run to say a provider contributed
  // nothing; what it must not do is read like a fault.
  test('zero config with no inbox directory and no changed docs is inert', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'src', 'app.ts'), 'export const value = 1\n')
      // No `.codereviewer/` at all: no config file, no context directory.

      const result = await runCli(['review', '--file', 'src/app.ts'], {
        cwd: root,
        environment: {}
      })
      expect(result.exitCode).toBe(0)

      const artifactDir = JSON.parse(result.stdout).artifactDir as string
      const report = JSON.parse(
        await readFile(join(root, artifactDir, 'report.json'), 'utf8')
      )
      const warnings = report.run.warnings as readonly string[]

      // No brief was built, so nothing was injected and nothing was summarized.
      const ledger = await readLedger(root, artifactDir)
      expect(
        ledger.some((entry) => entry.reason === 'task-context-change-intent')
      ).toBe(false)

      // Absent inputs are not a failure and are not described as one.
      expect(
        warnings.some((warning) => warning.includes('failed and was skipped'))
      ).toBe(false)
      expect(
        warnings.filter((warning) =>
          warning.includes('found no change-intent source')
        )
      ).toHaveLength(2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('surfaces a run warning when a provider fails instead of skipping silently', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, '.codereviewer'), { recursive: true })
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'src', 'app.ts'), 'export const value = 1\n')
      // The inbox `dir` points at a regular file, so the provider throws ENOTDIR
      // at run time and must be reported, not silently dropped.
      await writeFile(join(root, 'not-a-dir'), 'oops')
      await writeFile(
        join(root, '.codereviewer', 'config.json'),
        JSON.stringify({
          contextSources: {
            enabled: true,
            providers: [{ type: 'inbox', dir: 'not-a-dir' }]
          }
        })
      )

      const result = await runCli(['review', '--file', 'src/app.ts'], {
        cwd: root,
        environment: {}
      })
      expect(result.exitCode).toBe(0)

      const artifactDir = JSON.parse(result.stdout).artifactDir as string
      const report = JSON.parse(
        await readFile(join(root, artifactDir, 'report.json'), 'utf8')
      )
      expect(
        report.run.warnings.some((warning: string) =>
          warning.includes('failed and was skipped')
        )
      ).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // Spec 11 requires a warning from a provider that produces nothing, and names
  // "empty inbox" among the cases. Only a THROWING provider warned, so a source
  // pointed at a directory that does not exist contributed nothing and said so
  // nowhere — indistinguishable from never having configured it.
  //
  // The warning survived the 2026-08-11 default flip; its WORDING did not. It used
  // to open by telling the reader to check where the provider points, which is the
  // wrong first sentence when the provider is a default and the ordinary answer is
  // "this change has no written intent". The pointer is still named, second,
  // because a mistyped directory produces exactly this shape.
  test('a context provider that produces nothing says so', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, '.codereviewer'), { recursive: true })
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'src', 'app.ts'), 'export const value = 1\n')
      await writeFile(
        join(root, '.codereviewer', 'config.json'),
        JSON.stringify({
          contextSources: {
            enabled: true,
            providers: [{ type: 'inbox', dir: 'no-such-directory' }]
          }
        })
      )

      const result = await runCli(['review', '--file', 'src/app.ts'], {
        cwd: root,
        environment: {}
      })
      // Never fatal: a context source is optional by spec.
      expect(result.exitCode).toBe(0)

      const artifactDir = JSON.parse(result.stdout).artifactDir as string
      const report = JSON.parse(
        await readFile(join(root, artifactDir, 'report.json'), 'utf8')
      )
      const warning = (report.run.warnings as readonly string[]).find(
        (candidate) => candidate.includes('no-such-directory')
      )
      expect(warning).toContain('found no change-intent source')
      expect(warning).toContain('check where the provider points')
      // It reports an absence, not a fault: the provider did not fail.
      expect(warning).not.toContain('failed')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
