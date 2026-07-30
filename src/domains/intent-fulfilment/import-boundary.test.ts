// Structural enforcement of spec 23's requirements that no behavioural test can
// reach, and the substitute for its verification-matrix row asking for "an
// integration test asserting no second ingestion path" — you cannot assert the
// ABSENCE of a second implementation with an integration test, but you can assert
// the absence of the imports that make one possible.
//
// 1. The domain reaches repository content only through the mediated seams:
//    `repository-intake` for the diff, the caller's mediated reader for changed
//    files, and spec 11's `context-ingestion` for the stated intent. Enforced by
//    proving the domain contains no `node:fs`, `node:fs/promises` or
//    `node:child_process` import.
// 2. Spec 11's ingestion is REUSED, NOT REIMPLEMENTED. Enforced by proving the
//    domain imports the ingestion entrypoint and touches none of the modules a
//    reimplementation would need — the providers, the frontmatter parser, and the
//    summarizers.
// 3. Obligations do not come from the summarized brief. Enforced by proving the
//    domain never references `runContextIngestion`, which is the only function
//    that produces one.
// 4. It must not import from `review-workflow`, and `review-workflow` must not
//    import from it (spec 01). That is the structural guarantee behind the three
//    stages being independently runnable: a failed intent check cannot fail a diff
//    review it shares no code path with, and neither stage can read the other's
//    context or output.
//
// The first test in the file exists so none of this can pass vacuously. Every
// assertion below is over a list built by scanning a directory, and a scan that
// finds nothing satisfies every one of them.

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
// repository has to create that repository, and this boundary test has to read the
// domain's sources to check them. The `review-workflow` rule below is checked
// across every file, tests included, because importing that domain from anywhere
// here would couple the two regardless of which file did it.
const isProductionSource = (source: DomainSource): boolean =>
  !source.path.endsWith('.test.ts')

// Matches the module specifier of a static import/export-from and of a dynamic
// `import(...)`, so a banned dependency cannot be hidden behind either form.
const moduleSpecifiersIn = (source: string): readonly string[] => [
  ...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/gu)
].map((match) => match[1] ?? '')

describe('intent-fulfilment import boundary', () => {
  test('the domain has production source files to check', async () => {
    const sources = (await readSources(domainDirectory)).filter(
      isProductionSource
    )

    expect(sources.length).toBeGreaterThan(3)
    expect(
      sources.some((source) =>
        source.path.endsWith('intent-fulfilment-run.ts')
      )
    ).toBe(true)
    // And the sources must actually contain imports, so a scan that silently
    // stopped matching module specifiers cannot read as a clean result.
    expect(
      sources.flatMap((source) => moduleSpecifiersIn(source.source)).length
    ).toBeGreaterThan(3)
  })

  test('reaches repository content only through the shared, mediated seams', async () => {
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

  test('imports the shared intake and ingestion entrypoints rather than reimplementing them', async () => {
    const specifiers = (await readSources(domainDirectory))
      .filter(isProductionSource)
      .flatMap((source) => moduleSpecifiersIn(source.source))

    expect(specifiers).toContain('../repository-intake/index.js')
    expect(specifiers).toContain('../context-ingestion/index.js')
  })

  test('contains no second change-intent ingestion path', async () => {
    // Spec 23: "Spec 11 ingests external context from bounded providers, redacts
    // it, and injects it as a context-only change-intent document. That ingestion
    // MUST be reused, not reimplemented." Reaching past the domain entrypoint into
    // a provider, the frontmatter parser, or a summarizer is what reimplementing
    // it would start as.
    const sources = (await readSources(domainDirectory)).filter(
      isProductionSource
    )
    const violations = sources.flatMap((source) =>
      moduleSpecifiersIn(source.source)
        .filter(
          (specifier) =>
            specifier.includes('context-ingestion/') &&
            !specifier.endsWith('context-ingestion/index.js')
        )
        .map((specifier) => `${source.path} imports ${specifier}`)
    )

    expect(violations).toEqual([])
  })

  test('never reads the summarized brief', async () => {
    // Spec 23: "Obligations MUST be extracted from the redacted change-intent
    // fragments, not from the summarised brief. The brief is a paraphrase, and a
    // citation into a paraphrase does not identify where in the stated intent an
    // obligation came from." `runContextIngestion` is the only function that
    // produces a brief, so a reference to it anywhere here is the defect.
    const violations = (await readSources(domainDirectory))
      .filter(isProductionSource)
      .filter((source) => source.source.includes('runContextIngestion'))
      .map((source) => `${source.path} references runContextIngestion`)

    expect(violations).toEqual([])
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
        .filter((specifier) => specifier.includes('intent-fulfilment'))
        .map((specifier) => `${source.path} imports ${specifier}`)
    )

    expect(outboundViolations).toEqual([])
    expect(inboundViolations).toEqual([])
  })

  test('does not import the diff reviewer admission gate or its report schema', async () => {
    // A fulfilment mapping is not a finding: nothing here is admitted, nothing
    // carries a severity, and nothing contributes to the diff reviewer's metrics.
    // An import is the only way any of those three could happen.
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

  test('does not import the other advisory stages', async () => {
    // The three stages are independently runnable and share no context or output.
    // Reuse happens through shared code, never through one stage reaching into
    // another.
    const violations = (await readSources(domainDirectory)).flatMap((source) =>
      moduleSpecifiersIn(source.source)
        .filter(
          (specifier) =>
            specifier.includes('change-impact') ||
            specifier.includes('invariant-conformance')
        )
        .map((specifier) => `${source.path} imports ${specifier}`)
    )

    expect(violations).toEqual([])
  })
})
