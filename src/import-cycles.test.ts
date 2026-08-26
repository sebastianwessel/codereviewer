// Structural enforcement that `src/` contains NO import cycle.
//
// This property was true, repeatedly cited as evidence the structure is sound,
// and enforced by nothing. It was checked by running `madge` by hand, and madge
// is not a dependency of this repository — so the check existed only for as long
// as somebody remembered to type it, which is the same as not existing.
//
// It stopped being a background nicety on 2026-08-14. Moving eval orchestration
// out of `src/cli/` into `domains/evaluation/` came within one barrel entry of a
// real cycle: `runEvalCase` imports `review-workflow`, and `review-workflow`
// reaches `evaluation` transitively through
// `review-workflow/run/preflight.ts` -> `drift/index.ts` ->
// `drift/artifact-example-checker.ts` -> `evaluation/index.js`. Exporting
// `runEvalCase` from the evaluation barrel would have closed that loop. These are
// value imports, not type-only, so the failure would not have been a lint
// complaint: one side's zod schema `const`s would be in the temporal dead zone at
// module evaluation, which surfaces as an undefined schema far from its cause.
//
// That near-miss was caught by a hand-run of madge. The next one would not be.
//
// Written as a source scan rather than by adding a tool, for the reason the two
// `import-boundary.test.ts` files already give: the check belongs in `npm test`,
// where it runs on every change, and the graph it needs is cheap to build from
// the same specifier regex those tests use.

import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const sourceRoot = path.dirname(fileURLToPath(import.meta.url))

const collectTypeScriptFiles = async (
  directory: string
): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name)

      if (entry.isDirectory()) {
        return collectTypeScriptFiles(entryPath)
      }

      return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : []
    })
  )

  return files.flat()
}

// Matches the module specifier of a static import/export-from and of a dynamic
// `import(...)`, so a dependency cannot hide behind either form. Identical to the
// expression the domain boundary tests use, deliberately: one way of reading an
// import specifier in this repository, not two that can disagree.
const moduleSpecifiersIn = (source: string): readonly string[] =>
  [...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/gu)].map(
    (match) => match[1] ?? ''
  )

// This project emits ESM and writes `.js` specifiers that resolve to `.ts`
// sources. A specifier may also name a directory holding `index.ts`.
const resolveSpecifier = async (
  fromFile: string,
  specifier: string
): Promise<string | undefined> => {
  if (!specifier.startsWith('.')) {
    return undefined
  }

  const base = path.resolve(path.dirname(fromFile), specifier)
  const candidates = base.endsWith('.js')
    ? [`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}/index.ts`]
    : [`${base}.ts`, path.join(base, 'index.ts')]

  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) {
        return candidate
      }
    } catch {
      // Not this candidate; try the next spelling.
    }
  }

  return undefined
}

type ImportGraph = ReadonlyMap<string, readonly string[]>

const buildImportGraph = async (): Promise<ImportGraph> => {
  const files = await collectTypeScriptFiles(sourceRoot)
  const graph = new Map<string, readonly string[]>()

  await Promise.all(
    files.map(async (file) => {
      const source = await readFile(file, 'utf8')
      const edges = await Promise.all(
        moduleSpecifiersIn(source).map(async (specifier) =>
          resolveSpecifier(file, specifier)
        )
      )

      graph.set(
        file,
        edges.filter((edge): edge is string => edge !== undefined)
      )
    })
  )

  return graph
}

// Iterative depth-first search with an explicit stack. Returns every cycle it
// can reach, rendered as a repository-relative path chain so a failure names the
// loop rather than merely asserting one exists.
const findCycles = (graph: ImportGraph): readonly string[] => {
  const visited = new Set<string>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const cycles: string[] = []

  const visit = (node: string): void => {
    visited.add(node)
    onStack.add(node)
    stack.push(node)

    for (const next of graph.get(node) ?? []) {
      if (onStack.has(next)) {
        const start = stack.indexOf(next)
        cycles.push(
          [...stack.slice(start), next]
            .map((entry) => path.relative(sourceRoot, entry))
            .join(' -> ')
        )
        continue
      }

      if (!visited.has(next)) {
        visit(next)
      }
    }

    onStack.delete(node)
    stack.pop()
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      visit(node)
    }
  }

  return cycles
}

describe('src import graph', () => {
  test('has files and resolved edges to check', async () => {
    // ANTI-VACUITY. Every assertion below is satisfied by a graph that resolved
    // nothing — a broken specifier regex or a resolver that returns undefined for
    // every candidate would report zero cycles and look identical to success.
    const graph = await buildImportGraph()
    const edgeCount = [...graph.values()].reduce(
      (total, edges) => total + edges.length,
      0
    )

    expect(graph.size).toBeGreaterThan(500)
    expect(edgeCount).toBeGreaterThan(1000)
  })

  test('contains no import cycle', async () => {
    expect(findCycles(await buildImportGraph())).toEqual([])
  })
})
