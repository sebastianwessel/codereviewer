import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  buildChangeImpactCase,
  changeImpactHydrationSource,
  diffHeaderPaths,
  gitForwardDiffArgs,
  hydrateChangeImpactCorpus,
  type ChangeImpactCaseResult
} from './change-impact-corpus-hydration.js'
import { ChangeImpactCorpusCaseSchema } from './change-impact-corpus.schema.js'
import type { CorpusGitCommandRunner } from '../corpus/real-repo-corpus-hydration.js'

const introducingCommit = 'a'.repeat(40)
const parentCommit = 'b'.repeat(40)
const manifestRelativePath = 'corpus/manifest.json'
const outputRoot = 'out'

const caseFixture = {
  id: 'moved-contract-breaks-caller',
  language: 'go',
  split: 'held-out',
  repositoryUrl: 'https://example.test/owner/repo.git',
  upstreamOwner: 'owner',
  upstreamRepo: 'repo',
  license: 'MIT',
  source: 'upstream-regression-mining',
  capturedAt: '2026-07-28',
  introducingCommit,
  introducingCommittedAt: '2026-02-01T10:00:00+00:00',
  parentCommit,
  reviewedPaths: ['pkg/service.go'],
  reviewIntent: 'Simplify the tenant lookup helper.',
  evidenceOfBreakage: [
    {
      kind: 'upstream-fix',
      commit: 'c'.repeat(40),
      committedAt: '2026-06-01',
      subject: 'Restore tenant scoping at the call site.',
      repairedPaths: ['pkg/caller.go'],
      quotes: [`Regression in ${introducingCommit}.`],
      linkVerification:
        'The full object name of the introducing commit is quoted verbatim in the evidence body.'
    }
  ],
  expectedImpact: [
    {
      path: 'pkg/caller.go',
      lineRange: [1, 2],
      reachability: 'caller-of-changed-symbol',
      compatibilityClass: 'breaks-at-runtime',
      severity: 'medium',
      severityRationale:
        'Signalled failure reachable only under a configured tenant scope.',
      semanticSummary:
        'The caller passes a tenant argument the helper no longer accepts, so the lookup runs unscoped and returns another tenant rows.'
    }
  ],
  localPlausibility: {
    verdict: 'plausible',
    rationale:
      'The diff removes a parameter that the function body no longer uses, which reads as a clean simplification from inside the change alone.'
  }
}

const manifestFixture = {
  schemaVersion: '1.0',
  datasetId: 'test-change-impact',
  modelTrainingCutoff: '2026-01-01',
  description: 'Test corpus.',
  cases: [caseFixture]
}

const forwardDiff = [
  'diff --git a/pkg/service.go b/pkg/service.go',
  '--- a/pkg/service.go',
  '+++ b/pkg/service.go',
  '@@ -1,3 +1,3 @@',
  ' package service',
  '-func lookup(id string, tenant string) *Row { return find(id, tenant) }',
  '+func lookup(id string) *Row { return find(id) }',
  ''
].join('\n')

const gitSubcommands = new Set([
  'init',
  'config',
  'remote',
  'fetch',
  'checkout',
  'diff',
  'rev-parse'
])

// The scripted checkout marker lives beside the work tree, in the separate git
// directory the real plumbing creates, so removing a case directory removes it.
const headMarkerFor = (workTreeDirectory: string): string =>
  path.join(workTreeDirectory, '..', 'git', 'SCRIPTED_HEAD')

type FakeGit = {
  readonly runGit: CorpusGitCommandRunner
  readonly calls: readonly (readonly string[])[]
}

// A scripted git: no network, and HEAD only resolves once a checkout landed, so
// the ordering the real plumbing depends on is preserved.
const createFakeGit = (
  options: {
    readonly upstreamParent?: string
    readonly diff?: string
    readonly dependentContents?: Readonly<Record<string, string>>
  } = {}
): FakeGit => {
  const calls: (readonly string[])[] = []
  const runGit: CorpusGitCommandRunner = async ({ args, cwd }) => {
    calls.push([...args])

    const subcommand = args.find((arg) => gitSubcommands.has(arg))

    if (subcommand === 'init') {
      await mkdir(args[args.indexOf('--separate-git-dir') + 1] ?? '', {
        recursive: true
      })
      return ''
    }

    if (subcommand === 'rev-parse') {
      if (args.includes('HEAD')) {
        // Mirror real git: HEAD resolves from the checkout on disk, not from
        // this process's memory, so a second run sees the previous one's work.
        if (!existsSync(headMarkerFor(cwd))) {
          throw new Error('not a git repository')
        }

        return `${await readFile(headMarkerFor(cwd), 'utf8')}\n`
      }

      return `${options.upstreamParent ?? parentCommit}\n`
    }

    if (subcommand === 'checkout') {
      await mkdir(path.dirname(headMarkerFor(cwd)), { recursive: true })
      await writeFile(headMarkerFor(cwd), introducingCommit)

      // A real checkout materialises the whole working tree, and the expected
      // dependents live in files the diff never touches; hydration reads them to
      // prove the answer key points at lines that exist.
      for (const [relativePath, contents] of Object.entries(
        options.dependentContents ?? { 'pkg/caller.go': 'package service\nrow := lookup(id, tenant)\n' }
      )) {
        const filePath = path.join(cwd, ...relativePath.split('/'))

        await mkdir(path.dirname(filePath), { recursive: true })
        await writeFile(filePath, contents)
      }

      return ''
    }

    if (subcommand === 'diff') {
      return options.diff ?? forwardDiff
    }

    return ''
  }

  return { runGit, calls }
}

let repositoryRoot: string

beforeEach(async () => {
  repositoryRoot = await mkdtemp(path.join(tmpdir(), 'change-impact-corpus-'))
  await mkdir(path.join(repositoryRoot, 'corpus'), { recursive: true })
  await writeFile(
    path.join(repositoryRoot, manifestRelativePath),
    JSON.stringify(manifestFixture)
  )
})

afterEach(async () => {
  await rm(repositoryRoot, { recursive: true, force: true })
})

const writeManifest = async (
  cases: readonly Record<string, unknown>[]
): Promise<void> => {
  await writeFile(
    path.join(repositoryRoot, manifestRelativePath),
    JSON.stringify({ ...manifestFixture, cases })
  )
}

const hydrate = (fakeGit: FakeGit) =>
  hydrateChangeImpactCorpus({
    repositoryRoot,
    manifestPath: manifestRelativePath,
    outputRoot,
    runGit: fakeGit.runGit
  })

const readHydratedCase = async (
  caseId: string
): Promise<Record<string, unknown>> =>
  JSON.parse(
    await readFile(
      path.join(repositoryRoot, outputRoot, caseId, 'case.json'),
      'utf8'
    )
  ) as Record<string, unknown>

describe('forward orientation', () => {
  // The whole point of a separate hydration path. Reversing this would score
  // every expected line range against bytes no reviewer ever saw.
  test('diffs the parent against the introducing commit, not the other way round', () => {
    expect(
      gitForwardDiffArgs({
        parentCommit,
        introducingCommit,
        reviewedPaths: ['pkg/service.go']
      })
    ).toEqual([
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--no-renames',
      parentCommit,
      introducingCommit,
      '--',
      'pkg/service.go'
    ])
  })

  test('checks out the introducing commit as the working tree', async () => {
    const fakeGit = createFakeGit()

    await hydrate(fakeGit)

    const checkout = fakeGit.calls.find((call) => call.includes('checkout'))

    expect(checkout?.at(-1)).toBe(introducingCommit)
  })

  test('records the parent as base and the introducing commit as head', async () => {
    await hydrate(createFakeGit())

    const hydrated = await readHydratedCase(caseFixture.id)

    expect(hydrated.baseSha).toBe(parentCommit)
    expect(hydrated.headSha).toBe(introducingCommit)
    expect(hydrated.hydratedSource).toBe(changeImpactHydrationSource)
  })
})

describe('diff path extraction', () => {
  // A pure-deletion change is the strongest change-impact case there is, and it
  // has no new-side content at all, so header parsing is what keeps it reviewable.
  test('reads both sides of every header, including a deletion', () => {
    expect(
      diffHeaderPaths(
        [
          'diff --git a/pkg/gone.go b/pkg/gone.go',
          'deleted file mode 100644',
          '--- a/pkg/gone.go',
          '+++ /dev/null',
          '@@ -1,2 +0,0 @@',
          '-package service',
          '-func helper() {}'
        ].join('\n')
      )
    ).toEqual(['pkg/gone.go'])
  })

  test('ignores a diff with no headers', () => {
    expect(diffHeaderPaths('')).toEqual([])
  })
})

describe('change-impact corpus hydration', () => {
  test('hydrates a case and reports its reachability denominator', async () => {
    const result = await hydrate(createFakeGit())

    expect(result.hydratedCaseCount).toBe(1)
    expect(result.expectedImpactCount).toBe(1)
    expect(result.expectedImpactByReachability).toEqual({
      'caller-of-changed-symbol': 1,
      'callee-of-changed-code': 0,
      'attribute-owner': 0,
      'whole-repo-search': 0
    })
  })

  test('reuses an intact checkout without refetching', async () => {
    await hydrate(createFakeGit())

    const second = createFakeGit()
    const result = await hydrate(second)

    expect(result.cachedCaseCount).toBe(1)
    expect(
      second.calls.some((call) => call.includes('fetch'))
    ).toBe(false)
  })

  // Spec 17 records what happens without this: a corpus silently scored against
  // a stale answer key, and a baseline that had to be voided.
  test('rebuilds a case whose manifest definition changed', async () => {
    await hydrate(createFakeGit())
    await writeManifest([
      {
        ...caseFixture,
        expectedImpact: [
          { ...caseFixture.expectedImpact[0], reachability: 'whole-repo-search' }
        ]
      }
    ])

    const result = await hydrate(createFakeGit())

    expect(result.repairedCaseCount).toBe(1)
    expect(result.expectedImpactByReachability['whole-repo-search']).toBe(1)
  })

  test('fails when upstream history no longer has the declared parent', async () => {
    await expect(
      hydrate(createFakeGit({ upstreamParent: 'd'.repeat(40) }))
    ).rejects.toThrow(/but the manifest declares/u)
  })

  test('fails when the reviewed diff touches an undeclared path', async () => {
    const diff = [
      forwardDiff,
      'diff --git a/pkg/other.go b/pkg/other.go',
      '--- a/pkg/other.go',
      '+++ b/pkg/other.go',
      '@@ -1,1 +1,1 @@',
      '-old',
      '+new',
      ''
    ].join('\n')

    await expect(hydrate(createFakeGit({ diff }))).rejects.toThrow(
      /touches undeclared path/u
    )
  })

  // Q ⊄ P on the diff a measurement actually scores, without a third check: an
  // expectation may not be a reviewed path, and a diff path must be one, so a
  // drifted reviewed-path set surfaces here rather than swallowing an expectation.
  test('fails when the diff drifts onto an expected dependent', async () => {
    const diff = [
      forwardDiff,
      'diff --git a/pkg/caller.go b/pkg/caller.go',
      '--- a/pkg/caller.go',
      '+++ b/pkg/caller.go',
      '@@ -1,1 +1,1 @@',
      '-old',
      '+new',
      ''
    ].join('\n')

    await expect(hydrate(createFakeGit({ diff }))).rejects.toThrow(
      /touches undeclared path\(s\) pkg\/caller\.go/u
    )
  })

  test('fails when an expected dependent is absent from the checkout', async () => {
    await expect(
      hydrate(createFakeGit({ dependentContents: {} }))
    ).rejects.toThrow(/does not exist at/u)
  })

  // A range that fell off the end of a file would score a correct prediction as
  // wrong forever, and nothing would say so.
  test('fails when the answer key points past the end of a dependent', async () => {
    await writeManifest([
      {
        ...caseFixture,
        expectedImpact: [
          { ...caseFixture.expectedImpact[0], lineRange: [40, 44] }
        ]
      }
    ])

    await expect(hydrate(createFakeGit())).rejects.toThrow(
      /the answer key points at 40-44/u
    )
  })

  test('fails when the reviewed diff names the defect', async () => {
    const diff = forwardDiff.replace(
      '+func lookup(id string) *Row { return find(id) }',
      '+// fixes the tenant isolation vulnerability\n+func lookup(id string) *Row { return find(id) }'
    )

    await expect(hydrate(createFakeGit({ diff }))).rejects.toThrow(
      /the answer key is inside the model's input/u
    )
  })

  test('fails when the reviewed diff removes an unjudged prose comment', async () => {
    const diff = forwardDiff.replace(
      '-func lookup(id string, tenant string) *Row { return find(id, tenant) }',
      '-// the lookup must always be scoped by the calling tenant here\n-func lookup(id string, tenant string) *Row { return find(id, tenant) }'
    )

    await expect(hydrate(createFakeGit({ diff }))).rejects.toThrow(
      /no curator has judged/u
    )
  })

  test('prunes a checkout whose case the manifest no longer defines', async () => {
    await hydrate(createFakeGit())
    await writeManifest([{ ...caseFixture, id: 'renamed-case' }])

    const result = await hydrate(createFakeGit())

    expect(result.prunedCaseIds).toEqual([caseFixture.id])
  })
})

describe('hydrated case artefact', () => {
  test('carries the evidence and the expectations, not an eval slice shape', () => {
    const built = buildChangeImpactCase({
      corpusCase: ChangeImpactCorpusCaseSchema.parse(caseFixture),
      datasetId: 'test-change-impact',
      diff: forwardDiff,
      changedFiles: ['pkg/service.go']
    })

    expect(built).toMatchObject({
      id: caseFixture.id,
      baseSha: parentCommit,
      headSha: introducingCommit
    })
    expect(built.expectedImpact).toBeDefined()
    // Naming it `expectedFindings` would let the diff-review scorer load this
    // case set and answer a different question while looking like a result.
    expect(built.expectedFindings).toBeUndefined()
    expect(built.tags).toContain('forward-diff')
  })

})

describe('hydration result shape', () => {
  test('names every case it touched', async () => {
    const result = await hydrate(createFakeGit())
    const ids = result.cases.map((entry: ChangeImpactCaseResult) => entry.id)

    expect(ids).toEqual([caseFixture.id])
  })
})
