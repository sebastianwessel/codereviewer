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

  test('injects nothing when the feature is disabled', async () => {
    const root = await createTempDir()

    try {
      await seedRepo(root)
      // No config: contextSources defaults to disabled.
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
})
