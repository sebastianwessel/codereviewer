import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { TRUNCATION_MARK } from '../../shared/text/truncate.js'
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
  // Every fixture symbol here occupies exactly its declaration line. These tests
  // are about reference POLICY — which destinations count as a dependent — and
  // the span only decides which diff lines a contract delta is read from, which
  // no test in this file exercises.
  spanEndLine: line,
  changeKind: 'modified'
})

describe('reference list quality', () => {
  test('a symbol named only in a comment is not a dependent', async () => {
    // References are found by TEXT SEARCH, not by resolving bindings, so prose
    // matches as strongly as a call. Rack's `scheme` returned 53 references, one of
    // them `## The URL scheme, which must be one of <tt>http</tt>…` — documentation,
    // listed beside real call sites with nothing to tell them apart. A list that
    // looks like signal while carrying prose is worse than a shorter honest one.
    const root = join(tmpdir(), `codereviewer-comments-${crypto.randomUUID()}`)
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src', 'store.ts'),
      'export const fetchUser = (id: string) => id\n'
    )
    await writeFile(
      join(root, 'src', 'docs.ts'),
      ['// fetchUser is documented here and never called', 'export const x = 1'].join('\n')
    )
    await writeFile(
      join(root, 'src', 'real.ts'),
      ['import { fetchUser } from "./store.js"', 'export const a = fetchUser("b")'].join('\n')
    )

    try {
      const [symbol] = await discoverDependents({
        repositoryRoot: root,
        changedSymbols: [changedSymbol('fetchUser', 1)],
        maxReferencesPerSymbol: 20,
        maxSearchDepth: 5
      })

      const paths = (symbol?.references ?? []).map((reference) => reference.path)
      expect(paths).toContain('src/real.ts')
      expect(paths).not.toContain('src/docs.ts')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('a reference in a file the change also touched is listed first', async () => {
    // Whatever sits at the top of a long reference list is effectively the whole
    // report, because nobody opens all of them. A dependent that moved ALONGSIDE
    // the symbol it depends on is where a contract mismatch is most likely to have
    // been introduced and least likely to have been noticed.
    const root = join(tmpdir(), `codereviewer-rank-${crypto.randomUUID()}`)
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'store.ts'), 'export const fetchUser = (id: string) => id\n')
    await writeFile(
      join(root, 'src', 'aaa-untouched.ts'),
      ['import { fetchUser } from "./store.js"', 'export const a = fetchUser("x")'].join('\n')
    )
    await writeFile(
      join(root, 'src', 'zzz-touched.ts'),
      ['import { fetchUser } from "./store.js"', 'export const z = fetchUser("y")'].join('\n')
    )

    try {
      const [symbol] = await discoverDependents({
        repositoryRoot: root,
        changedSymbols: [
          changedSymbol('fetchUser', 1),
          // The change also touched this file, so its reference outranks the other
          // even though it sorts last by name.
          { ...changedSymbol('z', 2), path: 'src/zzz-touched.ts' }
        ],
        maxReferencesPerSymbol: 20,
        maxSearchDepth: 5
      })

      expect(symbol?.references[0]?.path).toBe('src/zzz-touched.ts')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
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
          symbol: expect.objectContaining({ name: 'unusedElsewhere' }),
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
      // A cut line is not the line at that address. Unmarked, a 300-character
      // excerpt of a 600-character line is indistinguishable from a line that is
      // exactly 300 characters long.
      expect(generatedReference?.text.endsWith(TRUNCATION_MARK)).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // Spec 22's added requirement, and the reason for it: the first real run put a
  // third of its reference sites in prose, fixture data and snapshots. Those are
  // textual coincidence, and a list a reader must filter by hand loses to the
  // `grep` this capability has to beat.
  test('withholds non-source destinations from the list and reports how many there were', async () => {
    const root = await createRepo()

    try {
      await mkdir(join(root, 'docs'), { recursive: true })
      await mkdir(join(root, 'eval'), { recursive: true })
      await writeFile(
        join(root, 'docs', 'guide.md'),
        'Use fetchUser to load a user.\n'
      )
      await writeFile(
        join(root, 'eval', 'slice.json'),
        '{ "snippet": "const user = fetchUser(1)" }\n'
      )
      await writeFile(
        join(root, 'src', 'store.snap'),
        'exports[`fetchUser`] = `1`\n'
      )
      const symbols = await discoverDependents({
        repositoryRoot: root,
        changedSymbols: [changedSymbol('fetchUser', 1)],
        maxReferencesPerSymbol: 25,
        maxSearchDepth: 12
      })

      expect(symbols[0]?.references.map((reference) => reference.path)).toEqual([
        'src/caller.ts',
        'src/caller.ts'
      ])
      // The markdown line and the JSON line. The snapshot never reaches the
      // classifier: `**/*.snap` is a default review exclude, so the eligibility
      // gate prunes it during traversal — the two filters are independent.
      expect(symbols[0]?.referencesInNonSourceFiles).toBe(2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('lists a test call site in its own bucket rather than dropping it or mixing it in', async () => {
    const root = await createRepo()

    try {
      await writeFile(
        join(root, 'src', 'store.test.ts'),
        [
          'import { fetchUser } from "./store.js"',
          'test("fetchUser", () => fetchUser("a"))'
        ].join('\n')
      )
      const symbols = await discoverDependents({
        repositoryRoot: root,
        changedSymbols: [changedSymbol('fetchUser', 1)],
        maxReferencesPerSymbol: 25,
        maxSearchDepth: 12
      })

      // A test that calls the changed symbol IS a dependent — it breaks. It is
      // listed in full, just not in the production list it would otherwise
      // dominate.
      expect(
        symbols[0]?.testReferences.map((reference) => [
          reference.path,
          reference.line
        ])
      ).toEqual([
        ['src/store.test.ts', 1],
        ['src/store.test.ts', 2]
      ])
      expect(
        symbols[0]?.references.every(
          (reference) => reference.path === 'src/caller.ts'
        )
      ).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('honours the configured exclude rules rather than defining its own eligible set', async () => {
    const root = await createRepo()

    try {
      await mkdir(join(root, 'vendor'), { recursive: true })
      await writeFile(
        join(root, 'vendor', 'copy.ts'),
        'export const b = fetchUser("c")\n'
      )
      const symbols = await discoverDependents({
        repositoryRoot: root,
        changedSymbols: [changedSymbol('fetchUser', 1)],
        maxReferencesPerSymbol: 25,
        maxSearchDepth: 12,
        paths: { exclude: ['vendor/**'] }
      })

      // `vendor/copy.ts` is a perfectly good source file. It is absent because
      // the configured review scope excludes it, which is the same rule the diff
      // reviewer applies — not a second notion of "eligible" maintained here.
      expect(symbols[0]?.references.map((reference) => reference.path)).toEqual([
        'src/caller.ts',
        'src/caller.ts'
      ])
      expect(symbols[0]?.referencesInNonSourceFiles).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // Discovery answers "where is this used", not "what is this". The seed it was
  // given comes back attached to the answer so the report assembly can join the
  // two without re-deriving anything, and a search result can never be attributed
  // to a symbol other than the one queried.
  test('returns each result attached to the seed it was searched for', async () => {
    const root = await createRepo()

    try {
      const symbols = await discoverDependents({
        repositoryRoot: root,
        changedSymbols: [changedSymbol('fetchUser', 1)],
        maxReferencesPerSymbol: 25,
        maxSearchDepth: 12
      })

      expect(symbols[0]?.symbol).toEqual(changedSymbol('fetchUser', 1))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
