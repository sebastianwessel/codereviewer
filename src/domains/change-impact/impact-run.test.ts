import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../../shared/contracts/index.js'
import type { GitCommandRunner } from '../repository-intake/index.js'
import { ChangeImpactReferenceReportSchema } from './impact-report.js'
import { runChangeImpact } from './impact-run.js'

const mergeBaseSha = '9f1c2ab3d4e5f60718293a4b5c6d7e8f90a1b2c3'
const generatedAt = new Date('2026-07-28T00:00:00.000Z')

const enabledConfig = CodeReviewerConfigSchema.parse({
  changeImpact: { enabled: true }
})

const createRepo = async (): Promise<string> => {
  const root = join(tmpdir(), `codereviewer-impact-run-${crypto.randomUUID()}`)

  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(
    join(root, 'src', 'store.ts'),
    'export const fetchUser = (id: string) => id\n'
  )
  await writeFile(
    join(root, 'src', 'caller.ts'),
    [
      'import { fetchUser, legacyApi } from "./store.js"',
      'export const a = fetchUser("b")',
      'export const c = legacyApi()'
    ].join('\n')
  )

  return root
}

const readChangedFile = (root: string) => async (path: string) => {
  try {
    return await readFile(join(root, path), 'utf8')
  } catch {
    return undefined
  }
}

// Scripted git keeps the run hermetic and lets the argument vectors be asserted
// rather than inferred. Every command it answers is one intake is allowed to
// issue.
const scriptedGit =
  (
    outputs: Readonly<Record<string, string>>,
    issued?: string[][]
  ): GitCommandRunner =>
  async (args) => {
    issued?.push([...args])
    const output = outputs[args.join(' ')]

    if (output === undefined) {
      throw new Error(`Unexpected git command: ${args.join(' ')}`)
    }

    return output
  }

const gitOutputs: Readonly<Record<string, string>> = {
  'merge-base main HEAD': `${mergeBaseSha}\n`,
  [`diff --name-status ${mergeBaseSha} HEAD`]:
    'M\tsrc/store.ts\nD\tsrc/legacy.ts\n',
  [`diff --unified=0 ${mergeBaseSha} HEAD -- src/store.ts src/legacy.ts`]:
    'diff --git a/src/store.ts b/src/store.ts\n' +
    '--- a/src/store.ts\n+++ b/src/store.ts\n@@ -1,1 +1,1 @@\n' +
    '-export const fetchUser = () => null\n' +
    '+export const fetchUser = (id: string) => id\n' +
    'diff --git a/src/legacy.ts b/src/legacy.ts\n' +
    'deleted file mode 100644\n--- a/src/legacy.ts\n+++ /dev/null\n' +
    '@@ -1,1 +0,0 @@\n-export const legacyApi = () => 1\n'
}

describe('change impact run', () => {
  test('reports disabled plainly rather than emitting an empty completed report', async () => {
    const report = await runChangeImpact({
      repositoryRoot: '/repo',
      config: CodeReviewerConfigSchema.parse({}),
      generatedAt,
      readChangedFile: async () => undefined,
      runGit: scriptedGit({})
    })

    expect(report.status).toBe('disabled')
    expect(report.symbols).toEqual([])
    expect(report.summary.changedSymbolCount).toBe(0)
    expect(report.warnings).toEqual([
      'Change-impact review is disabled. Set changeImpact.enabled to true to run it.'
    ])
  })

  test('seeds from the diff, including a deleted file, and reports every reference site', async () => {
    const root = await createRepo()
    const issued: string[][] = []

    try {
      const report = await runChangeImpact({
        repositoryRoot: root,
        config: enabledConfig,
        baseRef: 'main',
        headRef: 'HEAD',
        generatedAt,
        readChangedFile: readChangedFile(root),
        runGit: scriptedGit(gitOutputs, issued)
      })

      // Deleted paths reach the unified diff only because the run opts into
      // `includeDeletedPaths`; without it the last argument would be absent.
      expect(issued.at(-1)).toEqual([
        'diff',
        '--unified=0',
        mergeBaseSha,
        'HEAD',
        '--',
        'src/store.ts',
        'src/legacy.ts'
      ])
      expect(report.status).toBe('completed')
      expect(report.scope).toEqual({
        baseRef: 'main',
        headRef: 'HEAD',
        mergeBaseRef: mergeBaseSha,
        changedFileCount: 1,
        deletedFileCount: 1
      })
      expect(
        report.symbols.map((symbol) => [
          symbol.name,
          symbol.changeKind,
          symbol.references.map(
            (reference) => `${reference.path}:${reference.line}`
          )
        ])
      ).toEqual([
        // The deleted file's exported symbol is seeded even though nothing of it
        // survives on disk. That is spec 22's strongest case, and it is only
        // visible because intake was asked for deleted paths.
        ['legacyApi', 'deleted', ['src/caller.ts:1', 'src/caller.ts:3']],
        ['fetchUser', 'modified', ['src/caller.ts:1', 'src/caller.ts:2']]
      ])
      expect(report.summary).toEqual({
        changedSymbolCount: 2,
        changedSymbolsTruncated: false,
        referencedSymbolCount: 2,
        referenceCount: 4,
        testReferenceCount: 0,
        nonSourceReferenceCount: 0
      })
      expect(report.warnings).toEqual([])
      expect(() =>
        ChangeImpactReferenceReportSchema.parse(report)
      ).not.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('reports no impact rather than manufacturing entries when nothing depends on the change', async () => {
    const root = await createRepo()

    try {
      const report = await runChangeImpact({
        repositoryRoot: root,
        config: enabledConfig,
        baseRef: 'main',
        headRef: 'HEAD',
        generatedAt,
        readChangedFile: readChangedFile(root),
        runGit: scriptedGit({
          'merge-base main HEAD': `${mergeBaseSha}\n`,
          [`diff --name-status ${mergeBaseSha} HEAD`]: 'M\tsrc/caller.ts\n',
          [`diff --unified=0 ${mergeBaseSha} HEAD -- src/caller.ts`]:
            'diff --git a/src/caller.ts b/src/caller.ts\n' +
            '--- a/src/caller.ts\n+++ b/src/caller.ts\n@@ -2,1 +2,1 @@\n' +
            '-export const a = 1\n+export const a = fetchUser("b")\n'
        })
      })

      expect(report.symbols).toEqual([
        expect.objectContaining({
          name: 'a',
          references: [],
          referencesInDefinitionFile: 1,
          referencesTruncated: false
        })
      ])
      expect(report.summary.referencedSymbolCount).toBe(0)
      expect(report.summary.referenceCount).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // Spec 22, "Requirement added as a result": the first real run put a third of
  // its reference sites in prose and fixture data. This drives the same shapes
  // through the whole composition rather than through `discoverDependents` alone,
  // because the eligibility half of the requirement is only wired up here.
  test('keeps prose and fixture data out of the reference list, and out of the headline count', async () => {
    const root = await createRepo()

    try {
      await mkdir(join(root, 'docs'), { recursive: true })
      await mkdir(join(root, 'eval'), { recursive: true })
      await mkdir(join(root, 'vendor'), { recursive: true })
      await writeFile(
        join(root, 'docs', 'guide.md'),
        'Call `fetchUser` to load a user.\n'
      )
      await writeFile(
        join(root, 'eval', 'slice.json'),
        '{ "snippet": "const x = fetchUser(1)" }\n'
      )
      await writeFile(
        join(root, 'src', 'store.test.ts'),
        'test("fetchUser", () => fetchUser("a"))\n'
      )
      // Eligible-by-extension but excluded by configuration: proves the two
      // filters are independent and that the configured rules still bind.
      await writeFile(
        join(root, 'vendor', 'copy.ts'),
        'export const b = fetchUser("c")\n'
      )
      const report = await runChangeImpact({
        repositoryRoot: root,
        config: CodeReviewerConfigSchema.parse({
          changeImpact: { enabled: true },
          paths: { exclude: ['vendor/**'] }
        }),
        baseRef: 'main',
        headRef: 'HEAD',
        generatedAt,
        readChangedFile: readChangedFile(root),
        runGit: scriptedGit(gitOutputs)
      })
      const fetchUser = report.symbols.find(
        (symbol) => symbol.name === 'fetchUser'
      )

      expect(
        fetchUser?.references.map((reference) => reference.path)
      ).toEqual(['src/caller.ts', 'src/caller.ts'])
      expect(
        fetchUser?.testReferences.map((reference) => reference.path)
      ).toEqual(['src/store.test.ts'])
      // Withheld, not hidden: the markdown line and the JSON fixture line.
      expect(fetchUser?.referencesInNonSourceFiles).toBe(2)
      expect(report.summary.referenceCount).toBe(4)
      expect(report.summary.testReferenceCount).toBe(1)
      expect(report.summary.nonSourceReferenceCount).toBe(2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('warns instead of failing when no symbol could be seeded', async () => {
    const root = await createRepo()

    try {
      await writeFile(join(root, 'notes.md'), '# Notes\n')
      const report = await runChangeImpact({
        repositoryRoot: root,
        config: enabledConfig,
        baseRef: 'main',
        headRef: 'HEAD',
        generatedAt,
        readChangedFile: readChangedFile(root),
        runGit: scriptedGit({
          'merge-base main HEAD': `${mergeBaseSha}\n`,
          [`diff --name-status ${mergeBaseSha} HEAD`]: 'M\tnotes.md\n',
          [`diff --unified=0 ${mergeBaseSha} HEAD -- notes.md`]:
            'diff --git a/notes.md b/notes.md\n' +
            '--- a/notes.md\n+++ b/notes.md\n@@ -1,1 +1,1 @@\n-# Old\n+# Notes\n'
        })
      })

      expect(report.status).toBe('completed')
      expect(report.symbols).toEqual([])
      expect(report.warnings).toEqual([
        // States what was observed, not a cause. The old wording asserted
        // "unsupported language" whenever nothing was seeded, and that misdiagnosis
        // sent a real investigation after a language bug that did not exist: the
        // actual cause was changed lines falling outside every symbol's span.
        'No changed symbols were seeded from the changed files. Either the files are in a language the deterministic signal extractors do not cover, or none of the changed lines fall inside a symbol this engine can name.'
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('the report schema carries no finding, severity, or gate field', () => {
    // The distinction this wave rests on: a reference list is NOT a finding. Spec
    // 22 requires a finding to carry the contract element relied upon and the
    // consequence, and a deterministic list has neither. Anything below appearing
    // in this schema would misrepresent what was measured.
    const shape = Object.keys(ChangeImpactReferenceReportSchema.shape)

    expect(shape).toEqual([
      'schemaVersion',
      'status',
      'generatedAt',
      'scope',
      'summary',
      'symbols',
      'warnings'
    ])
    for (const forbidden of [
      'findings',
      'admittedFindings',
      'severity',
      'qualityGate',
      'passed',
      'blocking'
    ]) {
      expect(shape).not.toContain(forbidden)
    }
    expect(
      Object.keys(ChangeImpactReferenceReportSchema.shape.symbols.element.shape)
    ).not.toContain('severity')
  })
})
