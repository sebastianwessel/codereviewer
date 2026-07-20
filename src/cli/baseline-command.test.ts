import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import { runCli } from './index.js'

const createTempDir = async (): Promise<string> => {
  const directory = join(tmpdir(), `codereviewer-baseline-cli-${crypto.randomUUID()}`)
  await mkdir(directory, { recursive: true })
  return directory
}

describe('baseline write CLI', () => {
  test('writes a baseline from the newest run recorded in the index', async () => {
    const root = await createTempDir()

    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'app.ts'), 'export const value = ;\n')

    const review = await runCli(['review', '--file', 'src/app.ts'], {
      cwd: root,
      environment: {}
    })
    expect(review.exitCode).toBe(0)

    // The run index is what lets `baseline write` find the report at all.
    const index = JSON.parse(
      await readFile(join(root, '.codereviewer/runs/index.json'), 'utf8')
    )
    expect(index.runs[0]).toMatchObject({
      runId: JSON.parse(review.stdout).runId,
      status: 'completed'
    })

    const result = await runCli(['baseline', 'write'], {
      cwd: root,
      environment: {}
    })

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')

    const written = JSON.parse(
      await readFile(join(root, '.codereviewer/baseline.json'), 'utf8')
    )
    const report = JSON.parse(
      await readFile(
        join(root, JSON.parse(result.stdout).sourceReportPath as string),
        'utf8'
      )
    )

    // Every admitted finding is represented, and only by its fingerprints.
    expect(written).toHaveLength(report.admittedFindings.length)
    expect(JSON.parse(result.stdout).entryCount).toBe(written.length)
    for (const entry of written) {
      expect(Object.keys(entry)).toEqual(['fingerprints'])
    }
  })

  test('fails with baseline_source_unavailable when no run exists', async () => {
    const root = await createTempDir()

    const result = await runCli(['baseline', 'write'], {
      cwd: root,
      environment: {}
    })

    expect(result.exitCode).toBe(3)
    expect(result.stderr).toContain('baseline_source_unavailable')
  })

  test('fails with baseline_source_unavailable for an unreadable report', async () => {
    const root = await createTempDir()

    const result = await runCli(
      ['baseline', 'write', '--report', '.codereviewer/runs/missing/report.json'],
      { cwd: root, environment: {} }
    )

    expect(result.exitCode).toBe(3)
    expect(result.stderr).toContain('baseline_source_unavailable')
  })

  test('review never writes the baseline itself', async () => {
    const root = await createTempDir()

    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'app.ts'), 'export const value = ;\n')

    await runCli(['review', '--file', 'src/app.ts'], {
      cwd: root,
      environment: {}
    })

    await expect(
      readFile(join(root, '.codereviewer/baseline.json'), 'utf8')
    ).rejects.toThrow()
  })
})
