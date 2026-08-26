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
      // Nothing was written down, so nothing was asked for.
      expect(result.contextProvidersExplicitlyConfigured).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // The signal a defaulted provider set cannot carry past the schema. After
  // `CodeReviewerConfigSchema.parse` an operator who listed the default providers
  // and one who listed none hold the identical value, and change-intent ingestion
  // needs to tell them apart: a provider nobody asked for finding nothing is the
  // ordinary case and says nothing, while one a human named and did not get still
  // warns — which is what keeps a mistyped directory diagnosable.
  describe('explicit context providers', () => {
    const loadWith = async (
      contextSources: Record<string, unknown> | undefined
    ): Promise<boolean> => {
      const root = await createTempDir()

      try {
        await mkdir(join(root, '.codereviewer'), { recursive: true })
        await writeFile(
          join(root, '.codereviewer/config.json'),
          JSON.stringify(contextSources === undefined ? {} : { contextSources })
        )

        return (await loadCodeReviewerConfig({ repositoryRoot: root }))
          .contextProvidersExplicitlyConfigured
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }

    test('is false when the block is absent', async () => {
      expect(await loadWith(undefined)).toBe(false)
    })

    // Unlike `baseline.enabled`, which names the file `baseline.path` already
    // points at, `contextSources.enabled` names no source: it switches on a
    // DEFAULTED set, so the operator still asked for nothing in particular.
    test('is false when only the block is switched on', async () => {
      expect(await loadWith({ enabled: true })).toBe(false)
    })

    test('is true when providers are listed, even as the default set', async () => {
      expect(
        await loadWith({
          providers: [{ type: 'inbox' }, { type: 'changed-files' }]
        })
      ).toBe(true)
    })

    test('is true for an empty provider list, which is also a choice', async () => {
      expect(await loadWith({ providers: [] })).toBe(true)
    })
  })

  // The same question through the OTHER two inputs the loader merges. A provider
  // set supplied on the command line is as explicit as one in the file, and
  // reading only the file would silently drop the CLI arm's diagnostic.
  test('reads explicit context providers out of CLI overrides too', async () => {
    const root = await createTempDir()

    try {
      const result = await loadCodeReviewerConfig({
        repositoryRoot: root,
        cliConfig: {
          contextSources: {
            providers: [{ type: 'inbox', dir: 'ops/context' }]
          }
        }
      })

      expect(result.contextProvidersExplicitlyConfigured).toBe(true)
      expect(result.config.contextSources.providers).toHaveLength(1)
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

  // A malformed config file is a first-hour failure, and it used to surface as
  // `JSON.parse`'s own message alone — "Unexpected end of JSON input", with no
  // file name, no statement that configuration was what failed, and no remedy.
  test('names the file and the remedy when a config file is not valid JSON', async () => {
    const root = await createTempDir()

    try {
      await writeFile(join(root, 'config.json'), '{ "provider": ')

      await expect(
        loadCodeReviewerConfig({ repositoryRoot: root, configPath: 'config.json' })
      ).rejects.toMatchObject({
        code: 'config_error',
        category: 'config',
        exitCode: 2,
        message: expect.stringContaining(
          'The configuration file "config.json" is not valid JSON'
        ),
        details: { configPath: 'config.json' }
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('names the file when a config file holds JSON that is not an object', async () => {
    const root = await createTempDir()

    try {
      await writeFile(join(root, 'config.json'), '[]')

      await expect(
        loadCodeReviewerConfig({ repositoryRoot: root, configPath: 'config.json' })
      ).rejects.toMatchObject({
        code: 'config_error',
        message: expect.stringContaining('is not a JSON object')
      })
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
