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

// Every review in this file runs without a provider, because the subject is
// change-intent ingestion and not the model review. A run that asks for a model
// review it has no model for is refused in preflight, so each config states the
// deterministic-only intent the runs already had.
const deterministicOnly = { aiReview: { enabled: false } } as const

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
          ...deterministicOnly,
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
        JSON.stringify({ ...deterministicOnly, contextSources: { enabled: false } })
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
  // entry, no error, and NOT A WORD about it.
  //
  // The last clause is the 2026-08-17 amendment to spec 11. This test used to
  // assert exactly two "found no change-intent source" warnings here, on the
  // grounds that the run must say a provider contributed nothing. Nearly every
  // repository is this repository, so nearly every first report opened with two
  // warnings under "Bounds that bound" — a heading that means "reasons this
  // review was thinner than usual" — describing the ordinary state of having no
  // written change intent. The diagnostic they existed for is kept by the test
  // below, which configures the providers explicitly.
  test('zero config with no inbox directory and no changed docs is inert', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, '.codereviewer'), { recursive: true })
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'src', 'app.ts'), 'export const value = 1\n')
      // Zero CONTEXT configuration: no `contextSources` key and no context
      // directory, so both promoted providers run on their defaults. The config
      // file carries the deterministic-only switch and nothing else, because a
      // run with no provider that still asks for a model review is refused
      // before any of this is reached.
      await writeFile(
        join(root, '.codereviewer', 'config.json'),
        JSON.stringify(deterministicOnly)
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
      // Nor are they described at all. Both providers here are schema defaults
      // the operator never asked for, and a default that finds the ordinary
      // absence it was promoted over has nothing to report.
      expect(
        warnings.filter((warning) =>
          warning.includes('change-intent')
        )
      ).toHaveLength(0)
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
          ...deterministicOnly,
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

  // THE TYPO CASE, and the whole reason this warning still exists.
  //
  // Spec 11 requires a warning from a provider that produces nothing, and names
  // "empty inbox" among the cases. Only a THROWING provider warned, so a source
  // pointed at a directory that does not exist contributed nothing and said so
  // nowhere — indistinguishable from never having configured it.
  //
  // Since 2026-08-17 the warning is conditional on the operator having listed
  // `contextSources.providers` themselves, which is what this config does. A
  // mistyped directory is ALWAYS an explicit configuration — nobody typos a
  // default — so the diagnostic survives the ordinary case going quiet.
  test('a context provider the repository configured itself says when it produces nothing', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, '.codereviewer'), { recursive: true })
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'src', 'app.ts'), 'export const value = 1\n')
      await writeFile(
        join(root, '.codereviewer', 'config.json'),
        JSON.stringify({
          ...deterministicOnly,
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
      expect(warning).toContain('check where it points')
      // It reports an absence, not a fault: the provider did not fail.
      expect(warning).not.toContain('failed')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // The two halves of the amendment, on the SAME empty repository, so the only
  // difference between them is whether the operator wrote the providers down.
  // Restating the default set verbatim is enough to get the warning back: what is
  // being asked is not "is this configuration unusual" but "did a human name this
  // source and not get it".
  test('restating the default providers is what brings the warning back', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, '.codereviewer'), { recursive: true })
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'src', 'app.ts'), 'export const value = 1\n')
      await writeFile(
        join(root, '.codereviewer', 'config.json'),
        JSON.stringify({
          ...deterministicOnly,
          contextSources: {
            // The schema's own default set, written out by hand.
            providers: [{ type: 'inbox' }, { type: 'changed-files' }]
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
      const warnings = report.run.warnings as readonly string[]

      expect(
        warnings.filter((warning) =>
          warning.includes('found no change-intent source')
        )
      ).toHaveLength(2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // `contextSources.enabled: true` alone does NOT bring it back, and that is the
  // one line where this flag differs from `baselineExplicitlyConfigured`.
  // `baseline.enabled` names the file `baseline.path` already points at, so
  // switching it on is asking for that file; `contextSources.enabled` names no
  // source at all — it turns on a defaulted set — so an operator who wrote only
  // that still asked for nothing in particular, and still gets the ordinary run.
  test('enabling the block without naming a provider stays quiet', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, '.codereviewer'), { recursive: true })
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'src', 'app.ts'), 'export const value = 1\n')
      await writeFile(
        join(root, '.codereviewer', 'config.json'),
        JSON.stringify({
          ...deterministicOnly,
          contextSources: { enabled: true }
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
        (report.run.warnings as readonly string[]).filter((warning) =>
          warning.includes('change-intent')
        )
      ).toHaveLength(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
