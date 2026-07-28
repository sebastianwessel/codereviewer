import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { lookupSymbolReferences } from './symbol-reference-lookup.js'

const createRepo = async (): Promise<string> => {
  const root = join(tmpdir(), `codereviewer-symbol-lookup-${crypto.randomUUID()}`)

  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(
    join(root, 'src', 'store.ts'),
    ['export const get = () => 1', 'const forget = get'].join('\n')
  )
  await writeFile(
    join(root, 'src', 'caller-a.ts'),
    ['import { get } from "./store.js"', 'export const a = get()'].join('\n')
  )
  await writeFile(
    join(root, 'src', 'caller-b.ts'),
    [
      'import { get } from "./store.js"',
      'const widget = 1',
      'export const b = get()'
    ].join('\n')
  )
  await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
  await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'get()\n')

  return root
}

describe('symbol reference lookup', () => {
  test('finds identifier references, flags the definition file, and skips ineligible paths', async () => {
    const root = await createRepo()

    try {
      const results = await lookupSymbolReferences({
        repositoryRoot: root,
        queries: [{ name: 'get', definitionPath: 'src/store.ts' }],
        maxReferencesPerSymbol: 25,
        maxSearchDepth: 12
      })

      expect(results).toHaveLength(1)
      expect(results[0]?.truncated).toBe(false)
      expect(
        results[0]?.references.map((reference) => [
          reference.path,
          reference.line,
          reference.inDefinitionFile
        ])
      ).toEqual([
        ['src/caller-a.ts', 1, false],
        ['src/caller-a.ts', 2, false],
        ['src/caller-b.ts', 1, false],
        ['src/caller-b.ts', 3, false],
        // Both lines of the defining file reference the name; `forget` on line 2
        // does NOT match, so it is line 1 and line 2's `= get` that appear.
        ['src/store.ts', 1, true],
        ['src/store.ts', 2, true]
      ])
      // The eligibility gate prunes dependencies during traversal, so a match
      // inside node_modules is never reported as a dependent.
      expect(
        results[0]?.references.some((reference) =>
          reference.path.startsWith('node_modules/')
        )
      ).toBe(false)
      expect(results[0]?.references[1]?.text).toBe('export const a = get()')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('caps references per symbol and reports the truncation rather than hiding it', async () => {
    const root = await createRepo()

    try {
      const results = await lookupSymbolReferences({
        repositoryRoot: root,
        queries: [{ name: 'get', definitionPath: 'src/store.ts' }],
        maxReferencesPerSymbol: 2,
        maxSearchDepth: 12
      })

      expect(results[0]?.references).toHaveLength(2)
      expect(results[0]?.truncated).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('spends exactly one search per distinct symbol, and none for an empty seed', async () => {
    const root = await createRepo()

    try {
      // Three queries, one a duplicate: the duplicate must not cost a search, and
      // the search budget is sized to the distinct count, so a fourth search
      // would throw rather than silently succeed.
      const results = await lookupSymbolReferences({
        repositoryRoot: root,
        queries: [
          { name: 'get', definitionPath: 'src/store.ts' },
          { name: 'get', definitionPath: 'src/store.ts' },
          { name: 'widget', definitionPath: 'src/caller-b.ts' }
        ],
        maxReferencesPerSymbol: 25,
        maxSearchDepth: 12
      })

      expect(results.map((result) => result.query.name)).toEqual([
        'get',
        'widget'
      ])
      await expect(
        lookupSymbolReferences({
          repositoryRoot: root,
          queries: [],
          maxReferencesPerSymbol: 25,
          maxSearchDepth: 12
        })
      ).resolves.toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('search paths and traversal depth bound the lookup', async () => {
    const root = await createRepo()

    try {
      const scoped = await lookupSymbolReferences({
        repositoryRoot: root,
        queries: [{ name: 'get', definitionPath: 'src/store.ts' }],
        maxReferencesPerSymbol: 25,
        maxSearchDepth: 12,
        searchPaths: ['src/caller-a.ts']
      })

      expect(
        scoped[0]?.references.map((reference) => reference.path)
      ).toEqual(['src/caller-a.ts', 'src/caller-a.ts'])

      const shallow = await lookupSymbolReferences({
        repositoryRoot: root,
        queries: [{ name: 'get', definitionPath: 'src/store.ts' }],
        maxReferencesPerSymbol: 25,
        // Depth 0 is the requested root directory itself, so `src/` is never
        // descended into.
        maxSearchDepth: 0
      })

      expect(shallow[0]?.references).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
