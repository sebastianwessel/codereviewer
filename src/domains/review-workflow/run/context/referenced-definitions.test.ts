import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { SupportSignalFact } from '../../../deterministic-signals/index.js'
import {
  collectReferencedDefinitions,
  referencedDefinitionBounds
} from './referenced-definitions.js'

const importFact = (
  fromPath: string,
  moduleSpecifier: string,
  line = 1
): SupportSignalFact => ({
  id: `fact_${fromPath}_${moduleSpecifier}_${line}`,
  language: 'typescript',
  kind: 'import',
  path: fromPath,
  name: moduleSpecifier,
  moduleSpecifier,
  line,
  summary: `import ${moduleSpecifier}`,
  contentHash: 'a'.repeat(64)
})

describe('collectReferencedDefinitions', () => {
  let repositoryRoot: string

  beforeEach(async () => {
    repositoryRoot = await mkdtemp(path.join(tmpdir(), 'refdef-'))
    await mkdir(path.join(repositoryRoot, 'src'), { recursive: true })
  })

  afterEach(async () => {
    await rm(repositoryRoot, { recursive: true, force: true })
  })

  test('resolves a relative import to an unchanged file and digests its exports', async () => {
    await writeFile(
      path.join(repositoryRoot, 'src', 'changed.ts'),
      "import { calc } from './dep.js'\nexport const run = () => calc(1)\n",
      'utf8'
    )
    await writeFile(
      path.join(repositoryRoot, 'src', 'dep.ts'),
      'export const calc = (value: number): number => value * 2\n',
      'utf8'
    )

    const digests = await collectReferencedDefinitions({
      repositoryRoot,
      taskPaths: ['src/changed.ts'],
      facts: [importFact('src/changed.ts', './dep.js')],
      knownPaths: new Set(['src/changed.ts'])
    })

    expect(digests).toHaveLength(1)
    expect(digests[0]?.path).toBe('src/dep.ts')
    // The export declaration line is line-numbered in the digest.
    expect(digests[0]?.content).toContain('calc')
    expect(digests[0]?.content).toMatch(/^\d+: /mu)
  })

  test('skips package (non-relative) imports', async () => {
    await writeFile(
      path.join(repositoryRoot, 'src', 'changed.ts'),
      "import { z } from 'zod'\n",
      'utf8'
    )

    const digests = await collectReferencedDefinitions({
      repositoryRoot,
      taskPaths: ['src/changed.ts'],
      facts: [importFact('src/changed.ts', 'zod')],
      knownPaths: new Set(['src/changed.ts'])
    })

    expect(digests).toEqual([])
  })

  test('skips imports that resolve to a changed/known file', async () => {
    await writeFile(
      path.join(repositoryRoot, 'src', 'a.ts'),
      "import { b } from './b.js'\n",
      'utf8'
    )
    await writeFile(
      path.join(repositoryRoot, 'src', 'b.ts'),
      'export const b = 1\n',
      'utf8'
    )

    const digests = await collectReferencedDefinitions({
      repositoryRoot,
      taskPaths: ['src/a.ts'],
      facts: [importFact('src/a.ts', './b.js')],
      // b.ts is itself a changed file -> must not be injected as context.
      knownPaths: new Set(['src/a.ts', 'src/b.ts'])
    })

    expect(digests).toEqual([])
  })

  test('does not escape the repository root', async () => {
    await writeFile(
      path.join(repositoryRoot, 'src', 'changed.ts'),
      "import { secret } from '../../etc/passwd'\n",
      'utf8'
    )

    const digests = await collectReferencedDefinitions({
      repositoryRoot,
      taskPaths: ['src/changed.ts'],
      facts: [importFact('src/changed.ts', '../../etc/passwd')],
      knownPaths: new Set(['src/changed.ts'])
    })

    expect(digests).toEqual([])
  })

  test('respects the max-file cap, ranking by import frequency', async () => {
    const facts: SupportSignalFact[] = []

    // Create one changed file importing maxFiles + 2 dependencies.
    const dependencyCount = referencedDefinitionBounds.maxFiles + 2
    let changedSource = ''

    for (let index = 0; index < dependencyCount; index += 1) {
      const name = `dep${index}`
      await writeFile(
        path.join(repositoryRoot, 'src', `${name}.ts`),
        `export const ${name} = ${index}\n`,
        'utf8'
      )
      changedSource += `import { ${name} } from './${name}.js'\n`
      // Give later deps more imports so frequency ranking is observable; the
      // top-N by frequency must be kept.
      const occurrences = index + 1
      for (let occurrence = 0; occurrence < occurrences; occurrence += 1) {
        facts.push(
          importFact('src/changed.ts', `./${name}.js`, occurrence + 1)
        )
      }
    }

    await writeFile(
      path.join(repositoryRoot, 'src', 'changed.ts'),
      changedSource,
      'utf8'
    )

    const digests = await collectReferencedDefinitions({
      repositoryRoot,
      taskPaths: ['src/changed.ts'],
      facts,
      knownPaths: new Set(['src/changed.ts'])
    })

    expect(digests.length).toBeLessThanOrEqual(
      referencedDefinitionBounds.maxFiles
    )
    // The most-imported deps (highest index) win the bounded budget.
    const keptPaths = digests.map((digest) => digest.path)
    expect(keptPaths).toContain(`src/dep${dependencyCount - 1}.ts`)
    expect(keptPaths).not.toContain('src/dep0.ts')
  })

  test('respects the total byte budget', async () => {
    const facts: SupportSignalFact[] = []
    // Each dep is large enough that only a couple fit in the total budget.
    const largeBody = `export const value = '${'x'.repeat(3000)}'\n`

    for (let index = 0; index < referencedDefinitionBounds.maxFiles; index += 1) {
      const name = `big${index}`
      await writeFile(
        path.join(repositoryRoot, 'src', `${name}.ts`),
        largeBody,
        'utf8'
      )
      facts.push(importFact('src/changed.ts', `./${name}.js`, index + 1))
    }

    await writeFile(
      path.join(repositoryRoot, 'src', 'changed.ts'),
      facts.map((fact) => `import x from '${fact.moduleSpecifier}'`).join('\n'),
      'utf8'
    )

    const digests = await collectReferencedDefinitions({
      repositoryRoot,
      taskPaths: ['src/changed.ts'],
      facts,
      knownPaths: new Set(['src/changed.ts'])
    })

    const totalBytes = digests.reduce(
      (total, digest) => total + Buffer.byteLength(digest.content),
      0
    )
    expect(totalBytes).toBeLessThanOrEqual(
      referencedDefinitionBounds.totalByteBudget
    )
    // Budget should force fewer than the max-file cap here.
    expect(digests.length).toBeLessThan(referencedDefinitionBounds.maxFiles)
  })

  test('resolves a directory import via /index', async () => {
    await mkdir(path.join(repositoryRoot, 'src', 'util'), { recursive: true })
    await writeFile(
      path.join(repositoryRoot, 'src', 'changed.ts'),
      "import { helper } from './util'\n",
      'utf8'
    )
    await writeFile(
      path.join(repositoryRoot, 'src', 'util', 'index.ts'),
      'export const helper = () => 1\n',
      'utf8'
    )

    const digests = await collectReferencedDefinitions({
      repositoryRoot,
      taskPaths: ['src/changed.ts'],
      facts: [importFact('src/changed.ts', './util')],
      knownPaths: new Set(['src/changed.ts'])
    })

    expect(digests).toHaveLength(1)
    expect(digests[0]?.path).toBe('src/util/index.ts')
  })
})
