import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../../shared/contracts/index.js'
import type { GitCommandRunner } from '../repository-intake/index.js'
import {
  ChangeImpactReferenceReportSchema,
  type ChangeImpactReferenceReport
} from './impact-report.js'
import { runChangeImpact } from './impact-run.js'

const mergeBaseSha = '9f1c2ab3d4e5f60718293a4b5c6d7e8f90a1b2c3'
const generatedAt = new Date('2026-07-28T00:00:00.000Z')

const enabledConfig = CodeReviewerConfigSchema.parse({
  changeImpact: { enabled: true }
})

// Adjudication is a SECOND switch, off even when the command is on, because it is
// the only part of `impact check` that can reach a provider.
const adjudicatingConfig = CodeReviewerConfigSchema.parse({
  changeImpact: { enabled: true, adjudication: { enabled: true } }
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
    expect(report.changedSymbols).toEqual([])
    expect(report.impactedFiles).toEqual([])
    expect(report.impactedTestFiles).toEqual([])
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
        report.changedSymbols.map((symbol) => [symbol.name, symbol.changeKind])
      ).toEqual([
        // The deleted file's exported symbol is seeded even though nothing of it
        // survives on disk. That is spec 22's strongest case, and it is only
        // visible because intake was asked for deleted paths. Nothing in this
        // change declares the name again, so the removal is the confident one.
        ['legacyApi', 'deleted'],
        ['fetchUser', 'modified']
      ])
      expect(report.changedSymbols[0]?.removalPairing).toEqual({
        match: 'none'
      })
      // The report's primary list is the DESTINATION FILE, with the changed
      // symbols reaching it named on it and their sites nested beneath. Spec 22
      // requires that granularity on measured grounds.
      expect(
        report.impactedFiles.map((file) => [
          file.path,
          file.symbols.map((symbol) => [
            symbol.name,
            symbol.sites.map((site) => site.line)
          ])
        ])
      ).toEqual([
        [
          'src/caller.ts',
          [
            ['legacyApi', [1, 3]],
            ['fetchUser', [1, 2]]
          ]
        ]
      ])
      // The contract delta reaches the report, and it is derived from the diff
      // this very run fetched rather than from a second read of the base
      // revision: `fetchUser` returned `null` before the change and does not
      // after, which is the whole difference between "this symbol was modified"
      // and a reason to open any of its call sites.
      expect(
        report.changedSymbols.map((symbol) => [
          symbol.name,
          symbol.contractChanges
        ])
      ).toEqual([
        // A deleted file has no head side to anchor a removal against, and its
        // deletion is already the strongest statement `changeKind` can make.
        ['legacyApi', []],
        ['fetchUser', ['no longer yields an absent value it previously could']]
      ])
      expect(report.summary).toEqual({
        changedSymbolCount: 2,
        changedSymbolsTruncated: false,
        referencedSymbolCount: 2,
        impactedFileCount: 1,
        impactedTestFileCount: 0,
        referenceCount: 4,
        testReferenceCount: 0,
        nonSourceReferenceCount: 0,
        // Adjudication is off in this config, so nothing was adjudicated and
        // every counter is zero. `adjudicationStatus` is what tells the reader
        // that, rather than an empty finding list they would have to interpret.
        impactFindingCount: 0,
        reliedUponPairCount: 0,
        deterministicNoImpactPairCount: 0,
        unadjudicatedPairCount: 0,
        adjudicationCallCount: 0,
        failedAdjudicationCallCount: 0,
        modelVerdictCounts: {
          relies: 0,
          'does-not-rely': 0,
          undetermined: 0
        },
        adjudicationCallsTruncated: false,
        rejectedFindingCount: 0
      })
      expect(report.adjudicationStatus).toBe('disabled')
      expect(report.impactFindings).toEqual([])
      expect(report.warnings).toEqual([
        'Change-impact adjudication is disabled, so no dependent was checked against the part of the contract that changed. The lists below are references, not findings. Set changeImpact.adjudication.enabled to true to run it.'
      ])
      expect(() =>
        ChangeImpactReferenceReportSchema.parse(report)
      ).not.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // Spec 22 design step 3, driven through the whole composition. Every case below
  // is hermetic and free: the model seam is a scripted runner, never a provider.
  describe('adjudication', () => {
    // A modified symbol whose contract visibly moved, and nothing else: the pure
    // residue case, so the model tier is the only one that can answer.
    const modifiedOnlyGit: Readonly<Record<string, string>> = {
      'merge-base main HEAD': `${mergeBaseSha}\n`,
      [`diff --name-status ${mergeBaseSha} HEAD`]: 'M\tsrc/store.ts\n',
      [`diff --unified=0 ${mergeBaseSha} HEAD -- src/store.ts`]:
        'diff --git a/src/store.ts b/src/store.ts\n' +
        '--- a/src/store.ts\n+++ b/src/store.ts\n@@ -1,1 +1,1 @@\n' +
        '-export const fetchUser = () => null\n' +
        '+export const fetchUser = (id: string) => id\n'
    }

    // A modified symbol whose diff carries no marker on either side: the empty
    // contract delta. Every dependent goes down the deterministic `no-impact`
    // branch and the model is never asked.
    const noContractChangeGit: Readonly<Record<string, string>> = {
      'merge-base main HEAD': `${mergeBaseSha}\n`,
      [`diff --name-status ${mergeBaseSha} HEAD`]: 'M\tsrc/store.ts\n',
      [`diff --unified=0 ${mergeBaseSha} HEAD -- src/store.ts`]:
        'diff --git a/src/store.ts b/src/store.ts\n' +
        '--- a/src/store.ts\n+++ b/src/store.ts\n@@ -1,1 +1,1 @@\n' +
        '-export const fetchUser = (id: string) => lookup(id)\n' +
        '+export const fetchUser = (id: string) => lookup(id.trim())\n'
    }

    // THE VOIDED RUN'S SHAPE, end to end. Spec 22's first adjudication
    // measurement was exactly this: a completed status, an empty finding list,
    // every dependent dropped by the deterministic tier, and ZERO model calls —
    // reported in a way that read as a judge rejecting everything.
    test('a run the deterministic tier settles alone reports zero calls, not zero rejections', async () => {
      const root = await createRepo()

      try {
        const report = await runChangeImpact({
          repositoryRoot: root,
          config: adjudicatingConfig,
          baseRef: 'main',
          headRef: 'HEAD',
          generatedAt,
          readChangedFile: readChangedFile(root),
          runGit: scriptedGit(noContractChangeGit),
          // Equipped with a judge, and it must still never be reached.
          agents: {
            judgeReliance: async () => {
              throw new Error('the deterministic tier must not call a model')
            }
          }
        })

        expect(report.adjudicationStatus).toBe('completed')
        expect(report.impactFindings).toEqual([])
        expect(report.summary.adjudicationCallCount).toBe(0)
        expect(report.summary.failedAdjudicationCallCount).toBe(0)
        expect(report.summary.modelVerdictCounts).toEqual({
          relies: 0,
          'does-not-rely': 0,
          undetermined: 0
        })
        // The removals belong to the tier that made them.
        expect(report.summary.deterministicNoImpactPairCount).toBeGreaterThan(0)
        expect(report.impactedFiles.map((file) => file.path)).toEqual([
          'src/caller.ts'
        ])
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })

    test('settles a removed declaration with no provider at all', async () => {
      const root = await createRepo()

      try {
        const report = await runChangeImpact({
          repositoryRoot: root,
          config: adjudicatingConfig,
          baseRef: 'main',
          headRef: 'HEAD',
          generatedAt,
          readChangedFile: readChangedFile(root),
          runGit: scriptedGit(gitOutputs)
          // No `agents`: the deterministic tier must not need one.
        })

        expect(report.adjudicationStatus).toBe('no-model')
        expect(report.impactFindings).toHaveLength(1)
        expect(report.impactFindings[0]).toMatchObject({
          path: 'src/caller.ts',
          destination: 'production',
          compatibilityClass: 'breaks-on-build'
        })
        expect(
          report.impactFindings[0]?.reliances.map((reliance) => [
            reliance.symbolName,
            reliance.line,
            reliance.adjudicatedBy
          ])
        ).toEqual([['legacyApi', 1, 'deterministic']])
        // `fetchUser` moved its contract but its declaration survives, so it is
        // residue. With no model it is COUNTED, never reported as a maybe:
        // reporting it would restate the noise adjudication exists to remove.
        expect(report.summary.unadjudicatedPairCount).toBe(1)
        expect(report.summary.impactFindingCount).toBe(1)
        expect(report.warnings).toContain(
          'No model was available for change-impact adjudication, so only the dependents that need none were checked. Everything else is counted as unadjudicated and is reported nowhere as a finding.'
        )
        expect(report.usage).toBeUndefined()
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })

    test('spends a call on the residue and reports what the model located', async () => {
      const root = await createRepo()
      const asked: string[] = []

      try {
        const report = await runChangeImpact({
          repositoryRoot: root,
          config: adjudicatingConfig,
          baseRef: 'main',
          headRef: 'HEAD',
          generatedAt,
          readChangedFile: readChangedFile(root),
          runGit: scriptedGit(modifiedOnlyGit),
          agents: {
            judgeReliance: async (input) => {
              asked.push(`${input.changedSymbol.name} ${input.dependent.path}`)

              return { status: 'relies', line: 2 }
            }
          }
        })

        expect(asked).toEqual(['fetchUser src/caller.ts'])
        expect(report.adjudicationStatus).toBe('completed')
        expect(report.impactFindings).toHaveLength(1)
        expect(report.impactFindings[0]).toMatchObject({
          path: 'src/caller.ts',
          // The name still resolves, so no build sees this; what moved is
          // behaviour, and this dependent was shown to use it.
          compatibilityClass: 'breaks-at-runtime'
        })

        const reliance = report.impactFindings[0]?.reliances[0]

        expect(reliance?.adjudicatedBy).toBe('model')
        expect(reliance?.line).toBe(2)
        expect(reliance?.contractElement).toBe(
          'fetchUser no longer yields an absent value it previously could'
        )
        // Composed in code from the contract dimension. The judging call has no
        // field to write prose into, by design.
        expect(reliance?.consequence).toBe(
          'handling here for the absent case can no longer be reached, so a branch this file relies on is now dead'
        )
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })

    test('reports no impact as an answer when the model finds no reliance', async () => {
      const root = await createRepo()

      try {
        const report = await runChangeImpact({
          repositoryRoot: root,
          config: adjudicatingConfig,
          baseRef: 'main',
          headRef: 'HEAD',
          generatedAt,
          readChangedFile: readChangedFile(root),
          runGit: scriptedGit(modifiedOnlyGit),
          agents: { judgeReliance: async () => ({ status: 'does-not-rely' }) }
        })

        // The distinction spec 22 requires: an empty list here is an ANSWER, and
        // `adjudicationStatus` plus the counters are what say so. The dependent
        // stays in the reference list, where a reader can still judge it.
        expect(report.impactFindings).toEqual([])
        expect(report.adjudicationStatus).toBe('completed')
        // The model was called and answered. Counted against the MODEL tier, so
        // this run can never be confused with one the deterministic tier swept.
        expect(report.summary.adjudicationCallCount).toBe(1)
        expect(report.summary.modelVerdictCounts).toEqual({
          relies: 0,
          'does-not-rely': 1,
          undetermined: 0
        })
        expect(report.summary.deterministicNoImpactPairCount).toBe(0)
        expect(report.summary.unadjudicatedPairCount).toBe(0)
        expect(report.impactedFiles.map((file) => file.path)).toEqual([
          'src/caller.ts'
        ])
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })

    test('survives a provider that throws, and still reports the rest', async () => {
      const root = await createRepo()

      try {
        const report = await runChangeImpact({
          repositoryRoot: root,
          config: adjudicatingConfig,
          baseRef: 'main',
          headRef: 'HEAD',
          generatedAt,
          readChangedFile: readChangedFile(root),
          runGit: scriptedGit(gitOutputs),
          agents: {
            judgeReliance: async () => {
              throw new Error('provider unavailable')
            }
          }
        })

        // Spec 22: "Failure MUST be recoverable." The run completes, the
        // deterministic finding still lands, the failed pair is counted rather
        // than claimed in either direction, and the reader is told.
        expect(report.status).toBe('completed')
        expect(report.adjudicationStatus).toBe('completed')
        expect(report.impactFindings).toHaveLength(1)
        expect(report.impactFindings[0]?.compatibilityClass).toBe(
          'breaks-on-build'
        )
        expect(report.summary.unadjudicatedPairCount).toBe(1)
        expect(report.warnings).toContain(
          '1 adjudication call(s) did not complete; those dependents are counted as unadjudicated and are not reported as findings.'
        )
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })
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

      expect(report.changedSymbols).toEqual([
        expect.objectContaining({
          name: 'a',
          referencesInDefinitionFile: 1,
          referencesTruncated: false
        })
      ])
      expect(report.impactedFiles).toEqual([])
      expect(report.impactedTestFiles).toEqual([])
      expect(report.summary.referencedSymbolCount).toBe(0)
      expect(report.summary.impactedFileCount).toBe(0)
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
      const fetchUser = report.changedSymbols.find(
        (symbol) => symbol.name === 'fetchUser'
      )
      const sitesFor = (
        files: ChangeImpactReferenceReport['impactedFiles']
      ): readonly string[] =>
        files.flatMap((file) =>
          file.symbols
            .filter((symbol) => symbol.name === 'fetchUser')
            .flatMap((symbol) => symbol.sites.map(() => file.path))
        )

      expect(sitesFor(report.impactedFiles)).toEqual([
        'src/caller.ts',
        'src/caller.ts'
      ])
      expect(sitesFor(report.impactedTestFiles)).toEqual(['src/store.test.ts'])
      // Withheld, not hidden: the markdown line and the JSON fixture line.
      expect(fetchUser?.referencesInNonSourceFiles).toBe(2)
      expect(report.summary.referenceCount).toBe(4)
      expect(report.summary.testReferenceCount).toBe(1)
      expect(report.summary.nonSourceReferenceCount).toBe(2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // Spec 22: "Removals must be paired with additions before reporting". Driven
  // through the whole composition because the pairing input — whether the head
  // side was read in full — is only assembled here.
  test('a renamed file is reported as a move rather than as a deletion', async () => {
    const root = join(tmpdir(), `codereviewer-impact-move-${crypto.randomUUID()}`)

    try {
      await mkdir(join(root, 'src', 'v2'), { recursive: true })
      await writeFile(
        join(root, 'src', 'v2', 'api.ts'),
        'export const legacyApi = () => 1\n'
      )
      const report = await runChangeImpact({
        repositoryRoot: root,
        config: enabledConfig,
        baseRef: 'main',
        headRef: 'HEAD',
        generatedAt,
        readChangedFile: readChangedFile(root),
        runGit: scriptedGit({
          'merge-base main HEAD': `${mergeBaseSha}\n`,
          [`diff --name-status ${mergeBaseSha} HEAD`]:
            'A\tsrc/v2/api.ts\nD\tsrc/legacy.ts\n',
          [`diff --unified=0 ${mergeBaseSha} HEAD -- src/v2/api.ts src/legacy.ts`]:
            'diff --git a/src/v2/api.ts b/src/v2/api.ts\n' +
            'new file mode 100644\n--- /dev/null\n+++ b/src/v2/api.ts\n' +
            '@@ -0,0 +1,1 @@\n+export const legacyApi = () => 1\n' +
            'diff --git a/src/legacy.ts b/src/legacy.ts\n' +
            'deleted file mode 100644\n--- a/src/legacy.ts\n+++ /dev/null\n' +
            '@@ -1,1 +0,0 @@\n-export const legacyApi = () => 1\n'
        })
      })
      const removed = report.changedSymbols.find(
        (symbol) => symbol.definitionPath === 'src/legacy.ts'
      )

      // Reported as a deletion — the most severe category this report has — the
      // move would read as "everything using this is broken", when callers of the
      // name still resolve.
      expect(removed?.changeKind).toBe('moved')
      expect(removed?.removalPairing).toEqual({
        match: 'same-name',
        declaration: { name: 'legacyApi', path: 'src/v2/api.ts', line: 1 }
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('a removal is not called confident when a changed file could not be read', async () => {
    const root = await createRepo()

    try {
      const report = await runChangeImpact({
        repositoryRoot: root,
        config: CodeReviewerConfigSchema.parse({
          changeImpact: { enabled: true },
          // One accepted file; the second is skipped as `too-many-files`, so the
          // declarations this change adds were not all seen.
          review: { maxFiles: 1 }
        }),
        baseRef: 'main',
        headRef: 'HEAD',
        generatedAt,
        readChangedFile: readChangedFile(root),
        runGit: scriptedGit({
          'merge-base main HEAD': `${mergeBaseSha}\n`,
          [`diff --name-status ${mergeBaseSha} HEAD`]:
            'M\tsrc/store.ts\nM\tsrc/caller.ts\nD\tsrc/legacy.ts\n',
          [`diff --unified=0 ${mergeBaseSha} HEAD -- src/store.ts src/legacy.ts`]:
            'diff --git a/src/store.ts b/src/store.ts\n' +
            '--- a/src/store.ts\n+++ b/src/store.ts\n@@ -1,1 +1,1 @@\n' +
            '-export const fetchUser = () => null\n' +
            '+export const fetchUser = (id: string) => id\n' +
            'diff --git a/src/legacy.ts b/src/legacy.ts\n' +
            'deleted file mode 100644\n--- a/src/legacy.ts\n+++ /dev/null\n' +
            '@@ -1,1 +0,0 @@\n-export const legacyApi = () => 1\n'
        })
      })
      const removed = report.changedSymbols.find(
        (symbol) => symbol.name === 'legacyApi'
      )

      // Absence of a replacement among declarations that were never read is not
      // evidence the symbol is gone. It is still reported as a removal — the safe
      // direction — but the reader can tell this one apart from a verified one.
      expect(removed?.changeKind).toBe('deleted')
      expect(removed?.removalPairing?.match).toBe('inconclusive')
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
      expect(report.changedSymbols).toEqual([])
      expect(report.warnings).toEqual([
        // States what was observed, not a cause. The old wording asserted
        // "unsupported language" whenever nothing was seeded, and that misdiagnosis
        // sent a real investigation after a language bug that did not exist: the
        // actual cause was changed lines falling outside every symbol's span.
        'No changed symbols were seeded from the changed files. Either the files are in a language the deterministic signal extractors do not cover, or none of the changed lines fall inside a symbol this engine can name.',
        // Adjudication is off in this config, and an off adjudicator says so
        // rather than letting an empty finding list read as "nothing relies".
        'Change-impact adjudication is disabled, so no dependent was checked against the part of the contract that changed. The lists below are references, not findings. Set changeImpact.adjudication.enabled to true to run it.'
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('the report schema carries no severity and no gate field', () => {
    // Spec 22's open decision, resolved: change-impact findings carry a
    // COMPATIBILITY CLASS, never spec 05's severity, and there is nothing to
    // block on. `impactFindings` is here as of schema 3.0 — a finding carries the
    // dependent, the line, the contract element and the consequence — but none of
    // the fields below may ever be, because each of them would turn evidence into
    // a verdict this capability is not entitled to reach.
    const shape = Object.keys(ChangeImpactReferenceReportSchema.shape)

    expect(shape).toEqual([
      'schemaVersion',
      'status',
      'adjudicationStatus',
      'generatedAt',
      'scope',
      'summary',
      'impactFindings',
      'changedSymbols',
      'impactedFiles',
      'impactedTestFiles',
      'warnings',
      'usage'
    ])
    for (const forbidden of ['severity', 'qualityGate', 'passed', 'blocking']) {
      expect(shape).not.toContain(forbidden)
    }
    expect(
      Object.keys(
        ChangeImpactReferenceReportSchema.shape.changedSymbols.element.shape
      )
    ).not.toContain('severity')
    // A finding rates COMPATIBILITY, not badness, and it names the dependent.
    const findingShape = Object.keys(
      ChangeImpactReferenceReportSchema.shape.impactFindings.element.shape
    )

    expect(findingShape).toContain('compatibilityClass')
    expect(findingShape).toContain('path')
    expect(findingShape).not.toContain('severity')
  })
})
