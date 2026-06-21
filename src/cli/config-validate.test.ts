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
