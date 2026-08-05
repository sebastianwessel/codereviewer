// Spec 29's language-neutrality guard, and spec 15's Non-Negotiable applied to a
// deterministic stage rather than to a prompt.
//
// The banned tokens are DERIVED FROM THE REGISTRY rather than listed here, so this
// guard widens itself in the same edit that adds a language: a new adapter brings
// its own id and extensions, and both become forbidden literals in this module
// without anyone remembering to add them.
//
// What it looks for is the observable symptom of the violation. Language-specific
// logic in TypeScript has to compare against something, and that something is a
// quoted language id or a quoted file extension. Prose is not checked — the
// comments in this domain necessarily discuss what the registry does — and module
// specifiers are not caught, because `'./x.js'` is a path rather than an extension
// test.

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  supportedSignalLanguageDefinitions,
  supportedSignalLanguages
} from '../shared/deterministic-signal-utils.js'

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))

const readProductionSources = async (): Promise<
  readonly { readonly path: string; readonly source: string }[]
> => {
  const entries = await readdir(moduleDirectory, { withFileTypes: true })

  return Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith('.ts') &&
          !entry.name.endsWith('.test.ts')
      )
      .map(async (entry) => ({
        path: entry.name,
        source: await readFile(path.join(moduleDirectory, entry.name), 'utf8')
      }))
  )
}

// Comments go first, and not only because prose is out of scope. An apostrophe in
// ordinary English — "each language's own convention" — opens a single quote that
// the literal matcher below then closes against the next apostrophe, shifting
// every literal after it out of alignment. Written without this step the guard
// passed a planted violation, which is the one way a guard can fail.
const withoutComments = (source: string): string =>
  source.replaceAll(/\/\*[\s\S]*?\*\//gu, ' ').replaceAll(/\/\/[^\n]*/gu, '')

// Every single- or double-quoted string literal in the source, unwrapped.
const quotedLiteralsIn = (source: string): readonly string[] =>
  [...withoutComments(source).matchAll(/'([^']*)'|"([^"]*)"/gu)].map(
    (match) => match[1] ?? match[2] ?? ''
  )

describe('test adequacy genericity', () => {
  test('there are production sources to check', async () => {
    // Without this every assertion below would pass vacuously if the module were
    // renamed or moved.
    const sources = await readProductionSources()

    expect(sources.length).toBeGreaterThan(0)
  })

  test('no source names a language the registry owns', async () => {
    const bannedIds = new Set<string>(supportedSignalLanguages)
    const violations = (await readProductionSources()).flatMap((source) =>
      quotedLiteralsIn(source.source)
        .filter((literal) => bannedIds.has(literal.toLowerCase()))
        .map((literal) => `${source.path} names the language "${literal}"`)
    )

    expect(violations).toEqual([])
  })

  test('no source tests a file extension of its own', async () => {
    const bannedExtensions = new Set<string>(
      supportedSignalLanguageDefinitions.flatMap(
        (definition) => definition.extensions
      )
    )
    const violations = (await readProductionSources()).flatMap((source) =>
      quotedLiteralsIn(source.source)
        .filter((literal) => bannedExtensions.has(literal.toLowerCase()))
        .map((literal) => `${source.path} tests the extension "${literal}"`)
    )

    expect(violations).toEqual([])
  })

  test('classification is delegated to the registry rather than redefined', async () => {
    const sources = await readProductionSources()
    const combined = sources.map((source) => source.source).join('\n')

    // Which files are source at all, and which are test material, are the two
    // questions this signal asks. Both are answered by the shared definitions the
    // rest of the engine uses; a second definition here is how "is this a test
    // file" ends up meaning two different things in one codebase.
    expect(combined).toContain('supportedSignalLanguageForPath')
    expect(combined).toContain('isTestSideFile')
  })
})
