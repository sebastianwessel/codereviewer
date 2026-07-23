import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import type {
  JsonValue,
  ModelProvider,
  ObjectResponse
} from '@purista/harness'
import { runCli } from './index.js'

const createTempDir = async (): Promise<string> => {
  const directory = join(tmpdir(), `codereviewer-review-cli-${crypto.randomUUID()}`)
  await mkdir(directory, { recursive: true })
  return directory
}

// A resolvable model provider whose model methods are never expected to run in
// these tests: the general review keeps AI review disabled and verification
// gathers no claims (its only claim provider fails), so no request is issued.
class UnusedModelProvider implements ModelProvider {
  readonly id = 'unused-model-provider'
  readonly genAiSystem = 'unused'

  async object<T extends JsonValue = JsonValue>(): Promise<ObjectResponse<T>> {
    throw new Error('UnusedModelProvider.object must not be called in this test')
  }
}

describe('review CLI', () => {
  test('runs a real local review for explicit files and writes artifacts', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'src', 'app.ts'), 'export const value = ;\n')

      const result = await runCli(['review', '--file', 'src/app.ts'], {
        cwd: root,
        environment: {}
      })

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout).toContain('"qualityGatePassed": true')
      expect(result.stdout).not.toContain('test-run')

      const artifactDir = JSON.parse(result.stdout).artifactDir as string
      await expect(stat(join(root, artifactDir, 'report.json'))).resolves.toBeDefined()
      await expect(stat(join(root, artifactDir, 'report.md'))).resolves.toBeDefined()
      await expect(stat(join(root, artifactDir, 'report.sarif'))).resolves.toBeDefined()
      await expect(stat(join(root, artifactDir, 'run-summary.json'))).resolves.toBeDefined()
      await expect(stat(join(root, artifactDir, 'context-ledger.json'))).resolves.toBeDefined()
      await expect(stat(join(root, artifactDir, 'shared-context.json'))).resolves.toBeDefined()
      await expect(stat(join(root, artifactDir, 'observability.json'))).resolves.toBeDefined()
      // Verification is off by default, so its lane writes no artifact.
      await expect(
        stat(join(root, artifactDir, 'verification-report.json'))
      ).rejects.toThrow()

      const report = JSON.parse(
        await readFile(join(root, artifactDir, 'report.json'), 'utf8')
      )
      const sharedContext = JSON.parse(
        await readFile(join(root, artifactDir, 'shared-context.json'), 'utf8')
      )
      const observability = JSON.parse(
        await readFile(join(root, artifactDir, 'observability.json'), 'utf8')
      )
      expect(report.run.provider).toBeUndefined()
      expect(report.admittedFindings).toHaveLength(0)
      expect(report.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'diagnostic',
            source: 'typescript-support-signal'
          })
        ])
      )
      expect(sharedContext.taskEvents.length).toBeGreaterThan(0)
      expect(observability.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'run-started' }),
          expect.objectContaining({ type: 'task-event' })
        ])
      )
      expect(sharedContext.admittedFindings).toHaveLength(0)
      expect(report.artifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ format: 'markdown', path: 'report.md' }),
          expect.objectContaining({ format: 'sarif', path: 'report.sarif' })
        ])
      )

      const markdown = await readFile(
        join(root, artifactDir, 'report.md'),
        'utf8'
      )
      expect(markdown).toContain('# Review Report')
      expect(markdown).not.toContain('Suggested fix:')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('writes live debug logs through the configured sink', async () => {
    const root = await createTempDir()
    let logs = ''

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'src', 'app.ts'), 'export const value = 1;\n')

      const result = await runCli(
        ['review', '--debug', '--file', 'src/app.ts', '--resume', 'run-debug-cli'],
        {
          cwd: root,
          environment: {},
          logSink: {
            write: (chunk) => {
              logs += chunk
            }
          }
        }
      )

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      expect(logs).toContain('Review run started.')
      expect(logs).toContain('Repository intake completed.')
      expect(logs).toContain('Review run completed.')
      expect(logs).not.toContain('export const value')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('loads configured instruction files and skills through the context ledger', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await mkdir(join(root, '.codereviewer', 'instructions'), { recursive: true })
      await mkdir(join(root, '.codereviewer', 'skills', 'security'), { recursive: true })
      await writeFile(join(root, 'src', 'app.ts'), 'export const value = ;\n')
      await writeFile(
        join(root, '.codereviewer', 'instructions', 'review.md'),
        `Prefer minimal, evidence-backed findings. sk-proj-secret\n${'x'.repeat(12000)}`
      )
      await writeFile(
        join(root, '.codereviewer', 'skills', 'security', 'SKILL.md'),
        [
          '---',
          'name: security',
          'description: Check auth-sensitive code paths.',
          '---',
          '',
          'Check auth-sensitive code paths. sk-proj-skill-secret'
        ].join('\n')
      )
      await mkdir(join(root, '.codereviewer'), { recursive: true })
      await writeFile(
        join(root, '.codereviewer', 'config.json'),
        JSON.stringify({
          review: {
            contextMaxBytes: 10000
          },
          instructions: {
            files: ['.codereviewer/instructions/review.md']
          },
          skills: {
            enabled: true,
            directories: ['.codereviewer/skills']
          }
        })
      )

      const result = await runCli(['review', '--file', 'src/app.ts'], {
        cwd: root,
        environment: {}
      })

      expect(result.exitCode).toBe(0)
      const artifactDir = JSON.parse(result.stdout).artifactDir as string
      const ledger = JSON.parse(
        await readFile(join(root, artifactDir, 'context-ledger.json'), 'utf8')
      )

      expect(ledger).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'instruction',
            path: '.codereviewer/instructions/review.md',
            decision: 'included'
          }),
          expect.objectContaining({
            kind: 'skill',
            path: '.codereviewer/skills/security/SKILL.md'
          })
        ])
      )
      expect(JSON.stringify(ledger)).not.toContain('sk-proj')
      const reportContent = await readFile(
        join(root, artifactDir, 'report.json'),
        'utf8'
      )
      expect(reportContent).not.toContain('sk-proj')

      const report = JSON.parse(reportContent)
      expect(report.admittedFindings).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('writes complete coverage artifacts for large explicit reviews', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await mkdir(join(root, '.codereviewer'), { recursive: true })
      await writeFile(
        join(root, 'src', 'large.ts'),
        `export const value = 1;\n${'// filler\n'.repeat(1200)}`
      )
      await writeFile(
        join(root, '.codereviewer', 'config.json'),
        JSON.stringify({
          review: {
            contextMaxBytes: 10000
          }
        })
      )

      const result = await runCli(['review', '--file', 'src/large.ts'], {
        cwd: root,
        environment: {}
      })

      expect(result.exitCode).toBe(0)
      const artifactDir = JSON.parse(result.stdout).artifactDir as string
      const summary = JSON.parse(
        await readFile(join(root, artifactDir, 'run-summary.json'), 'utf8')
      )
      const report = JSON.parse(
        await readFile(join(root, artifactDir, 'report.json'), 'utf8')
      )
      const ledger = JSON.parse(
        await readFile(join(root, artifactDir, 'context-ledger.json'), 'utf8')
      )

      expect(summary.warnings).toEqual([])
      expect(report.coverage).toMatchObject({
        status: 'complete',
        reviewableFileCount: 1,
        coveredFileCount: 1
      })
      expect(
        ledger
          .filter(
            (entry: { reason?: string }) =>
              entry.reason === 'task-context-source-chunk'
          )
          .every((entry: { decision: string }) => entry.decision === 'included')
      ).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('applies default context budget for explicit large-file reviews', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await mkdir(join(root, '.codereviewer'), { recursive: true })
      await writeFile(
        join(root, 'src', 'large.ts'),
        `export const value = 1;\n${'// filler\n'.repeat(120000)}`
      )
      await writeFile(
        join(root, '.codereviewer', 'config.json'),
        JSON.stringify({
          review: {
            maxFileBytes: 2000000
          }
        })
      )

      const result = await runCli(['review', '--file', 'src/large.ts'], {
        cwd: root,
        environment: {}
      })

      expect(result.exitCode).toBe(0)
      const artifactDir = JSON.parse(result.stdout).artifactDir as string
      const summary = JSON.parse(
        await readFile(join(root, artifactDir, 'run-summary.json'), 'utf8')
      )
      const ledger = JSON.parse(
        await readFile(join(root, artifactDir, 'context-ledger.json'), 'utf8')
      )

      const report = JSON.parse(
        await readFile(join(root, artifactDir, 'report.json'), 'utf8')
      )
      expect(summary.warnings).toEqual([])
      expect(report.coverage.status).toBe('complete')
      expect(report.coverage.coveredBytes).toBe(report.coverage.reviewableBytes)
      expect(
        ledger
          .filter(
            (entry: { reason?: string }) =>
              entry.reason === 'task-context-source-chunk'
          )
          .every((entry: { decision: string }) => entry.decision === 'included')
      ).toBe(true)
      expect(
        ledger
          .filter(
            (entry: { reason?: string }) =>
              entry.reason === 'task-context-source-chunk'
          )
          .reduce(
            (total: number, entry: { bytesIncluded: number }) =>
              total + entry.bytesIncluded,
            0
          )
      ).toBe(report.coverage.reviewableBytes)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('maps provider credential and repository errors to documented exit codes', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await mkdir(join(root, '.codereviewer'), { recursive: true })
      await writeFile(join(root, 'src', 'app.ts'), 'export const value = ;\n')
      await writeFile(
        join(root, '.codereviewer', 'config.json'),
        JSON.stringify({
          provider: {
            id: 'openai',
            model: 'gpt-5-mini'
          }
        })
      )

      const credentialsMissing = await runCli(['review', '--file', 'src/app.ts'], {
        cwd: root,
        environment: {}
      })
      const repositoryFailure = await runCli(['review', '--base-ref', '-bad'], {
        cwd: root,
        environment: {}
      })

      expect(credentialsMissing.exitCode).toBe(2)
      expect(credentialsMissing.stderr).toContain('provider_credentials_missing')
      expect(repositoryFailure.exitCode).toBe(2)
      expect(repositoryFailure.stderr).toContain('invalid_git_ref')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('writes an empty verification report when verification is enabled without a provider', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await mkdir(join(root, '.codereviewer', 'claims'), { recursive: true })
      await writeFile(join(root, 'src', 'app.ts'), 'export const value = 1;\n')
      await writeFile(
        join(root, '.codereviewer', 'config.json'),
        JSON.stringify({
          verification: {
            enabled: true,
            providers: [
              { type: 'claims-file', path: '.codereviewer/claims/claims.json' }
            ]
          }
        })
      )

      const result = await runCli(['review', '--file', 'src/app.ts'], {
        cwd: root,
        environment: {}
      })

      expect(result.exitCode).toBe(0)
      const artifactDir = JSON.parse(result.stdout).artifactDir as string
      const verification = JSON.parse(
        await readFile(
          join(root, artifactDir, 'verification-report.json'),
          'utf8'
        )
      )

      // No provider is configured, so the flow produces an empty report rather
      // than failing the review (spec 12: off/degraded is non-fatal).
      expect(verification).toMatchObject({
        verdicts: [],
        observations: [],
        warnings: [],
        claimCount: 0
      })
      const summary = JSON.parse(
        await readFile(join(root, artifactDir, 'run-summary.json'), 'utf8')
      )
      expect(summary.warnings).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('surfaces a failed verification claim provider as a run warning', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await mkdir(join(root, '.codereviewer', 'claims'), { recursive: true })
      await writeFile(join(root, 'src', 'app.ts'), 'export const value = 1;\n')
      // A claims file that is valid JSON but not an array is a genuine provider
      // failure; the flow records it as a non-fatal warning and proceeds.
      await writeFile(
        join(root, '.codereviewer', 'claims', 'bad.json'),
        JSON.stringify({ not: 'an-array' })
      )
      await writeFile(
        join(root, '.codereviewer', 'config.json'),
        JSON.stringify({
          provider: {
            id: 'openai',
            model: 'review-model'
          },
          aiReview: {
            enabled: false
          },
          drift: {
            enabled: false
          },
          verification: {
            enabled: true,
            providers: [
              { type: 'claims-file', path: '.codereviewer/claims/bad.json' }
            ]
          }
        })
      )

      const result = await runCli(['review', '--file', 'src/app.ts'], {
        cwd: root,
        environment: {
          OPENAI_API_KEY: 'sk-test'
        },
        providerImport: async () => ({
          openai: () => new UnusedModelProvider()
        })
      })

      expect(result.exitCode).toBe(0)
      const artifactDir = JSON.parse(result.stdout).artifactDir as string
      const providerId = 'claims-file:.codereviewer/claims/bad.json'

      const summary = JSON.parse(
        await readFile(join(root, artifactDir, 'run-summary.json'), 'utf8')
      )
      expect(summary.warnings).toContain(
        `Verification claim provider "${providerId}" failed and was skipped.`
      )

      const report = JSON.parse(
        await readFile(join(root, artifactDir, 'report.json'), 'utf8')
      )
      expect(report.run.warnings).toContain(
        `Verification claim provider "${providerId}" failed and was skipped.`
      )

      const verification = JSON.parse(
        await readFile(
          join(root, artifactDir, 'verification-report.json'),
          'utf8'
        )
      )
      expect(verification.warnings).toContain(
        `claim-provider-failed:${providerId}`
      )
      expect(verification.verdicts).toEqual([])
      expect(verification.claimCount).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
