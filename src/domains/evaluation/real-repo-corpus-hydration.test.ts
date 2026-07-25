import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { loadEvalSliceCasesFromRoot } from './eval-fixture-loader.js'
import {
  buildRealRepoSlice,
  diffPathsOutsideReviewedSet,
  gitCheckoutArgs,
  gitFetchArgs,
  gitInitArgs,
  gitReviewedDiffArgs,
  hydrateRealRepoCorpus,
  pruneUnknownCaseDirectories,
  realRepoHydrationSource,
  resolveCaseHydrationState,
  type CorpusGitCommandRunner
} from './real-repo-corpus-hydration.js'
import {
  parseRealRepoCorpusManifest,
  type RealRepoCorpusCase
} from './real-repo-corpus.schema.js'

const fixCommit = 'a'.repeat(40)
const parentCommit = 'b'.repeat(40)
const manifestRelativePath = 'corpus/manifest.json'
const outputSliceRoot = 'out'

const manifestFixture = {
  schemaVersion: '1.0',
  datasetId: 'test-corpus',
  modelTrainingCutoff: '2026-01-01',
  description: 'Test corpus.',
  cases: [
    {
      id: 'tenant-lookup-case',
      language: 'go',
      split: 'held-out',
      repositoryUrl: 'https://example.test/owner/repo.git',
      upstreamOwner: 'owner',
      upstreamRepo: 'repo',
      license: 'MIT',
      source: 'upstream-fix-commit',
      capturedAt: '2026-07-25',
      fixCommit,
      fixCommittedAt: '2026-06-01T10:00:00+00:00',
      parentCommit,
      reviewedPaths: ['pkg/service.go'],
      reviewIntent: 'Simplify the tenant lookup helper',
      expectedFindings: [
        {
          category: 'bug',
          severity: 'medium',
          path: 'pkg/service.go',
          matchMode: 'path-semantic',
          semanticSummary: 'The helper no longer scopes the lookup by tenant.'
        }
      ],
      tags: ['cross-file']
    }
  ]
}

const reviewedDiff = [
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

type FakeGit = {
  readonly runGit: CorpusGitCommandRunner
  readonly calls: readonly (readonly string[])[]
}

// A scripted git that never touches the network but preserves the ordering the
// real plumbing depends on: HEAD only resolves after a checkout landed.
const createFakeGit = (
  options: {
    readonly upstreamParent?: string
    readonly diff?: string
  } = {}
): FakeGit => {
  const checkedOutWorkTrees = new Set<string>()
  const calls: (readonly string[])[] = []
  const runGit: CorpusGitCommandRunner = async ({ args, cwd }) => {
    calls.push([...args])

    const subcommand = args.find((arg) => gitSubcommands.has(arg))

    if (subcommand === 'rev-parse') {
      if (args.includes('HEAD')) {
        // Mirror real git: a removed or never-initialised work tree has no HEAD.
        if (!checkedOutWorkTrees.has(cwd) || !existsSync(cwd)) {
          throw new Error('not a git repository')
        }

        return `${parentCommit}\n`
      }

      return `${options.upstreamParent ?? parentCommit}\n`
    }

    if (subcommand === 'checkout') {
      checkedOutWorkTrees.add(cwd)
      return ''
    }

    if (subcommand === 'diff') {
      return options.diff ?? reviewedDiff
    }

    return ''
  }

  return { runGit, calls }
}

let repositoryRoot: string

beforeEach(async () => {
  repositoryRoot = await mkdtemp(path.join(tmpdir(), 'real-repo-corpus-'))
  await mkdir(path.join(repositoryRoot, 'corpus'), { recursive: true })
  await writeFile(
    path.join(repositoryRoot, manifestRelativePath),
    JSON.stringify(manifestFixture)
  )
})

afterEach(async () => {
  await rm(repositoryRoot, { recursive: true, force: true })
})

const hydrate = (
  fakeGit: FakeGit,
  overrides: { readonly force?: boolean; readonly caseFilters?: readonly string[] } = {}
) =>
  hydrateRealRepoCorpus({
    repositoryRoot,
    manifestPath: manifestRelativePath,
    outputSliceRoot,
    runGit: fakeGit.runGit,
    ...overrides
  })

const readHydratedSlice = async (
  caseId: string
): Promise<Record<string, unknown>> =>
  JSON.parse(
    await readFile(
      path.join(repositoryRoot, outputSliceRoot, caseId, 'slice.json'),
      'utf8'
    )
  ) as Record<string, unknown>

describe('real repository git plumbing arguments', () => {
  test('keeps the git directory out of the reviewed working tree', () => {
    expect(
      gitInitArgs({ gitDirectory: '/tmp/case/git', workTreeDirectory: '/tmp/case/repo' })
    ).toEqual([
      '-c',
      'init.defaultBranch=main',
      'init',
      '--quiet',
      '--separate-git-dir',
      '/tmp/case/git',
      '/tmp/case/repo'
    ])
  })

  test('fetches only the fix commit and its parent', () => {
    expect(gitFetchArgs({ fixCommit })).toEqual([
      'fetch',
      '--quiet',
      '--no-tags',
      '--depth',
      '2',
      'origin',
      fixCommit
    ])
  })

  test('checks out the pre-fix parent as a detached head', () => {
    expect(gitCheckoutArgs(parentCommit)).toContain('--detach')
    expect(gitCheckoutArgs(parentCommit)).toContain(parentCommit)
  })

  test('diffs from the fixed tree to the pre-fix tree, restricted to reviewed paths', () => {
    expect(
      gitReviewedDiffArgs({
        fixCommit,
        parentCommit,
        reviewedPaths: ['pkg/service.go']
      })
    ).toEqual([
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--no-renames',
      fixCommit,
      parentCommit,
      '--',
      'pkg/service.go'
    ])
  })
})

describe('case hydration state', () => {
  test('reports an absent case when neither checkout nor slice exists', () => {
    expect(
      resolveCaseHydrationState({
        headCommit: undefined,
        expectedParentCommit: parentCommit,
        sliceDiff: undefined
      })
    ).toBe('absent')
  })

  test('reports a hydrated case only when head and diff both agree', () => {
    expect(
      resolveCaseHydrationState({
        headCommit: parentCommit,
        expectedParentCommit: parentCommit,
        sliceDiff: reviewedDiff
      })
    ).toBe('hydrated')
  })

  test('reports a stale case on a commit mismatch or an empty diff', () => {
    expect(
      resolveCaseHydrationState({
        headCommit: 'c'.repeat(40),
        expectedParentCommit: parentCommit,
        sliceDiff: reviewedDiff
      })
    ).toBe('stale')
    expect(
      resolveCaseHydrationState({
        headCommit: parentCommit,
        expectedParentCommit: parentCommit,
        sliceDiff: ''
      })
    ).toBe('stale')
  })
})

describe('reviewed path containment', () => {
  test('lists diff paths that the manifest never declared', () => {
    expect(
      diffPathsOutsideReviewedSet({
        diffPaths: ['pkg/service.go', 'pkg/service_test.go'],
        reviewedPaths: ['pkg/service.go']
      })
    ).toEqual(['pkg/service_test.go'])
  })
})

describe('slice construction', () => {
  test('emits a loadable slice whose base is the fix and whose head is the parent', () => {
    const corpusCase = parseRealRepoCorpusManifest(manifestFixture)
      .cases[0] as RealRepoCorpusCase
    const slice = buildRealRepoSlice({
      corpusCase,
      datasetId: 'test-corpus',
      diff: reviewedDiff,
      changedFiles: ['pkg/service.go']
    })

    expect(slice.baseSha).toBe(fixCommit)
    expect(slice.headSha).toBe(parentCommit)
    expect(slice.hydratedSource).toBe(realRepoHydrationSource)
    expect(slice.tags).toEqual(
      expect.arrayContaining(['cross-file', 'real-repo-corpus', 'full-checkout', 'held-out'])
    )
  })
})

describe('real repository corpus hydration', () => {
  test('hydrates a case into an eval-loadable slice root', async () => {
    const fakeGit = createFakeGit()
    const result = await hydrate(fakeGit)

    expect(result.hydratedCaseCount).toBe(1)
    expect(result.cachedCaseCount).toBe(0)
    expect(result.reviewedFileCount).toBe(1)

    const cases = await loadEvalSliceCasesFromRoot(
      repositoryRoot,
      outputSliceRoot
    )

    expect(cases).toHaveLength(1)
    expect(cases[0]?.changedFiles).toEqual(['pkg/service.go'])
    expect(cases[0]?.repositoryFixture).toBe('out/tenant-lookup-case/repo')
    expect(cases[0]?.diff).toContain('func lookup(id string) *Row')
  })

  test('re-running reuses an intact checkout instead of refetching', async () => {
    const fakeGit = createFakeGit()

    await hydrate(fakeGit)

    const second = await hydrate(fakeGit)

    expect(second.cachedCaseCount).toBe(1)
    expect(second.hydratedCaseCount).toBe(0)
    expect(
      fakeGit.calls.filter((call) => call.includes('fetch'))
    ).toHaveLength(1)
  })

  test('repairs a case whose slice lost its reviewed diff', async () => {
    const fakeGit = createFakeGit()

    await hydrate(fakeGit)

    const slicePath = path.join(
      repositoryRoot,
      outputSliceRoot,
      'tenant-lookup-case',
      'slice.json'
    )

    await writeFile(
      slicePath,
      JSON.stringify({ ...(await readHydratedSlice('tenant-lookup-case')), diff: '' })
    )

    const repaired = await hydrate(fakeGit)

    expect(repaired.repairedCaseCount).toBe(1)
    expect(repaired.cases[0]?.state).toBe('repaired')
    expect((await readHydratedSlice('tenant-lookup-case')).diff).toContain(
      'func lookup(id string) *Row'
    )
  })

  test('refuses a manifest whose declared parent is not the upstream parent', async () => {
    const fakeGit = createFakeGit({ upstreamParent: 'c'.repeat(40) })

    await expect(hydrate(fakeGit)).rejects.toThrow(
      /upstream parent of .* but the manifest declares/u
    )
  })

  test('refuses a reviewed diff that reaches an undeclared path', async () => {
    const fakeGit = createFakeGit({
      diff: [
        reviewedDiff,
        'diff --git a/pkg/service_test.go b/pkg/service_test.go',
        '--- a/pkg/service_test.go',
        '+++ b/pkg/service_test.go',
        '@@ -1,1 +1,1 @@',
        '+package service',
        ''
      ].join('\n')
    })

    await expect(hydrate(fakeGit)).rejects.toThrow(/undeclared path/u)
  })

  test('rejects an unknown case filter before any git call', async () => {
    const fakeGit = createFakeGit()

    await expect(hydrate(fakeGit, { caseFilters: ['missing'] })).rejects.toThrow(
      /Unknown corpus case filter/u
    )
    expect(fakeGit.calls).toHaveLength(0)
  })

  test('force discards an existing checkout and hydrates again', async () => {
    const fakeGit = createFakeGit()

    await hydrate(fakeGit)

    const forced = await hydrate(fakeGit, { force: true })

    expect(forced.hydratedCaseCount).toBe(1)
    expect(forced.cachedCaseCount).toBe(0)
  })
})

describe('pruneUnknownCaseDirectories', () => {
  test('removes checkouts the manifest no longer defines and reports them', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'corpus-prune-'))
    await mkdir(path.join(root, 'kept-case'), { recursive: true })
    await mkdir(path.join(root, 'dropped-case', 'repo'), { recursive: true })
    await writeFile(path.join(root, 'dropped-case', 'slice.json'), '{}', 'utf8')

    const pruned = await pruneUnknownCaseDirectories(
      root,
      new Set(['kept-case'])
    )

    // A dropped case's checkout must not survive: an eval loads a slice root by
    // directory, so a leftover would silently re-enter the next measurement.
    expect(pruned).toEqual(['dropped-case'])
    const remaining = await readdir(root)
    expect(remaining).toEqual(['kept-case'])
  })
})
