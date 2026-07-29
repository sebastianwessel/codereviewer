// Structural enforcement of spec 24's two hard requirements.
//
// 1. The capability MUST reach repository content only through the mediated
//    seams — `context-retrieval` and `repository-intake`. Enforced by proving the
//    domain contains no `node:fs`, `node:fs/promises` or `node:child_process`
//    import, which is the only way to assert the ABSENCE of a second filesystem
//    path; an integration test can only ever show that one path works.
// 2. It MUST NOT import from `review-workflow`, and `review-workflow` MUST NOT
//    import from it (spec 01). That bullet is the structural guarantee behind
//    spec 24's "failure MUST be recoverable and MUST NOT affect the diff review":
//    a failed conformance run cannot fail a diff review it shares no code path
//    with.
//
// The first test in the file exists so none of this can pass vacuously. Every
// assertion below is over a list built by scanning a directory, and a scan that
// finds nothing satisfies every one of them — so the domain is required to have
// production sources before any absence is treated as meaningful.

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
// own suite is written: a test proving the composition works over a real
// repository has to create that repository, and this boundary test has to read
// the domain's sources to check them. The `review-workflow` rule below is checked
// across every file, tests included, because importing that domain from anywhere
// here would couple the two regardless of which file did it.
const isProductionSource = (source: DomainSource): boolean =>
  !source.path.endsWith('.test.ts')

// Matches the module specifier of a static import/export-from and of a dynamic
// `import(...)`, so a banned dependency cannot be hidden behind either form.
const moduleSpecifiersIn = (source: string): readonly string[] => [
  ...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/gu)
].map((match) => match[1] ?? '')

describe('invariant-conformance import boundary', () => {
  test('the domain has production source files to check', async () => {
    // Without this every assertion below would pass on an empty or renamed
    // domain, which is the failure mode an absence test is most prone to.
    const sources = (await readSources(domainDirectory)).filter(
      isProductionSource
    )

    expect(sources.length).toBeGreaterThan(3)
    expect(
      sources.some((source) => source.path.endsWith('conformance-run.ts'))
    ).toBe(true)
    // And the sources must actually contain imports, so a scan that silently
    // stopped matching module specifiers cannot read as a clean result.
    expect(
      sources.flatMap((source) => moduleSpecifiersIn(source.source)).length
    ).toBeGreaterThan(3)
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

  test('imports the shared intake entrypoint rather than reimplementing it', async () => {
    const specifiers = (await readSources(domainDirectory))
      .filter(isProductionSource)
      .flatMap((source) => moduleSpecifiersIn(source.source))

    expect(specifiers).toContain('../repository-intake/index.js')
    expect(specifiers).toContain('../deterministic-signals/index.js')
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
        .filter((specifier) => specifier.includes('invariant-conformance'))
        .map((specifier) => `${source.path} imports ${specifier}`)
    )

    expect(outboundViolations).toEqual([])
    expect(inboundViolations).toEqual([])
  })

  test('does not import the diff reviewer admission gate or its report schema', async () => {
    // Spec 24: the capability "MUST NOT extend the diff reviewer's admission
    // gate, share its report schema, or contribute to its metrics." An import is
    // the only way any of those three could happen.
    const violations = (await readSources(domainDirectory))
      .filter(isProductionSource)
      .flatMap((source) =>
        moduleSpecifiersIn(source.source)
          .filter(
            (specifier) =>
              specifier.includes('/admission/') ||
              specifier.includes('../admission') ||
              specifier.includes('/evaluation/') ||
              specifier.includes('../evaluation') ||
              specifier.includes('review-report')
          )
          .map((specifier) => `${source.path} imports ${specifier}`)
      )

    expect(violations).toEqual([])
  })
})
