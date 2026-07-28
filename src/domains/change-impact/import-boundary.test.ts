// Structural enforcement of spec 22's two hard requirements, and the substitute
// for its verification-matrix row asking for "an integration test asserting no
// duplicated implementation" — you cannot assert the ABSENCE of duplication with
// an integration test, but you can assert the absence of the imports that make
// duplication possible.
//
// 1. `change-impact` must reach repository content only through
//    `context-retrieval` and `repository-intake`. Enforced by proving the domain
//    contains no `node:fs`, `node:fs/promises` or `node:child_process` import.
// 2. `change-impact` must not import from `review-workflow`, and
//    `review-workflow` must not import from it (spec 01). That bullet is the
//    structural guarantee behind spec 22's recoverability requirement: a failed
//    impact review cannot fail a diff review it shares no code path with.

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const domainDirectory = path.dirname(fileURLToPath(import.meta.url))
const domainsDirectory = path.dirname(domainDirectory)
const reviewWorkflowDirectory = path.join(domainsDirectory, 'review-workflow')

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

const readSources = async (
  directory: string
): Promise<readonly DomainSource[]> =>
  Promise.all(
    (await collectTypeScriptFiles(directory)).map(async (filePath) => ({
      path: path.relative(domainsDirectory, filePath).split(path.sep).join('/'),
      source: await readFile(filePath, 'utf8')
    }))
  )

// The no-filesystem rule constrains what the DOMAIN does at runtime, not how its
// own suite is written: a test proving the domain works over a real repository
// has to create that repository, and this boundary test has to read the domain's
// sources to check them. The `review-workflow` rule below is checked across every
// file, tests included, because importing that domain from anywhere here would
// couple the two regardless of which file did it.
const isProductionSource = (source: DomainSource): boolean =>
  !source.path.endsWith('.test.ts')

// Matches the module specifier of a static import/export-from and of a dynamic
// `import(...)`, so a banned dependency cannot be hidden behind either form.
const moduleSpecifiersIn = (source: string): readonly string[] => [
  ...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/gu)
].map((match) => match[1] ?? '')

describe('change-impact import boundary', () => {
  test('the domain has production source files to check', async () => {
    // Without this the assertions below would pass vacuously if the domain were
    // ever moved or renamed.
    const sources = (await readSources(domainDirectory)).filter(
      isProductionSource
    )

    expect(sources.length).toBeGreaterThan(3)
  })

  test('reaches repository content only through the shared retrieval domains', async () => {
    const bannedModules = new Set([
      'node:fs',
      'node:fs/promises',
      'node:child_process'
    ])
    const violations = (await readSources(domainDirectory))
      .filter(isProductionSource)
      .flatMap((source) =>
        moduleSpecifiersIn(source.source)
          .filter((specifier) => bannedModules.has(specifier))
          .map((specifier) => `${source.path} imports ${specifier}`)
      )

    expect(violations).toEqual([])
  })

  test('imports the shared intake and retrieval entrypoints rather than reimplementing them', async () => {
    const specifiers = (await readSources(domainDirectory))
      .filter(isProductionSource)
      .flatMap((source) => moduleSpecifiersIn(source.source))

    expect(specifiers).toContain('../repository-intake/index.js')
    expect(specifiers).toContain('../context-retrieval/index.js')
  })

  test('does not import review-workflow, and review-workflow does not import it', async () => {
    const outboundViolations = (await readSources(domainDirectory)).flatMap(
      (source) =>
        moduleSpecifiersIn(source.source)
          .filter((specifier) => specifier.includes('review-workflow'))
          .map((specifier) => `${source.path} imports ${specifier}`)
    )
    const inboundViolations = (
      await readSources(reviewWorkflowDirectory)
    ).flatMap((source) =>
      moduleSpecifiersIn(source.source)
        .filter((specifier) => specifier.includes('change-impact'))
        .map((specifier) => `${source.path} imports ${specifier}`)
    )

    expect(outboundViolations).toEqual([])
    expect(inboundViolations).toEqual([])
  })
})
