import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  assertBenchmarkSlicesHydrated,
  hydrateCodeReviewBenchmarkPack,
  isPlaceholderPositiveSlice,
  materializeDiffFiles,
  placeholderSliceMarker
} from './benchmark-hydration.js'

describe('placeholder positive slice detection', () => {
  test('flags a positive slice that still carries the hydration marker', () => {
    expect(
      isPlaceholderPositiveSlice({
        expectedFindings: [{ category: 'bug' }],
        diff: `diff --git a/src/app.ts b/src/app.ts\n${placeholderSliceMarker}`
      })
    ).toBe(true)
  })

  test('does not flag a hydrated positive slice', () => {
    expect(
      isPlaceholderPositiveSlice({
        expectedFindings: [{ category: 'bug' }],
        diff: 'diff --git a/src/app.ts b/src/app.ts\n+realChange()'
      })
    ).toBe(false)
  })

  test('allows negative slices to remain placeholders', () => {
    expect(
      isPlaceholderPositiveSlice({
        expectedFindings: [],
        diff: `diff --git a/src/app.ts b/src/app.ts\n${placeholderSliceMarker}`
      })
    ).toBe(false)
  })

  test('does not flag a positive slice without a diff', () => {
    expect(
      isPlaceholderPositiveSlice({
        expectedFindings: [{ category: 'bug' }]
      })
    ).toBe(false)
  })

  test('assertBenchmarkSlicesHydrated throws naming the placeholder ids', () => {
    expect(() =>
      assertBenchmarkSlicesHydrated([
        {
          id: 'crb-positive-1',
          expectedFindings: [{ category: 'bug' }],
          diff: placeholderSliceMarker
        },
        {
          id: 'crb-negative-1',
          expectedFindings: [],
          diff: placeholderSliceMarker
        }
      ])
    ).toThrow(/crb-positive-1/u)
  })

  test('assertBenchmarkSlicesHydrated passes for hydrated slices', () => {
    expect(() =>
      assertBenchmarkSlicesHydrated([
        {
          id: 'crb-positive-1',
          expectedFindings: [{ category: 'bug' }],
          diff: 'diff --git a/src/app.ts b/src/app.ts\n+realChange()'
        }
      ])
    ).not.toThrow()
  })
})

describe('benchmark hydration', () => {
  test('materializes patch context at new-side line numbers', () => {
    const files = materializeDiffFiles(`diff --git a/src/app.ts b/src/app.ts
index 0000000..1111111 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -9,3 +9,4 @@ export const run = () => {
 unchanged()
-oldCall()
+newCall()
+missingAwait()
 }
`)

    expect(files).toHaveLength(1)
    expect(files[0]?.path).toBe('src/app.ts')

    const lines = files[0]?.content.split('\n') ?? []

    expect(lines[7]).toBe('')
    expect(lines[8]).toBe('unchanged()')
    expect(lines[9]).toBe('newCall()')
    expect(lines[10]).toBe('missingAwait()')
    expect(lines[11]).toBe('}')
  })

  test('supports quoted git paths and skips deletion-only files', () => {
    const files = materializeDiffFiles(`diff --git "a/src/has space.ts" "b/src/has space.ts"
index 0000000..1111111 100644
--- "a/src/has space.ts"
+++ "b/src/has space.ts"
@@ -1 +1,2 @@
 context
+added
diff --git a/src/deleted.ts b/src/deleted.ts
deleted file mode 100644
--- a/src/deleted.ts
+++ /dev/null
@@ -1 +0,0 @@
-removed
`)

    expect(files).toEqual([
      {
        path: 'src/has space.ts',
        content: 'context\nadded\n'
      }
    ])
  })

  test('hydrates benchmark cases with full head-side file contents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codereviewer-benchmark-'))

    try {
      await mkdir(join(root, 'source', 'case-1'), { recursive: true })
      await writeFile(
        join(root, 'source', 'case-1', 'slice.json'),
        JSON.stringify(
          {
            id: 'case-1',
            prUrl: 'https://github.com/example/repo/pull/12',
            language: 'typescript',
            changedFiles: ['src/app.ts'],
            expectedFindings: [
              {
                category: 'bug',
                severity: 'medium',
                semanticSummary: 'The changed async call is not awaited.',
                matchMode: 'semantic-only'
              }
            ],
            tags: ['benchmark']
          },
          null,
          2
        )
      )

      const diff = `diff --git a/src/app.ts b/src/app.ts
index 0000000..1111111 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -9,3 +9,4 @@ export const run = () => {
 unchanged()
-oldCall()
+newCall()
+missingAwait()
 }
`
      const fullFile = `import { helper } from './helper.js'

export const run = async () => {
  await helper()
  newCall()
  missingAwait()
}
`
      const fetchText = async (url: string): Promise<string> => {
        if (url === 'https://github.com/example/repo/pull/12.diff') {
          return diff
        }

        if (url === 'https://api.github.com/repos/example/repo/pulls/12') {
          return JSON.stringify({
            head: {
              sha: 'head-sha',
              repo: {
                full_name: 'fork/repo'
              }
            }
          })
        }

        if (
          url ===
          'https://raw.githubusercontent.com/fork/repo/head-sha/src/app.ts'
        ) {
          return fullFile
        }

        throw new Error(`Unexpected fetch URL: ${url}`)
      }

      const result = await hydrateCodeReviewBenchmarkPack({
        repositoryRoot: root,
        sourceSliceRoot: 'source',
        outputSliceRoot: 'hydrated',
        fetchText,
        force: true
      })
      const hydratedSlice = JSON.parse(
        await readFile(join(root, 'hydrated', 'case-1', 'slice.json'), 'utf8')
      ) as Record<string, unknown>
      const hydratedFile = await readFile(
        join(root, 'hydrated', 'case-1', 'repo', 'src', 'app.ts'),
        'utf8'
      )

      expect(result).toMatchObject({
        hydratedCaseCount: 1,
        changedFileCount: 1
      })
      expect(hydratedSlice.changedFiles).toEqual(['src/app.ts'])
      expect(hydratedSlice.hydratedSource).toBe('public-full-files-v1')
      expect(hydratedSlice.hydratedHeadRepository).toBe('fork/repo')
      expect(hydratedSlice.hydratedHeadRef).toBe('head-sha')
      expect(hydratedFile).toBe(fullFile)
      expect(hydratedFile).not.toContain('\n\n\n\n\n\n')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
