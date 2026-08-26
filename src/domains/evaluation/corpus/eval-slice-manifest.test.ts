import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import { createEvalSliceManifest } from './eval-slice-manifest.js'
import { stableJsonDigest } from '../../../shared/json/stable-json-digest.js'

const createTempDir = async (): Promise<string> => {
  const directory = join(
    tmpdir(),
    `codereviewer-eval-manifest-${crypto.randomUUID()}`
  )
  await mkdir(directory, { recursive: true })
  return directory
}

const writeBenchmarkSlice = async (root: string): Promise<void> => {
  const sliceRoot = join(root, 'eval', 'benchmarks', 'pack-a', 'case-a')
  await mkdir(join(sliceRoot, 'repo', 'src'), { recursive: true })
  await writeFile(
    join(sliceRoot, 'repo', 'src', 'app.ts'),
    'const secretSourceText = "do-not-print-this-source";\n'
  )
  await writeFile(
    join(sliceRoot, 'slice.json'),
    JSON.stringify(
      {
        id: 'case-a',
        source: 'benchmark-pack',
        sourceProfile: 'benchmark-semantic',
        language: 'typescript',
        changedFiles: ['src/app.ts'],
        expectedFindings: [
          {
            category: 'bug',
            severity: 'high',
            semanticSummary: 'semantic issue from benchmark golden comment',
            matchMode: 'semantic-only'
          },
          {
            path: 'src/app.ts',
            lineRange: [1, 1],
            category: 'bug',
            severity: 'medium',
            semanticSummary: 'line-bearing issue from benchmark golden comment'
          }
        ],
        expectedNoFindingZones: [
          {
            path: 'src/app.ts',
            lineRange: [2, 2],
            reason: 'unchanged helper area'
          }
        ],
        tags: ['pack']
      },
      null,
      2
    )
  )
}

describe('eval slice manifest', () => {
  test('creates a deterministic manifest without source text', async () => {
    const root = await createTempDir()

    try {
      await writeBenchmarkSlice(root)

      const first = await createEvalSliceManifest({
        repositoryRoot: root,
        sliceRoot: 'eval/benchmarks/pack-a',
        generatedAt: '2026-06-21T00:00:00.000Z'
      })
      const second = await createEvalSliceManifest({
        repositoryRoot: root,
        sliceRoot: 'eval/benchmarks/pack-a',
        generatedAt: '2026-06-21T00:01:00.000Z'
      })

      expect(first).toMatchObject({
        schemaVersion: '1.0',
        generatedAt: '2026-06-21T00:00:00.000Z',
        sliceRoot: 'eval/benchmarks/pack-a',
        caseCount: 1,
        caseIds: ['case-a']
      })
      expect(first.digest).toMatch(/^[a-f0-9]{64}$/u)
      expect(second.digest).toBe(first.digest)
      expect(first.cases).toEqual([
        expect.objectContaining({
          id: 'case-a',
          language: 'typescript',
          sourceProfile: 'benchmark-semantic',
          tags: ['benchmark-pack', 'benchmark-semantic', 'pack'],
          changedFileCount: 1,
          expectedFindingCount: 2,
          semanticOnlyExpectedCount: 1,
          lineBearingExpectedCount: 1,
          noFindingZoneCount: 1,
          repositoryFileCount: 1
        })
      ])
      expect(first.cases[0]?.repositoryBytes).toBeGreaterThan(0)
      expect(first.cases[0]?.sliceJsonSha256).toMatch(/^[a-f0-9]{64}$/u)
      expect(first.cases[0]?.repositoryTreeSha256).toMatch(/^[a-f0-9]{64}$/u)
      expect(JSON.stringify(first)).not.toContain('do-not-print-this-source')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // The manifest digest and the answer-key/config digests decide the same thing
  // -- whether two runs may be compared -- and used to be produced by two
  // independently-written canonical serializers that disagreed on `undefined`.
  // This pins the manifest to the shared one, so a re-added private copy that
  // canonicalizes differently is caught here rather than as an unexplained
  // mismatch between two archived runs.
  test('digests the manifest payload with the shared canonical serializer', async () => {
    const root = await createTempDir()

    try {
      await writeBenchmarkSlice(root)

      const manifest = await createEvalSliceManifest({
        repositoryRoot: root,
        sliceRoot: 'eval/benchmarks/pack-a',
        generatedAt: '2026-06-21T00:00:00.000Z'
      })

      expect(manifest.digest).toBe(
        stableJsonDigest({
          schemaVersion: manifest.schemaVersion,
          sliceRoot: manifest.sliceRoot,
          caseCount: manifest.caseCount,
          caseIds: manifest.caseIds,
          cases: manifest.cases
        })
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
