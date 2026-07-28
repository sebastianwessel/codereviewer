import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { ChangedSymbol } from './changed-symbols.js'
import { discoverDependents } from './dependent-discovery.js'
import { MAX_REFERENCE_TEXT_LENGTH } from './impact-report.js'

const createRepo = async (): Promise<string> => {
  const root = join(tmpdir(), `codereviewer-dependents-${crypto.randomUUID()}`)

  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(
    join(root, 'src', 'store.ts'),
    [
      'export const fetchUser = (id: string) => id',
      'const localUse = fetchUser("a")',
      'export const unusedElsewhere = 1'
    ].join('\n')
  )
  await writeFile(
    join(root, 'src', 'caller.ts'),
    [
      'import { fetchUser } from "./store.js"',
      'export const a = fetchUser("b")'
    ].join('\n')
  )

  return root
}

const changedSymbol = (
  name: string,
  line: number
): ChangedSymbol => ({
  path: 'src/store.ts',
  name,
  kind: 'export',
  language: 'typescript',
  line,
  changeKind: 'modified'
})

describe('dependent discovery', () => {
  test('lists references outside the defining file and counts the ones inside it', async () => {
    const root = await createRepo()

    try {
      const symbols = await discoverDependents({
        repositoryRoot: root,
        changedSymbols: [changedSymbol('fetchUser', 1)],
        maxReferencesPerSymbol: 25,
        maxSearchDepth: 12
      })

      expect(symbols).toHaveLength(1)
      expect(
        symbols[0]?.references.map((reference) => [
          reference.path,
          reference.line
        ])
      ).toEqual([
        ['src/caller.ts', 1],
        ['src/caller.ts', 2]
      ])
      // Two references live in the defining file itself. They are counted, never
      // listed as dependents: a symbol's own file is not a dependent.
      expect(symbols[0]?.referencesInDefinitionFile).toBe(2)
      expect(symbols[0]?.references[1]?.text).toBe(
        'export const a = fetchUser("b")'
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // Spec 22: the command must be able to report NO impact and must not
  // manufacture entries to fill a report.
  test('reports a symbol with no outside reference rather than inventing one', async () => {
    const root = await createRepo()

    try {
      const symbols = await discoverDependents({
        repositoryRoot: root,
        changedSymbols: [changedSymbol('unusedElsewhere', 3)],
        maxReferencesPerSymbol: 25,
        maxSearchDepth: 12
      })

      expect(symbols).toEqual([
        expect.objectContaining({
          name: 'unusedElsewhere',
          references: [],
          referencesInDefinitionFile: 1,
          referencesTruncated: false
        })
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('an empty seed performs no lookup at all', async () => {
    const root = await createRepo()

    try {
      await expect(
        discoverDependents({
          repositoryRoot: root,
          changedSymbols: [],
          maxReferencesPerSymbol: 25,
          maxSearchDepth: 12
        })
      ).resolves.toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('the per-symbol cap is reported as truncation, never as a shorter true count', async () => {
    const root = await createRepo()

    try {
      const symbols = await discoverDependents({
        repositoryRoot: root,
        changedSymbols: [changedSymbol('fetchUser', 1)],
        maxReferencesPerSymbol: 1,
        maxSearchDepth: 12
      })

      expect(symbols[0]?.referencesTruncated).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('caps a pathological matched line so one reference cannot dominate the report', async () => {
    const root = await createRepo()

    try {
      await writeFile(
        join(root, 'src', 'generated.ts'),
        `const bundle = "${'x'.repeat(600)}" + fetchUser\n`
      )
      const symbols = await discoverDependents({
        repositoryRoot: root,
        changedSymbols: [changedSymbol('fetchUser', 1)],
        maxReferencesPerSymbol: 25,
        maxSearchDepth: 12
      })
      const generatedReference = symbols[0]?.references.find(
        (reference) => reference.path === 'src/generated.ts'
      )

      expect(generatedReference?.text).toHaveLength(MAX_REFERENCE_TEXT_LENGTH)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('carries the seed metadata through so a reference is attributable', async () => {
    const root = await createRepo()

    try {
      const symbols = await discoverDependents({
        repositoryRoot: root,
        changedSymbols: [changedSymbol('fetchUser', 1)],
        maxReferencesPerSymbol: 25,
        maxSearchDepth: 12
      })

      expect(symbols[0]).toMatchObject({
        name: 'fetchUser',
        kind: 'export',
        language: 'typescript',
        definitionPath: 'src/store.ts',
        definitionLine: 1,
        changeKind: 'modified'
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
