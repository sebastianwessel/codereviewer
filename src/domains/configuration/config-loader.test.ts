import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import { loadCodeReviewerConfig } from './config-loader.js'
import { createRedactedConfigSummary } from './config-summary.js'

const createTempDir = async (): Promise<string> => {
  const directory = join(tmpdir(), `codereviewer-config-${crypto.randomUUID()}`)
  await mkdir(directory, { recursive: true })
  return directory
}

describe('configuration loader', () => {
  test('loads defaults when the default config file is missing', async () => {
    const root = await createTempDir()

    try {
      const result = await loadCodeReviewerConfig({ repositoryRoot: root })

      expect(result.config.review.mode).toBe('local')
      expect(result.config.paths.artifactDir).toBe('.codereviewer/runs')
      expect(result.config.paths.exclude).toEqual(
        expect.arrayContaining([
          '.git/**',
          'node_modules/**',
          'dist/**',
          'coverage/**',
          '.codereviewer/**'
        ])
      )
      expect(result.warnings).toEqual(['config-file-missing'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('merges config file, env file, process env, and CLI overrides in precedence order', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, '.codereviewer'), { recursive: true })
      await writeFile(
        join(root, '.codereviewer/config.json'),
        JSON.stringify({
          review: {
            mode: 'local',
            depth: 'fast'
          },
          paths: {
            artifactDir: '.codereviewer/from-file'
          }
        })
      )
      await writeFile(
        join(root, '.env'),
        [
          'CODEREVIEWER_REVIEW_MODE=pr',
          'CODEREVIEWER_ARTIFACT_DIR=.codereviewer/from-dotenv',
          'OPENAI_API_KEY=dotenv-key'
        ].join('\n')
      )

      const result = await loadCodeReviewerConfig({
        repositoryRoot: root,
        environment: {
          CODEREVIEWER_REVIEW_MODE: 'ci',
          CODEREVIEWER_ARTIFACT_DIR: '.codereviewer/from-env',
          OPENAI_API_KEY: 'process-key'
        },
        cliConfig: {
          review: {
            depth: 'thorough'
          }
        }
      })

      expect(result.config.review.mode).toBe('pr')
      expect(result.config.review.depth).toBe('thorough')
      expect(result.config.paths.artifactDir).toBe('.codereviewer/from-dotenv')
      expect(result.environment.OPENAI_API_KEY).toBe('dotenv-key')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('loads root env file without failing when it is absent', async () => {
    const root = await createTempDir()

    try {
      const missingEnv = await loadCodeReviewerConfig({
        repositoryRoot: root,
        environment: {}
      })

      expect(missingEnv.config.provider).toBeUndefined()

      await writeFile(
        join(root, '.env'),
        [
          'CODEREVIEWER_PROVIDER_ID=openai-compatible',
          'CODEREVIEWER_PROVIDER_MODEL=local-model',
          'CODEREVIEWER_PROVIDER_BASE_URL=http://127.0.0.1:11434/v1',
          'CODEREVIEWER_LOG_LEVEL=debug',
          'CODEREVIEWER_OPENTELEMETRY_ENABLED=true',
          'CODEREVIEWER_OPENTELEMETRY_ENDPOINT=http://127.0.0.1:4318/v1/traces',
          'CODEREVIEWER_COST_INPUT_PER_MILLION=0.25',
          'CODEREVIEWER_COST_CACHED_INPUT_PER_MILLION=0.05',
          'CODEREVIEWER_COST_OUTPUT_PER_MILLION=1.25'
        ].join('\n')
      )

      const result = await loadCodeReviewerConfig({
        repositoryRoot: root,
        environment: {
          CODEREVIEWER_PROVIDER_MODEL: 'env-model'
        }
      })

      expect(result.config.provider).toEqual(
        expect.objectContaining({
          id: 'openai-compatible',
          model: 'local-model',
          baseUrl: 'http://127.0.0.1:11434/v1'
        })
      )
      expect(result.config.observability.openTelemetry).toEqual(
        expect.objectContaining({
          enabled: true,
          endpoint: 'http://127.0.0.1:4318/v1/traces'
        })
      )
      expect(result.config.observability.logging.level).toBe('debug')
      expect(result.config.costs).toEqual(
        expect.objectContaining({
          inputPerMillion: 0.25,
          cachedInputPerMillion: 0.05,
          outputPerMillion: 1.25
        })
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // `CODEREVIEWER_JUDGE_MODEL` exists so a model comparison can hold the eval's
  // scorer FIXED while `CODEREVIEWER_PROVIDER_MODEL` varies the reviewer under
  // test. It is therefore mapped exactly like the provider model -- same closed
  // list, same precedence -- and this proves the two move independently.
  test('maps the judge model override with the same precedence as the provider model', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, '.codereviewer'), { recursive: true })
      await writeFile(
        join(root, '.codereviewer/config.json'),
        JSON.stringify({
          evaluation: {
            judgeModel: 'file-judge-model'
          }
        })
      )

      const fromFile = await loadCodeReviewerConfig({
        repositoryRoot: root,
        environment: {},
        loadDotEnv: false
      })

      expect(fromFile.config.evaluation.judgeModel).toBe('file-judge-model')

      const fromProcessEnv = await loadCodeReviewerConfig({
        repositoryRoot: root,
        environment: {
          CODEREVIEWER_JUDGE_MODEL: 'env-judge-model',
          CODEREVIEWER_PROVIDER_ID: 'openai',
          CODEREVIEWER_PROVIDER_MODEL: 'env-reviewer-model'
        },
        loadDotEnv: false
      })

      expect(fromProcessEnv.config.evaluation.judgeModel).toBe('env-judge-model')
      // The reviewer's model moved and the judge's did not follow it.
      expect(fromProcessEnv.config.provider?.model).toBe('env-reviewer-model')

      await writeFile(
        join(root, '.env'),
        'CODEREVIEWER_JUDGE_MODEL=dotenv-judge-model'
      )

      const fromDotEnv = await loadCodeReviewerConfig({
        repositoryRoot: root,
        environment: {
          CODEREVIEWER_JUDGE_MODEL: 'env-judge-model'
        }
      })

      expect(fromDotEnv.config.evaluation.judgeModel).toBe('dotenv-judge-model')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('unset judge model leaves the eval judges on the reviewer model', async () => {
    const root = await createTempDir()

    try {
      const result = await loadCodeReviewerConfig({
        repositoryRoot: root,
        environment: {},
        loadDotEnv: false
      })

      // Absent, not defaulted to a model name: the eval CLI reads the absence
      // as "use the reviewer's alias unchanged", which is the historical
      // behaviour it must reproduce byte for byte.
      expect(result.config.evaluation.judgeModel).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('maps AI review environment overrides into typed config', async () => {
    const root = await createTempDir()

    try {
      const result = await loadCodeReviewerConfig({
        repositoryRoot: root,
        environment: {
          CODEREVIEWER_AI_DETERMINISTIC_SIGNAL_MODE: 'disabled'
        },
        loadDotEnv: false
      })

      expect(result.config.aiReview.deterministicSignalMode).toBe('disabled')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('can skip root env file loading for hermetic commands', async () => {
    const root = await createTempDir()

    try {
      await writeFile(
        join(root, '.env'),
        [
          'CODEREVIEWER_PROVIDER_ID=openai-compatible',
          'CODEREVIEWER_PROVIDER_MODEL=local-model',
          'CODEREVIEWER_PROVIDER_BASE_URL=http://127.0.0.1:11434/v1'
        ].join('\n')
      )

      const result = await loadCodeReviewerConfig({
        repositoryRoot: root,
        environment: {},
        loadDotEnv: false
      })

      expect(result.config.provider).toBeUndefined()
      expect(result.environment.CODEREVIEWER_PROVIDER_ID).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rejects invalid env files and supports configured review paths', async () => {
    const root = await createTempDir()

    try {
      await writeFile(join(root, '.env'), 'CODEREVIEWER_PROVIDER_ID')

      await expect(loadCodeReviewerConfig({ repositoryRoot: root })).rejects.toThrow(
        'Invalid .env line'
      )

      await writeFile(
        join(root, '.env'),
        'CODEREVIEWER_CONFIG_PATH=.codereviewer/custom.json\n'
      )
      await mkdir(join(root, '.codereviewer'), { recursive: true })
      await writeFile(
        join(root, '.codereviewer/custom.json'),
        JSON.stringify({
          skills: {
            enabled: true
          }
        })
      )

      const result = await loadCodeReviewerConfig({ repositoryRoot: root })

      expect(result.config.skills.directories).toEqual(['.codereviewer/skills'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rejects unknown keys and unsafe instruction or skill paths', async () => {
    const root = await createTempDir()

    try {
      await writeFile(
        join(root, 'config.json'),
        JSON.stringify({
          unknown: true
        })
      )

      await expect(
        loadCodeReviewerConfig({ repositoryRoot: root, configPath: 'config.json' })
      ).rejects.toThrow()

      await writeFile(
        join(root, 'config.json'),
        JSON.stringify({
          instructions: { files: [{ path: '../instructions.md' }] },
          skills: { enabled: true, directories: ['skills'] }
        })
      )

      await expect(
        loadCodeReviewerConfig({ repositoryRoot: root, configPath: 'config.json' })
      ).rejects.toThrow()

      await writeFile(
        join(root, 'config.json'),
        JSON.stringify({
          skills: { enabled: true, directories: ['../skills'] }
        })
      )

      await expect(
        loadCodeReviewerConfig({ repositoryRoot: root, configPath: 'config.json' })
      ).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rejects prototype-pollution keys in config files', async () => {
    const root = await createTempDir()

    try {
      await writeFile(
        join(root, 'config.json'),
        '{"review":{"mode":"local"},"__proto__":{"polluted":true}}'
      )

      await expect(
        loadCodeReviewerConfig({ repositoryRoot: root, configPath: 'config.json' })
      ).rejects.toThrow(/Unsupported configuration key/u)

      expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('shows provider baseUrl by host only in the config summary', async () => {
    const result = await loadCodeReviewerConfig({
      repositoryRoot: await createTempDir(),
      cliConfig: {
        provider: {
          id: 'openai-compatible',
          model: 'local-model',
          baseUrl: 'https://user:secret-pass@models.internal:8443/v1?token=abc'
        }
      }
    })

    const summary = createRedactedConfigSummary(result.config)

    expect(summary).toContain('https://models.internal:8443')
    expect(summary).not.toContain('secret-pass')
    expect(summary).not.toContain('token=abc')
    expect(summary).not.toContain('/v1')
  })

  test('redacts config summary values', async () => {
    const result = await loadCodeReviewerConfig({
      repositoryRoot: await createTempDir(),
      cliConfig: {
        provider: {
          id: 'openai',
          model: 'gpt-test'
        },
        instructions: {
          inline: 'token sk-proj-abcdefghijklmnopqrstuvwxyz123456'
        },
        observability: {
          openTelemetry: {
            enabled: true,
            endpoint: 'http://127.0.0.1:4318/v1/traces',
            headers: {
              Authorization: 'Bearer arbitrary-secret-value',
              'x-custom-header': 'plain-sensitive-value'
            }
          }
        }
      }
    })

    const summary = createRedactedConfigSummary(result.config)

    expect(summary).not.toContain('sk-proj-abcdefghijklmnopqrstuvwxyz123456')
    expect(summary).not.toContain('arbitrary-secret-value')
    expect(summary).not.toContain('plain-sensitive-value')
    expect(summary).toContain('[REDACTED]')
  })
})
