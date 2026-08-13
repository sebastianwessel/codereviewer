import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import { runCli } from './index.js'

const createTempDir = async (): Promise<string> => {
  const directory = join(tmpdir(), `codereviewer-cli-${crypto.randomUUID()}`)
  await mkdir(directory, { recursive: true })
  return directory
}

describe('config validate CLI', () => {
  test('validates defaults and returns a redacted summary', async () => {
    const root = await createTempDir()

    try {
      const result = await runCli(['config', 'validate'], {
        cwd: root,
        environment: {}
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('"mode": "local"')
      expect(result.stderr).toBe('')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // Absence at the DEFAULT path is the ordinary case and must stay silent-ish:
  // most repositories have no config file and the defaults are what they meant.
  // The test above already covers it; this one covers the other half, which used
  // to be read the same way and must not be.
  test.each([
    ['as a flag', ['config', 'validate', '--config', 'nope.json'], {}],
    ['as a joined flag', ['config', 'validate', '--config=nope.json'], {}],
    [
      'from the environment',
      ['config', 'validate'],
      { CODEREVIEWER_CONFIG_PATH: 'nope.json' }
    ]
  ])(
    'a config file requested %s but absent stops the run',
    async (_label, args, environment) => {
      const root = await createTempDir()

      try {
        const result = await runCli(args, { cwd: root, environment })

        // Continuing on defaults would run with settings nobody asked for and
        // report success — the failure that once cost an A/B $11.50.
        expect(result.exitCode).toBe(2)
        expect(result.stderr).toContain('config_error')
        expect(result.stderr).toContain('nope.json')
        expect(result.stdout).toBe('')
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  )

  test('returns exit code 2 for invalid config', async () => {
    const root = await createTempDir()

    try {
      await writeFile(join(root, 'bad.json'), JSON.stringify({ provider: { id: 'openai' } }))

      const result = await runCli(['config', 'validate', '--config', 'bad.json'], {
        cwd: root,
        environment: {}
      })

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('config_error')
      expect(result.stdout).toBe('')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rejects unknown commands', async () => {
    const result = await runCli(['unknown'], {
      cwd: await createTempDir(),
      environment: {}
    })

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('usage_error')
  })
})

// `config validate` took its EXIT CODE from the real error and hardcoded the
// `code` it printed, so the two could disagree — in the one command whose whole
// job is telling an operator what is wrong with their configuration. A
// `redaction_secret_env_unset` (added 2026-08-11) printed as `config_error` while
// exiting on its own code, sending the reader to look for a malformed config
// document when a named environment variable was simply unset.
//
// Every other command reports `normalized.code` through `mapErrorResult`; this
// one was the exception, and being the exception is what made it wrong.
describe('the reported code is the real one', () => {
  test('reports a structured error under its own code, not config_error', async () => {
    const root = await createTempDir()
    await mkdir(join(root, '.codereviewer'), { recursive: true })
    await writeFile(
      join(root, '.codereviewer', 'config.json'),
      JSON.stringify({
        security: { redaction: { secretEnvVars: ['NOT_SET_ANYWHERE_XYZ'] } }
      }),
      'utf8'
    )

    const result = await runCli(['config', 'validate'], {
      cwd: root,
      environment: {}
    })

    expect(result.stderr).toContain('redaction_secret_env_unset')
    expect(result.stderr).not.toContain('config_error')
  })
})
