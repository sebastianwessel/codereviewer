import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import { runCli } from './index.js'

const createRoot = async (): Promise<string> => {
  const root = join(tmpdir(), `codereviewer-drift-cli-${crypto.randomUUID()}`)
  await mkdir(join(root, 'docs'), { recursive: true })
  await mkdir(join(root, 'specs', '03-contracts'), { recursive: true })
  await mkdir(join(root, 'schema'), { recursive: true })
  return root
}

describe('drift CLI', () => {
  test('reports warnings without failing when no hard drift exists', async () => {
    const root = await createRoot()

    try {
      await writeFile(join(root, 'README.md'), 'This should be robust.\n')
      await writeFile(join(root, 'schema', 'codereviewer-config.schema.json'), '{}\n')
      await writeFile(join(root, 'specs', '03-contracts', 'config.schema.json'), '{}\n')

      const result = await runCli(['drift', 'check'], {
        cwd: root,
        environment: {}
      })

      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual(
        expect.objectContaining({
          passed: true,
          warningCount: 1,
          errorCount: 0
        })
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('fails when hard drift exists', async () => {
    const root = await createRoot()

    try {
      await writeFile(join(root, 'README.md'), `Old .${'review'} path\n`)
      await writeFile(join(root, 'schema', 'codereviewer-config.schema.json'), '{"a":1}\n')
      await writeFile(join(root, 'specs', '03-contracts', 'config.schema.json'), '{"a":2}\n')

      const result = await runCli(['drift', 'check'], {
        cwd: root,
        environment: {}
      })

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toBe('')
      expect(JSON.parse(result.stdout).errorCount).toBeGreaterThan(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
