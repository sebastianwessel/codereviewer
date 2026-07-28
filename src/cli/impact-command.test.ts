// End-to-end coverage of `impact check` over a REAL git repository. It stays
// hermetic and free: the command makes no provider call at all, so nothing here
// costs money or varies run to run. Git is used rather than a scripted runner
// because the CLI deliberately exposes no git seam — intake owns git, and the
// point of this file is to exercise the command exactly as a user runs it.
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { ChangeImpactReferenceReport } from '../domains/change-impact/index.js'
import { runCli } from './index.js'

const git = (root: string, args: readonly string[]): void => {
  execFileSync('git', [...args], { cwd: root, stdio: 'pipe' })
}

const writeConfig = async (
  root: string,
  changeImpact: Record<string, unknown>
): Promise<void> => {
  await mkdir(join(root, '.codereviewer'), { recursive: true })
  await writeFile(
    join(root, '.codereviewer', 'config.json'),
    JSON.stringify({ changeImpact }, null, 2)
  )
}

// A base commit exporting two symbols with call sites, then a head commit that
// modifies one export and deletes the file holding the other.
const createRepository = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'codereviewer-impact-cli-'))

  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(
    join(root, 'src', 'store.ts'),
    'export const fetchUser = () => null\n'
  )
  await writeFile(
    join(root, 'src', 'legacy.ts'),
    'export const legacyApi = () => 1\n'
  )
  await writeFile(
    join(root, 'src', 'caller.ts'),
    [
      'import { fetchUser } from "./store.js"',
      'import { legacyApi } from "./legacy.js"',
      'export const a = fetchUser()',
      'export const c = legacyApi()',
      ''
    ].join('\n')
  )

  git(root, ['init', '-q', '-b', 'main'])
  git(root, ['config', 'user.email', 'test@example.com'])
  git(root, ['config', 'user.name', 'Test'])
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'base'])

  await writeFile(
    join(root, 'src', 'store.ts'),
    'export const fetchUser = (id: string) => id\n'
  )
  await rm(join(root, 'src', 'legacy.ts'))
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'change the contract'])

  return root
}

const parseReport = (stdout: string): ChangeImpactReferenceReport =>
  JSON.parse(stdout) as ChangeImpactReferenceReport

describe('impact CLI', () => {
  test('rejects a subcommand other than check', async () => {
    const result = await runCli(['impact', 'run'], { cwd: '/repo', environment: {} })

    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stderr).message).toBe(
      'Expected command: impact check'
    )
  })

  test('reports disabled, and exits 0, when the capability is off by default', async () => {
    const root = await createRepository()

    try {
      const result = await runCli(
        ['impact', 'check', '--base-ref', 'main~1', '--head-ref', 'HEAD'],
        { cwd: root, environment: {} }
      )

      expect(result.exitCode).toBe(0)
      expect(parseReport(result.stdout).status).toBe('disabled')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('names the changed symbols and every place they are referenced', async () => {
    const root = await createRepository()

    try {
      await writeConfig(root, { enabled: true })
      const result = await runCli(
        ['impact', 'check', '--base-ref', 'main~1', '--head-ref', 'HEAD'],
        { cwd: root, environment: {} }
      )
      const report = parseReport(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(report.status).toBe('completed')
      expect(report.scope.changedFileCount).toBe(1)
      expect(report.scope.deletedFileCount).toBe(1)
      expect(
        report.symbols.map((symbol) => [
          symbol.definitionPath,
          symbol.name,
          symbol.changeKind,
          symbol.references.map(
            (reference) => `${reference.path}:${reference.line}`
          )
        ])
      ).toEqual([
        // The deleted export is spec 22's strongest case: nothing of it survives
        // on disk, yet both of its call sites are still named.
        [
          'src/legacy.ts',
          'legacyApi',
          'deleted',
          ['src/caller.ts:2', 'src/caller.ts:4']
        ],
        [
          'src/store.ts',
          'fetchUser',
          'modified',
          ['src/caller.ts:1', 'src/caller.ts:3']
        ]
      ])
      expect(report.symbols[0]?.references[0]?.text).toBe(
        'import { legacyApi } from "./legacy.js"'
      )
      expect(report.summary).toEqual({
        changedSymbolCount: 2,
        changedSymbolsTruncated: false,
        referencedSymbolCount: 2,
        referenceCount: 4,
        testReferenceCount: 0,
        nonSourceReferenceCount: 0
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // The defect the first real run exposed, driven through the command a user
  // actually types: a README and a fixture mentioning the symbol must not appear
  // as dependents, and the report must still admit they were found.
  test('a documentation mention and a fixture mention are withheld, counted, and kept out of the list', async () => {
    const root = await createRepository()

    try {
      await writeConfig(root, { enabled: true })
      await mkdir(join(root, 'eval'), { recursive: true })
      await writeFile(
        join(root, 'README.md'),
        'Call `fetchUser` and then `legacyApi`.\n'
      )
      await writeFile(
        join(root, 'eval', 'case.json'),
        '{ "snippet": "fetchUser()" }\n'
      )
      await writeFile(
        join(root, 'src', 'caller.test.ts'),
        'test("fetchUser", () => fetchUser())\n'
      )
      const result = await runCli(
        ['impact', 'check', '--base-ref', 'main~1', '--head-ref', 'HEAD'],
        { cwd: root, environment: {} }
      )
      const report = parseReport(result.stdout)
      const fetchUser = report.symbols.find(
        (symbol) => symbol.name === 'fetchUser'
      )

      expect(result.exitCode).toBe(0)
      expect(
        fetchUser?.references.map((reference) => reference.path)
      ).toEqual(['src/caller.ts', 'src/caller.ts'])
      expect(
        fetchUser?.testReferences.map((reference) => reference.path)
      ).toEqual(['src/caller.test.ts'])
      expect(fetchUser?.referencesInNonSourceFiles).toBe(2)
      expect(report.summary.referenceCount).toBe(4)
      expect(report.summary.testReferenceCount).toBe(1)
      // The README mentions both symbols; the fixture mentions one.
      expect(report.summary.nonSourceReferenceCount).toBe(3)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // The exit code is the load-bearing part of this wave's honesty: a reference
  // list is not a finding, so there is nothing to block on.
  test('exits 0 whether or not references are found', async () => {
    const root = await createRepository()

    try {
      await writeConfig(root, { enabled: true })
      const withReferences = await runCli(
        ['impact', 'check', '--base-ref', 'main~1', '--head-ref', 'HEAD'],
        { cwd: root, environment: {} }
      )
      // An empty range: no changed file, therefore no symbol and no reference.
      const withoutReferences = await runCli(
        ['impact', 'check', '--base-ref', 'HEAD', '--head-ref', 'HEAD'],
        { cwd: root, environment: {} }
      )

      expect(parseReport(withReferences.stdout).summary.referenceCount).toBe(4)
      expect(withReferences.exitCode).toBe(0)
      expect(parseReport(withoutReferences.stdout).symbols).toEqual([])
      expect(withoutReferences.exitCode).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('per-symbol bounds are honoured and reported as truncation', async () => {
    const root = await createRepository()

    try {
      await writeConfig(root, { enabled: true, maxReferencesPerSymbol: 1 })
      const result = await runCli(
        ['impact', 'check', '--base-ref', 'main~1', '--head-ref', 'HEAD'],
        { cwd: root, environment: {} }
      )
      const report = parseReport(result.stdout)

      expect(
        report.symbols.map((symbol) => [
          symbol.references.length,
          symbol.referencesTruncated
        ])
      ).toEqual([
        [1, true],
        [1, true]
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('maps an unresolvable ref to the repository exit code, not to a report', async () => {
    const root = await createRepository()

    try {
      await writeConfig(root, { enabled: true })
      const result = await runCli(
        ['impact', 'check', '--base-ref', 'no-such-ref', '--head-ref', 'HEAD'],
        { cwd: root, environment: {} }
      )

      expect(result.exitCode).toBe(3)
      expect(result.stdout).toBe('')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
