import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../../shared/contracts/index.js'
import { runDriftCheck } from './drift-checker.js'

const createRoot = async (): Promise<string> => {
  const root = join(tmpdir(), `codereviewer-drift-${crypto.randomUUID()}`)
  await mkdir(root, { recursive: true })
  return root
}

describe('drift checker', () => {
  test('passes for valid docs and matching generated schemas', async () => {
    const root = await createRoot()

    try {
      await mkdir(join(root, 'docs'), { recursive: true })
      await mkdir(join(root, 'specs', '03-contracts'), { recursive: true })
      await mkdir(join(root, 'schema'), { recursive: true })
      await writeFile(
        join(root, 'README.md'),
        [
          '# CodeReviewer',
          '',
          'CodeReviewer is documented here.',
          'Default excludes include `.codereviewer/**`.',
          '',
          '[Docs](docs/README.md)',
          '',
          '```bash',
          'npx tsx src/cli/main.ts review --file src/app.ts',
          '```'
        ].join('\n')
      )
      await writeFile(join(root, 'docs', 'README.md'), '# Docs\n')
      await writeFile(join(root, 'schema', 'codereviewer-config.schema.json'), '{"ok":true}\n')
      await writeFile(join(root, 'specs', '03-contracts', 'config.schema.json'), '{"ok":true}\n')

      const result = await runDriftCheck({
        repositoryRoot: root,
        config: CodeReviewerConfigSchema.parse({})
      })

      expect(result.passed).toBe(true)
      expect(result.findings).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('flags documented CLI commands that are not implemented', async () => {
    const root = await createRoot()

    try {
      await mkdir(join(root, 'docs'), { recursive: true })
      await writeFile(
        join(root, 'README.md'),
        ['Run `codereviewer review` to review.', 'Run `codereviewer publish` to ship.'].join(
          '\n'
        )
      )

      const result = await runDriftCheck({
        repositoryRoot: root,
        config: CodeReviewerConfigSchema.parse({})
      })

      const implementationDrift = result.findings.filter(
        (finding) => finding.category === 'implementation-drift'
      )
      expect(implementationDrift).toHaveLength(1)
      expect(implementationDrift[0]?.evidence).toBe('codereviewer publish')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('flags stale queue-owned provider retry claims', async () => {
    const root = await createRoot()

    try {
      await mkdir(join(root, 'docs'), { recursive: true })
      await writeFile(
        join(root, 'README.md'),
        [
          'Provider-backed tasks use bounded queue-owned retries for transient failures.',
          'The queue owns bounded retries and records attempt counts.'
        ].join('\n')
      )

      const result = await runDriftCheck({
        repositoryRoot: root,
        config: CodeReviewerConfigSchema.parse({})
      })

      const retryDrift = result.findings.filter(
        (finding) => finding.category === 'implementation-drift'
      )
      expect(retryDrift).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Stale provider retry ownership claim found.',
            evidence: 'queue-owned retries'
          }),
          expect.objectContaining({
            message: 'Stale provider retry ownership claim found.',
            evidence: 'queue owns bounded retries'
          })
        ])
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('classifies stale paths, broken links, generated drift, and ambiguity', async () => {
    const root = await createRoot()

    try {
      await mkdir(join(root, 'docs'), { recursive: true })
      await mkdir(join(root, 'specs', '03-contracts'), { recursive: true })
      await mkdir(join(root, 'schema'), { recursive: true })
      await writeFile(
        join(root, 'README.md'),
        [
          '[Missing](docs/missing.md)',
          'Old path spec/07-security-privacy-operations.md',
          `Old artifact .${'review'}/runs`,
          'This should be robust.'
        ].join('\n')
      )
      await writeFile(join(root, 'schema', 'codereviewer-config.schema.json'), '{"a":1}\n')
      await writeFile(join(root, 'specs', '03-contracts', 'config.schema.json'), '{"a":2}\n')

      const result = await runDriftCheck({
        repositoryRoot: root,
        config: CodeReviewerConfigSchema.parse({})
      })

      expect(result.passed).toBe(false)
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ category: 'documentation-drift' }),
          expect.objectContaining({ category: 'spec-drift' }),
          expect.objectContaining({ category: 'security-drift', gate: 'error' }),
          expect.objectContaining({ category: 'generated-artifact-drift', gate: 'error' }),
          expect.objectContaining({ category: 'ambiguity', gate: 'warning' })
        ])
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
