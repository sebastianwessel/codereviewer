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
    await mkdir(join(root, '.codereviewer'), { recursive: true })
    await writeFile(join(root, 'src', 'app.ts'), 'export const value = ;\n')
    // Deterministic-only on purpose: this test needs a completed run to write a
    // baseline from, not a model search, and it configures no provider — which a
    // run that still asked for a model review would be refused for.
    await writeFile(
      join(root, '.codereviewer', 'config.json'),
      JSON.stringify({ aiReview: { enabled: false } })
    )

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

  // A document that merely parses as JSON is not a report. Before the source was
  // schema-checked, each of these produced an empty baseline and exit 0 — the
  // caller was told a baseline had been built from a file that is not a report.
  test.each([
    ['not JSON at all', 'this is not json'],
    ['an unrelated JSON object', '{"runs":[]}'],
    ['a baseline file', '[]'],
    ['a report missing admittedFindings', '{"run":{"runId":"r1"}}']
  ])('refuses to build a baseline from %s', async (_label, content) => {
    const root = await createTempDir()

    await mkdir(join(root, '.codereviewer'), { recursive: true })
    await writeFile(join(root, '.codereviewer', 'source.json'), content)

    const result = await runCli(
      ['baseline', 'write', '--report', '.codereviewer/source.json'],
      { cwd: root, environment: {} }
    )

    expect(result.exitCode).toBe(3)
    expect(result.stderr).toContain('baseline_source_invalid')
    expect(result.stdout).toBe('')

    // Nothing was written: a rejected source leaves any existing baseline alone.
    await expect(
      readFile(join(root, '.codereviewer/baseline.json'), 'utf8')
    ).rejects.toThrow()
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
