// Structural enforcement that the dependency evidence table in
// `specs/08-dependencies-and-release.md` states what `package.json` and
// `package-lock.json` actually hold.
//
// That spec opens with "Ranges are the committed `package.json`; versions,
// licenses, and engines are the resolved packages in the committed lockfile",
// and then, further down, admits the gap this file closes: "The table itself is
// a dated snapshot and its refresh is owed under *Dependency updates require …
// dependency evidence refresh in this spec*; no automated check covers that
// drift."
//
// Nothing covered it, and on 2026-08-17 eight of sixteen rows were wrong. Four
// were the harness packages, whose peer ranges had been narrowed from `^1.6.0`
// to `^1.7.3` two months BEFORE the spec was last edited — so a paragraph
// arguing that narrowing them "would reject working 1.6.x adapters for no
// benefit" was sitting above a `package.json` that had already narrowed them.
// The rest were routine version bumps the table never followed.
//
// A dated snapshot nobody checks is not evidence, and this table is what the
// release process reads. The check is a test rather than a script for the
// reason `import-cycles.test.ts` gives: a check that runs only when somebody
// remembers to type it is the same as no check.
//
// What is deliberately NOT pinned:
//   - the Role column, which is prose;
//   - license and engine for a package the lockfile does not install (the two
//     uninstalled optional peers). Their cells state facts about a registry
//     this suite does not read, so asserting them here would only pin a guess.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)

const documentPath = path.join('specs', '08-dependencies-and-release.md')

const sectionHeading = '## Dependency Evidence'

const notInstalled = 'not installed'
const notDeclared = 'not declared'

type DocumentedDependency = {
  readonly packageName: string
  readonly declaredRange: string
  readonly resolvedVersion: string
  readonly license: string
  readonly engine: string
}

type ResolvedDependency = {
  readonly declaredRange: string
  readonly resolvedVersion: string
  readonly license: string
  readonly engine: string
}

// The rows of the table that follows `sectionHeading`, read as cells. Literal
// on purpose: a row this cannot read is a row the assertions never see, so the
// shape it expects (six columns, a backticked package name) is asserted rather
// than assumed, and the row-set equality below turns an unparsed row into a
// failure instead of a silent omission.
const documentedDependencies = (
  markdown: string
): readonly DocumentedDependency[] => {
  const section = markdown.split(sectionHeading)[1]

  if (section === undefined) {
    throw new Error(
      `${documentPath} has no "${sectionHeading}" section; the dependency table moved or was renamed.`
    )
  }

  const rows: DocumentedDependency[] = []

  for (const line of section.split('\n')) {
    const trimmed = line.trim()

    if (!trimmed.startsWith('|')) {
      // The table ends at the first non-row line after it started.
      if (rows.length > 0) {
        break
      }
      continue
    }

    // `\|` is a literal pipe inside a cell, not a column separator. It is not a
    // hypothetical: `vitest` declares `^20.0.0 || ^22.0.0 || >=24.0.0`, and the
    // table carried those bars unescaped — which made the row seven cells wide
    // for this parser and, more to the point, rendered as a broken row wherever
    // the spec is read as Markdown.
    const cells = trimmed
      .slice(1, /(?<!\\)\|$/u.test(trimmed) ? -1 : undefined)
      .split(/(?<!\\)\|/u)
      .map((cell) => cell.trim().replaceAll('\\|', '|'))
    const [packageName, , declaredRange, resolvedVersion, license, engine] =
      cells

    if (
      cells.length !== 6 ||
      packageName === undefined ||
      declaredRange === undefined ||
      resolvedVersion === undefined ||
      license === undefined ||
      engine === undefined ||
      // The header row and its `| --- |` separator.
      !packageName.startsWith('`')
    ) {
      continue
    }

    rows.push({
      packageName: packageName.replaceAll('`', ''),
      declaredRange: declaredRange.replaceAll('`', ''),
      resolvedVersion: resolvedVersion.replaceAll('`', ''),
      license: license.replaceAll('`', ''),
      engine: engine.replaceAll('`', '')
    })
  }

  return rows
}

const readJson = async (relativePath: string): Promise<Record<string, never>> =>
  JSON.parse(await readFile(path.join(repositoryRoot, relativePath), 'utf8'))

// Every package this repository declares anywhere, paired with what the lockfile
// resolved for it. First declaration wins, so a package that is both an optional
// peer and a devDependency (the OpenAI adapter) is reported once, under the range
// a consumer sees.
const resolvedDependencies = async (): Promise<
  ReadonlyMap<string, ResolvedDependency>
> => {
  const manifest = (await readJson('package.json')) as unknown as {
    readonly dependencies?: Readonly<Record<string, string>>
    readonly devDependencies?: Readonly<Record<string, string>>
    readonly peerDependencies?: Readonly<Record<string, string>>
  }
  const lockfile = (await readJson('package-lock.json')) as unknown as {
    readonly packages: Readonly<
      Record<
        string,
        {
          readonly version?: string
          readonly license?: string
          readonly engines?: { readonly node?: string }
        }
      >
    >
  }

  const resolved = new Map<string, ResolvedDependency>()

  for (const declared of [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies
  ]) {
    for (const [packageName, declaredRange] of Object.entries(declared ?? {})) {
      if (resolved.has(packageName)) {
        continue
      }

      const installed = lockfile.packages[`node_modules/${packageName}`]

      resolved.set(packageName, {
        declaredRange,
        resolvedVersion: installed?.version ?? notInstalled,
        license: installed?.license ?? notDeclared,
        engine: installed?.engines?.node ?? notDeclared
      })
    }
  }

  return resolved
}

describe('documented dependency evidence', () => {
  test('the table states the committed ranges, versions, licenses and engines', async () => {
    const markdown = await readFile(
      path.join(repositoryRoot, documentPath),
      'utf8'
    )
    const rows = documentedDependencies(markdown)
    const resolved = await resolvedDependencies()

    // Anti-vacuity: a parse that silently matched nothing would pass every
    // assertion below.
    expect(resolved.size).toBeGreaterThan(10)

    // Every declared package is documented, and nothing that is not declared is.
    // This is what makes adding a dependency without a row a failure.
    expect([...rows].map((row) => row.packageName).sort()).toEqual(
      [...resolved.keys()].sort()
    )

    for (const row of rows) {
      const actual = resolved.get(row.packageName)

      if (actual === undefined) {
        throw new Error(`unreachable: ${row.packageName} was matched above`)
      }

      expect(row.declaredRange, `declared range for ${row.packageName}`).toBe(
        actual.declaredRange
      )
      expect(
        row.resolvedVersion,
        `resolved version for ${row.packageName}`
      ).toBe(actual.resolvedVersion)

      // See the header: a package the lockfile does not install has no license
      // or engine to read, so those two cells are left to the author.
      if (actual.resolvedVersion === notInstalled) {
        continue
      }

      expect(row.license, `license for ${row.packageName}`).toBe(actual.license)
      expect(row.engine, `engine for ${row.packageName}`).toBe(actual.engine)
    }
  })
})
