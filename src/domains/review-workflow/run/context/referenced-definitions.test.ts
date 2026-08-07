import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { SupportSignalFact } from '../../../deterministic-signals/index.js'
import {
  collectReferencedDefinitions,
  createReferencedDefinitionCache,
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
  endLine: line,
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

    const { digests } = await collectReferencedDefinitions({
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

    const { digests } = await collectReferencedDefinitions({
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

    const { digests } = await collectReferencedDefinitions({
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

    const { digests } = await collectReferencedDefinitions({
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

    const { digests } = await collectReferencedDefinitions({
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

    const { digests } = await collectReferencedDefinitions({
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

    const { digests } = await collectReferencedDefinitions({
      repositoryRoot,
      taskPaths: ['src/changed.ts'],
      facts: [importFact('src/changed.ts', './util')],
      knownPaths: new Set(['src/changed.ts'])
    })

    expect(digests).toHaveLength(1)
    expect(digests[0]?.path).toBe('src/util/index.ts')
  })

  describe('dropped dependencies are reported, not discarded', () => {
    // A run that silently drops context is indistinguishable from one that had none
    // to add. That shape was found three times in the intent capability's limits on
    // 2026-08-01 and had never been looked for here — and it binds routinely:
    // measured over the corpus every A/B has used, HALF of the TypeScript/JavaScript
    // changed files import more than the three dependencies the 12KB budget holds at
    // the 4KB per-file cap, and 40% exceed the six-file cap too.
    test('counts dependencies the file cap kept out', async () => {
      const facts: SupportSignalFact[] = []
      const dependencyCount = referencedDefinitionBounds.maxFiles + 3
      let changedSource = ''

      for (let index = 0; index < dependencyCount; index += 1) {
        const name = `dep${index}`
        await writeFile(
          path.join(repositoryRoot, 'src', `${name}.ts`),
          `export const ${name} = ${index}\n`,
          'utf8'
        )
        changedSource += `import { ${name} } from './${name}.js'\n`
        facts.push(importFact('src/changed.ts', `./${name}.js`, index + 1))
      }

      await writeFile(
        path.join(repositoryRoot, 'src', 'changed.ts'),
        changedSource,
        'utf8'
      )

      const result = await collectReferencedDefinitions({
        repositoryRoot,
        taskPaths: ['src/changed.ts'],
        facts,
        knownPaths: new Set(['src/changed.ts'])
      })

      expect(result.digests.length).toBe(referencedDefinitionBounds.maxFiles)
      expect(result.droppedByFileCap).toBe(3)
    })

    test('counts dependencies the byte budget kept out', async () => {
      const facts: SupportSignalFact[] = []
      // Each dependency is large enough that the total budget runs out first.
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

      const result = await collectReferencedDefinitions({
        repositoryRoot,
        taskPaths: ['src/changed.ts'],
        facts,
        knownPaths: new Set(['src/changed.ts'])
      })

      expect(result.droppedByBudget).toBeGreaterThan(0)
      expect(result.digests.length + result.droppedByBudget).toBe(
        referencedDefinitionBounds.maxFiles
      )
    })

    test('reports zero dropped when everything fits', async () => {
      await writeFile(
        path.join(repositoryRoot, 'src', 'changed.ts'),
        "import { calc } from './dep.js'\n",
        'utf8'
      )
      await writeFile(
        path.join(repositoryRoot, 'src', 'dep.ts'),
        'export const calc = (value: number): number => value * 2\n',
        'utf8'
      )

      const result = await collectReferencedDefinitions({
        repositoryRoot,
        taskPaths: ['src/changed.ts'],
        facts: [importFact('src/changed.ts', './dep.js')],
        knownPaths: new Set(['src/changed.ts'])
      })

      expect(result.droppedByFileCap).toBe(0)
      expect(result.droppedByBudget).toBe(0)
    })
  })

  // The per-file cap is the one bound whose binding CHANGES what the digest says
  // rather than only how much of it there is. A digest is a line-numbered extract
  // that pushes a literal '...' between every pair of non-contiguous kept lines,
  // so within this format an end with no marker asserts that nothing follows; and
  // the byte cut is code-point-aware but not line-aware, so it lands mid-line and
  // presents a fragment of a line as if it were real numbered source. Both are
  // false statements about the dependency file, which is why this is correctness
  // and not a bet on recall.
  describe('the per-file digest cap', () => {
    // Every line is an export, so every line is an anchor and the digest keeps
    // the whole file — well past the 4KB per-file cap.
    const oversizedDependencyLines = Array.from(
      { length: 120 },
      (_unused, index) =>
        `export const referencedSymbol${String(index).padStart(3, '0')} = 'value-${'x'.repeat(40)}'`
    )

    const digestOfOversizedDependency = async (): Promise<string> => {
      await writeFile(
        path.join(repositoryRoot, 'src', 'changed.ts'),
        "import { referencedSymbol000 } from './dep.js'\n",
        'utf8'
      )
      await writeFile(
        path.join(repositoryRoot, 'src', 'dep.ts'),
        `${oversizedDependencyLines.join('\n')}\n`,
        'utf8'
      )

      const { digests } = await collectReferencedDefinitions({
        repositoryRoot,
        taskPaths: ['src/changed.ts'],
        facts: [importFact('src/changed.ts', './dep.js')],
        knownPaths: new Set(['src/changed.ts'])
      })

      const content = digests[0]?.content

      if (content === undefined) {
        throw new Error('expected a digest for the oversized dependency')
      }

      return content
    }

    test('never ends with a partial source line', async () => {
      const content = await digestOfOversizedDependency()
      const numberedLines = content
        .split('\n')
        .filter((line) => /^\d+: /u.test(line))

      // Every numbered line the model is shown is the WHOLE line it claims to be.
      // Before the fix the last one was a strict prefix of a real source line —
      // code presented as line N that does not exist in that form in the file.
      for (const numberedLine of numberedLines) {
        const lineNumber = Number(/^(\d+): /u.exec(numberedLine)?.[1])

        expect(numberedLine).toBe(
          `${lineNumber}: ${oversizedDependencyLines[lineNumber - 1]}`
        )
      }
    })

    test('discloses the cut, and the disclosure fits inside the budget', async () => {
      const content = await digestOfOversizedDependency()

      // The format marks every internal gap with '...', so an end with no marker
      // asserts that nothing follows. The notice is what makes that end true.
      expect(content).toMatch(
        /\n\[TRUNCATED: \d+ of \d+ digest lines shown, cut at the per-file byte budget\./u
      )
      expect(content.trimEnd().endsWith(']')).toBe(true)
      expect(Buffer.byteLength(content)).toBeLessThanOrEqual(
        referencedDefinitionBounds.perFileByteBudget
      )
    })

    test('leaves a digest that fits byte-identical, with no notice', async () => {
      await writeFile(
        path.join(repositoryRoot, 'src', 'changed.ts'),
        "import { calc } from './dep.js'\n",
        'utf8'
      )
      await writeFile(
        path.join(repositoryRoot, 'src', 'dep.ts'),
        'export const calc = (value: number): number => value * 2\n',
        'utf8'
      )

      const { digests } = await collectReferencedDefinitions({
        repositoryRoot,
        taskPaths: ['src/changed.ts'],
        facts: [importFact('src/changed.ts', './dep.js')],
        knownPaths: new Set(['src/changed.ts'])
      })

      expect(digests[0]?.content).not.toContain('TRUNCATED')
    })
  })

  // Assembly calls this once per task, and tasks legitimately import the same
  // dependencies, so a run-scoped memo carries the resolved paths and the digests
  // between them. Each probe is two `realpath` syscalls and each digest re-runs
  // the whole extractor over the dependency file.
  describe('the run cache', () => {
    test('digests a shared dependency once and returns the same digest to both tasks', async () => {
      for (const name of ['a', 'b']) {
        await writeFile(
          path.join(repositoryRoot, 'src', `${name}.ts`),
          "import { calc } from './dep.js'\n",
          'utf8'
        )
      }
      await writeFile(
        path.join(repositoryRoot, 'src', 'dep.ts'),
        'export const calc = (value: number): number => value * 2\n',
        'utf8'
      )

      const cache = createReferencedDefinitionCache()
      const readPaths: string[] = []
      const collectFor = (taskPath: string) =>
        collectReferencedDefinitions({
          repositoryRoot,
          taskPaths: [taskPath],
          facts: [importFact(taskPath, './dep.js')],
          knownPaths: new Set(['src/a.ts', 'src/b.ts']),
          readDependencyFile: async (absolutePath) => {
            readPaths.push(absolutePath)

            return 'export const calc = (value: number): number => value * 2\n'
          },
          cache
        })

      const first = await collectFor('src/a.ts')
      const second = await collectFor('src/b.ts')

      // Same answer, and the dependency was read (and extracted) once.
      expect(second.digests).toEqual(first.digests)
      expect(readPaths).toHaveLength(1)
    })

    test('does not remember a read that failed', async () => {
      await writeFile(
        path.join(repositoryRoot, 'src', 'changed.ts'),
        "import { calc } from './dep.js'\n",
        'utf8'
      )
      await writeFile(
        path.join(repositoryRoot, 'src', 'dep.ts'),
        'export const calc = (value: number): number => value * 2\n',
        'utf8'
      )

      const cache = createReferencedDefinitionCache()
      let attempt = 0
      const collect = () =>
        collectReferencedDefinitions({
          repositoryRoot,
          taskPaths: ['src/changed.ts'],
          facts: [importFact('src/changed.ts', './dep.js')],
          knownPaths: new Set(['src/changed.ts']),
          readDependencyFile: async () => {
            attempt += 1

            if (attempt === 1) {
              throw new Error('transient read failure')
            }

            return 'export const calc = (value: number): number => value * 2\n'
          },
          cache
        })

      // A failed read is skipped and NOT cached, so the next task retries it
      // rather than inheriting a verdict about a failure this one hit.
      expect((await collect()).digests).toHaveLength(0)
      expect((await collect()).digests).toHaveLength(1)
    })

    test('is optional: without one, every call resolves and digests from scratch', async () => {
      await writeFile(
        path.join(repositoryRoot, 'src', 'changed.ts'),
        "import { calc } from './dep.js'\n",
        'utf8'
      )
      await writeFile(
        path.join(repositoryRoot, 'src', 'dep.ts'),
        'export const calc = (value: number): number => value * 2\n',
        'utf8'
      )

      const readPaths: string[] = []
      const collect = () =>
        collectReferencedDefinitions({
          repositoryRoot,
          taskPaths: ['src/changed.ts'],
          facts: [importFact('src/changed.ts', './dep.js')],
          knownPaths: new Set(['src/changed.ts']),
          readDependencyFile: async (absolutePath) => {
            readPaths.push(absolutePath)

            return 'export const calc = (value: number): number => value * 2\n'
          }
        })

      expect((await collect()).digests).toHaveLength(1)
      expect((await collect()).digests).toHaveLength(1)
      expect(readPaths).toHaveLength(2)
    })
  })
})
