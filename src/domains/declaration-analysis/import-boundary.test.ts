// `declaration-analysis` is a LEAF. It is imported by both the diff reviewer
// (spec 25) and the conformance capability (spec 24), and spec 24's own boundary
// test forbids those two from ever seeing each other. That guarantee only holds
// while this domain depends on neither: a single import from here into either
// consumer would connect them through the shared module and silently undo it.
//
// The first test exists so none of the absence assertions can pass vacuously —
// every one of them is satisfied by an empty directory scan.

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const domainDirectory = path.dirname(fileURLToPath(import.meta.url))

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

type DomainSource = {
  readonly path: string
  readonly source: string
}

const readSources = async (): Promise<readonly DomainSource[]> =>
  Promise.all(
    (await collectTypeScriptFiles(domainDirectory)).map(async (filePath) => ({
      path: path.basename(filePath),
      source: await readFile(filePath, 'utf8')
    }))
  )

const isProductionSource = (source: DomainSource): boolean =>
  !source.path.endsWith('.test.ts')

// Anchored to statement position, unlike the equivalent in
// `invariant-conformance`. That one scans anywhere in the file, which is fine
// when the assertion is "no specifier equals `node:fs`" — junk matches simply are
// not in the banned set. This test asserts the stronger "every specifier is
// relative", so a junk match fails it: `declaration-shape.ts` contains the string
// literal `'import'` in its non-call keyword list, and an unanchored scan reads
// the following list entry as that import's specifier.
//
// Three patterns, all requiring the specifier to sit where a module specifier
// actually sits. `from` is mandatory in the first, because `export type Kind =
// 'call' | 'guard'` is an export statement whose first string literal is a union
// member, not a module.
const importFromPattern =
  /^\s*(?:import|export)\b[^'"\n]*?\bfrom\s*['"]([^'"\n]+)['"]/gmu
// A bare side-effect import, which has no `from`.
const bareImportPattern = /^\s*import\s*['"]([^'"\n]+)['"]/gmu
// The closing line of a multi-line import, where `from` and `import` are on
// different lines.
const continuationPattern = /^\s*\}\s*from\s*['"]([^'"\n]+)['"]/gmu

const moduleSpecifiersIn = (source: string): readonly string[] =>
  [
    ...source.matchAll(importFromPattern),
    ...source.matchAll(bareImportPattern),
    ...source.matchAll(continuationPattern)
  ].map((match) => match[1] ?? '')

describe('declaration-analysis import boundary', () => {
  test('the domain has production source files to check', async () => {
    const sources = (await readSources()).filter(isProductionSource)

    expect(sources.length).toBeGreaterThan(3)
    expect(sources.some((source) => source.path === 'declaration-shape.ts')).toBe(
      true
    )
    expect(
      sources.flatMap((source) => moduleSpecifiersIn(source.source)).length
    ).toBeGreaterThan(3)
  })

  test('depends on nothing outside itself', async () => {
    // Pure lexical analysis over text it is handed. No filesystem, no retrieval,
    // no configuration, and no other domain — which is what lets both a stage-1
    // and a stage-3 caller use it without either acquiring the other.
    const violations = (await readSources())
      .filter(isProductionSource)
      .flatMap((source) =>
        moduleSpecifiersIn(source.source)
          .filter((specifier) => !specifier.startsWith('./'))
          .map((specifier) => `${source.path} imports ${specifier}`)
      )

    expect(violations).toEqual([])
  })

  test('neither consumer domain is reachable from here', async () => {
    // Named explicitly rather than relying on the rule above, because this is the
    // property spec 24's boundary test depends on and it should fail with a
    // message that says so.
    const violations = (await readSources()).flatMap((source) =>
      moduleSpecifiersIn(source.source)
        .filter(
          (specifier) =>
            specifier.includes('review-workflow') ||
            specifier.includes('invariant-conformance')
        )
        .map((specifier) => `${source.path} imports ${specifier}`)
    )

    expect(violations).toEqual([])
  })
})
