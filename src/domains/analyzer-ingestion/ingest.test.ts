import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { SecuritySignalsConfigSchema } from '../../shared/contracts/index.js'
import { createRedactor } from '../../shared/redaction/redactor.js'
import { createAnalyzerPathResolver, ingestAnalyzerArtifacts } from './ingest.js'
import type { ChangedLineRange } from './changed-side-attribution.js'

const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))

const changedRanges: readonly ChangedLineRange[] = [
  { path: 'src/service/orders.ts', startLine: 40, endLine: 48, changeKind: 'modified' }
]

const signalsConfig = (overrides: Record<string, unknown> = {}) =>
  SecuritySignalsConfigSchema.parse({
    enabled: true,
    artifacts: [{ path: 'reports/analyzer.sarif.json' }],
    ...overrides
  })

const redactor = createRedactor()
const redact = (value: string): string => redactor.redact(value)

let repositoryRoot: string

beforeEach(async () => {
  repositoryRoot = await mkdtemp(path.join(tmpdir(), 'codereviewer-analyzer-'))
  await mkdir(path.join(repositoryRoot, 'reports'), { recursive: true })
})

afterEach(async () => {
  await rm(repositoryRoot, { recursive: true, force: true })
})

const installFixture = async (name: string): Promise<void> => {
  await copyFile(
    fixturePath(name),
    path.join(repositoryRoot, 'reports', 'analyzer.sarif.json')
  )
}

describe('analyzer artifact ingestion', () => {
  test('reports alerts attributable to the change and holds back pre-existing debt', async () => {
    await installFixture('analyzer-results.sarif.json')

    const result = await ingestAnalyzerArtifacts({
      repositoryRoot,
      signals: signalsConfig(),
      paths: {},
      changedRanges,
      redact
    })

    expect(result.alerts.map((entry) => entry.alert.ruleId)).toEqual([
      'security/query-injection',
      'security/command-injection'
    ])
    expect(result.alerts.map((entry) => entry.attribution)).toEqual([
      'changed-line',
      'changed-flow'
    ])

    const metric = result.metrics[0]

    expect(metric?.analyzer).toBe('example-analyzer')
    expect(metric?.analyzerVersion).toBe('3.4.5')
    expect(metric?.resultCount).toBe(6)
    // Outside the repository, no location at all, and no rule id.
    expect(metric?.unusableCount).toBe(3)
    expect(metric?.attributedCount).toBe(2)
    // The weak-hash result sits entirely in unchanged code.
    expect(metric?.preExistingCount).toBe(1)
  })

  test('every loss is disclosed as a warning', async () => {
    await installFixture('analyzer-results.sarif.json')

    const result = await ingestAnalyzerArtifacts({
      repositoryRoot,
      signals: signalsConfig(),
      paths: {},
      changedRanges,
      redact
    })

    expect(result.warnings.join('\n')).toContain(
      '3 of 6 results could not be used'
    )
    expect(result.warnings.join('\n')).toContain(
      '1 results have no changed-side cause and are NOT reported'
    )
  })

  test('an empty artifact is reported as an empty scan, not a clean repository', async () => {
    await installFixture('empty-run.sarif.json')

    const result = await ingestAnalyzerArtifacts({
      repositoryRoot,
      signals: signalsConfig(),
      paths: {},
      changedRanges,
      redact
    })

    expect(result.alerts).toEqual([])
    expect(result.warnings.join('\n')).toContain('contains no results')
  })

  test('a run with no changed ranges reports nothing and says why', async () => {
    await installFixture('analyzer-results.sarif.json')

    const result = await ingestAnalyzerArtifacts({
      repositoryRoot,
      signals: signalsConfig(),
      paths: {},
      changedRanges: [],
      redact
    })

    expect(result.alerts).toEqual([])
    expect(result.warnings.join('\n')).toContain(
      'no analyzer result can be tied to a change'
    )
  })

  test('the alert cap keeps the highest-severity alerts and discloses the rest', async () => {
    await installFixture('analyzer-results.sarif.json')

    const result = await ingestAnalyzerArtifacts({
      repositoryRoot,
      signals: signalsConfig({ maxAlerts: 1 }),
      paths: {},
      changedRanges,
      redact
    })

    expect(result.alerts).toHaveLength(1)
    expect(result.alerts[0]?.alert.ruleId).toBe('security/query-injection')
    expect(result.warnings.join('\n')).toContain(
      '2 analyzer results were attributed to this change but security.signals.maxAlerts is 1'
    )
  })

  test('a missing artifact fails loudly instead of reporting no security signals', async () => {
    await expect(
      ingestAnalyzerArtifacts({
        repositoryRoot,
        signals: signalsConfig(),
        paths: {},
        changedRanges,
        redact
      })
    ).rejects.toMatchObject({
      code: 'analyzer_artifact_unreadable',
      exitCode: 2
    })
  })

  test('an artifact path that traverses above the repository is rejected by configuration', () => {
    expect(() =>
      SecuritySignalsConfigSchema.parse({
        enabled: true,
        artifacts: [{ path: 'reports/../../escape.sarif.json' }]
      })
    ).toThrow(/traverse above root/u)
  })

  test('an artifact symlinked to a target outside the repository is rejected', async () => {
    // The escape a `..` check cannot catch: the configured path is contained, the
    // real target is not. Only the repository path service's realpath containment
    // check rejects it.
    const outsideRoot = await mkdtemp(path.join(tmpdir(), 'codereviewer-outside-'))

    try {
      const outsideArtifact = path.join(outsideRoot, 'escape.sarif.json')
      await copyFile(fixturePath('analyzer-results.sarif.json'), outsideArtifact)
      await symlink(
        outsideArtifact,
        path.join(repositoryRoot, 'reports', 'analyzer.sarif.json')
      )

      await expect(
        ingestAnalyzerArtifacts({
          repositoryRoot,
          signals: signalsConfig(),
          paths: {},
          changedRanges,
          redact
        })
      ).rejects.toMatchObject({ code: 'analyzer_artifact_unreadable' })
    } finally {
      await rm(outsideRoot, { recursive: true, force: true })
    }
  })

  test('a malformed artifact fails loudly', async () => {
    await installFixture('malformed.sarif.json')

    await expect(
      ingestAnalyzerArtifacts({
        repositoryRoot,
        signals: signalsConfig(),
        paths: {},
        changedRanges,
        redact
      })
    ).rejects.toMatchObject({ code: 'analyzer_artifact_invalid' })
  })

  test('an unsupported SARIF version fails loudly', async () => {
    await installFixture('unsupported-version.sarif.json')

    await expect(
      ingestAnalyzerArtifacts({
        repositoryRoot,
        signals: signalsConfig(),
        paths: {},
        changedRanges,
        redact
      })
    ).rejects.toMatchObject({ code: 'analyzer_artifact_invalid' })
  })

  test('an oversized artifact fails loudly and is never read partially', async () => {
    await installFixture('analyzer-results.sarif.json')

    await expect(
      ingestAnalyzerArtifacts({
        repositoryRoot,
        signals: signalsConfig({ maxArtifactBytes: 16 }),
        paths: {},
        changedRanges,
        redact
      })
    ).rejects.toMatchObject({ code: 'analyzer_artifact_too_large' })
  })

  test('secrets in analyzer message text are redacted before they can be shown', async () => {
    await installFixture('analyzer-results.sarif.json')

    const result = await ingestAnalyzerArtifacts({
      repositoryRoot,
      signals: signalsConfig(),
      paths: {},
      changedRanges,
      redact
    })

    expect(result.alerts[0]?.alert.message).not.toContain(
      'sk-abcdefghijklmnopqrstuvwx'
    )
    expect(result.alerts[0]?.alert.message).toContain('[REDACTED]')
  })

  test('an artifact that is a directory rather than a file fails loudly', async () => {
    await mkdir(path.join(repositoryRoot, 'reports', 'analyzer.sarif.json'), {
      recursive: true
    })

    await expect(
      ingestAnalyzerArtifacts({
        repositoryRoot,
        signals: signalsConfig(),
        paths: {},
        changedRanges,
        redact
      })
    ).rejects.toMatchObject({ code: 'analyzer_artifact_unreadable' })
  })

  test('an artifact carrying invalid JSON text fails as invalid, not as empty', async () => {
    await writeFile(
      path.join(repositoryRoot, 'reports', 'analyzer.sarif.json'),
      'not json at all',
      'utf8'
    )

    await expect(
      ingestAnalyzerArtifacts({
        repositoryRoot,
        signals: signalsConfig(),
        paths: {},
        changedRanges,
        redact
      })
    ).rejects.toMatchObject({ code: 'analyzer_artifact_invalid' })
  })
})

describe('analyzer path resolution', () => {
  const resolve = createAnalyzerPathResolver({ paths: {} })

  test('accepts a repository-relative path', () => {
    expect(resolve('src/service/orders.ts')).toBe('src/service/orders.ts')
  })

  test('accepts a Windows-style separator', () => {
    expect(resolve('src\\service\\orders.ts')).toBe('src/service/orders.ts')
  })

  test('decodes percent-escapes', () => {
    expect(resolve('src/service/order%20list.ts')).toBe(
      'src/service/order list.ts'
    )
  })

  test('rejects a path that traverses above the repository', () => {
    expect(resolve('../outside/secrets.txt')).toBeUndefined()
  })

  test('rejects an absolute path', () => {
    expect(resolve('/etc/shadow')).toBeUndefined()
  })

  test('rejects a URI with a scheme', () => {
    expect(resolve('file:///etc/shadow')).toBeUndefined()
    expect(resolve('https://example.invalid/a.ts')).toBeUndefined()
  })

  test('rejects a path the eligibility floor excludes', () => {
    expect(resolve('.env')).toBeUndefined()
    expect(resolve('node_modules/pkg/index.js')).toBeUndefined()
  })

  test('rejects a path outside the configured include globs', () => {
    const scoped = createAnalyzerPathResolver({
      paths: { include: ['src/**'] }
    })

    expect(scoped('src/a.ts')).toBe('src/a.ts')
    expect(scoped('other/a.ts')).toBeUndefined()
  })
})
