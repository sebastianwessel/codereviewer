import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { AdmittedFinding } from '../../../shared/contracts/index.js'
import { loadEvalSliceCasesFromRoot } from './eval-fixture-loader.js'
import { matchEvalFindings } from '../judging/eval-matcher.js'
import {
  buildRealRepoSlice,
  diffPathsOutsideReviewedSet,
  gitReviewedDiffArgs,
  hydrateRealRepoCorpus,
  realRepoHydrationSource
} from './real-repo-corpus-hydration.js'
import {
  gitCheckoutArgs,
  gitFetchArgs,
  gitInitArgs,
  type CorpusGitCommandRunner
} from './git-corpus-plumbing.js'
import {
  pruneUnknownCaseDirectories,
  resolveCaseHydrationState
} from './git-corpus-hydration.js'
import {
  answerKeyLeakIn,
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
  splitIntegrity: {
    status: 'single-split',
    contaminationNote:
      'Every case here is held-out and there is no dev set, so the chronological rule compares nothing. Read every figure from this corpus as a dev-set figure that does not satisfy the held-out criterion.'
  },
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
    readonly failFetchTimes?: number
  } = {}
): FakeGit => {
  const checkedOutWorkTrees = new Set<string>()
  const workTreesWithOrigin = new Set<string>()
  const calls: (readonly string[])[] = []
  let remainingFetchFailures = options.failFetchTimes ?? 0
  const runGit: CorpusGitCommandRunner = async ({ args, cwd }) => {
    calls.push([...args])

    const subcommand = args.find((arg) => gitSubcommands.has(arg))

    if (subcommand === 'init') {
      const gitDirectory = args[args.indexOf('--separate-git-dir') + 1] ?? ''
      const workTreeDirectory = args[args.length - 1] ?? ''

      // `git init` is idempotent, so re-initialising an existing repository
      // keeps its remotes and HEAD. Only a git directory that is genuinely
      // gone yields a fresh repository.
      if (!existsSync(gitDirectory)) {
        workTreesWithOrigin.delete(workTreeDirectory)
        checkedOutWorkTrees.delete(workTreeDirectory)
      }

      await mkdir(gitDirectory, { recursive: true })
      return ''
    }

    if (subcommand === 'remote' && args.includes('add')) {
      // Mirror real git: unlike `init`, `remote add` is NOT idempotent.
      if (workTreesWithOrigin.has(cwd)) {
        throw new Error(
          'Command failed: git remote add origin\nerror: remote origin already exists.'
        )
      }

      workTreesWithOrigin.add(cwd)
      return ''
    }

    if (subcommand === 'fetch' && remainingFetchFailures > 0) {
      remainingFetchFailures -= 1
      throw new Error('Command failed: git fetch\nfatal: unable to access remote')
    }

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
    expect(gitFetchArgs({ commit: fixCommit })).toEqual([
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
        expectedCheckoutCommit: parentCommit,
        sliceDiff: undefined,
        sliceMatchesCaseDefinition: false
      })
    ).toBe('absent')
  })

  test('reports a hydrated case only when head and diff both agree', () => {
    expect(
      resolveCaseHydrationState({
        headCommit: parentCommit,
        expectedCheckoutCommit: parentCommit,
        sliceDiff: reviewedDiff,
        sliceMatchesCaseDefinition: true
      })
    ).toBe('hydrated')
  })

  test('reports a stale case on a commit mismatch or an empty diff', () => {
    expect(
      resolveCaseHydrationState({
        headCommit: 'c'.repeat(40),
        expectedCheckoutCommit: parentCommit,
        sliceDiff: reviewedDiff,
        sliceMatchesCaseDefinition: true
      })
    ).toBe('stale')
    expect(
      resolveCaseHydrationState({
        headCommit: parentCommit,
        expectedCheckoutCommit: parentCommit,
        sliceDiff: '',
        sliceMatchesCaseDefinition: true
      })
    ).toBe('stale')
  })

  test('reports a stale case when the slice no longer matches its definition', () => {
    expect(
      resolveCaseHydrationState({
        headCommit: parentCommit,
        expectedCheckoutCommit: parentCommit,
        sliceDiff: reviewedDiff,
        sliceMatchesCaseDefinition: false
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

  // An interrupted hydration leaves a case directory that has a git directory
  // and an `origin` remote but no resolvable HEAD and no slice, so it reads as
  // absent rather than stale. Re-running must rebuild it instead of failing on
  // the non-idempotent `git remote add`.
  test('rebuilds a case left behind by an interrupted hydration', async () => {
    const fakeGit = createFakeGit({ failFetchTimes: 1 })

    await expect(hydrate(fakeGit)).rejects.toThrow(/unable to access remote/)

    const caseDirectory = path.join(
      repositoryRoot,
      outputSliceRoot,
      'tenant-lookup-case'
    )

    expect(existsSync(path.join(caseDirectory, 'repo'))).toBe(true)
    expect(existsSync(path.join(caseDirectory, 'slice.json'))).toBe(false)

    const second = await hydrate(fakeGit)

    expect(second.hydratedCaseCount).toBe(1)

    const cases = await loadEvalSliceCasesFromRoot(
      repositoryRoot,
      outputSliceRoot
    )

    expect(cases).toHaveLength(1)
    expect(cases[0]?.diff).toContain('func lookup(id string) *Row')
  })

  // A curator who adds an expected finding to an existing case must see it in
  // the next measurement. Reusing the slice on checkout integrity alone scores
  // the run against the answer key the slice was built with, not the one the
  // manifest now declares.
  test('rebuilds a cached case whose manifest definition changed', async () => {
    const fakeGit = createFakeGit()

    await hydrate(fakeGit)
    expect(
      (await readHydratedSlice('tenant-lookup-case')).expectedFindings
    ).toHaveLength(1)

    const [baseCase] = manifestFixture.cases
    const extendedCase = {
      ...baseCase,
      expectedFindings: [
        ...(baseCase?.expectedFindings ?? []),
        {
          category: 'bug',
          severity: 'high',
          path: 'pkg/service.go',
          matchMode: 'path-semantic',
          semanticSummary: 'The caller now passes an unscoped identifier.'
        }
      ]
    }

    await writeFile(
      path.join(repositoryRoot, manifestRelativePath),
      JSON.stringify({ ...manifestFixture, cases: [extendedCase] })
    )

    const second = await hydrate(fakeGit)

    expect(second.cachedCaseCount).toBe(0)
    expect(second.repairedCaseCount).toBe(1)
    expect(
      (await readHydratedSlice('tenant-lookup-case')).expectedFindings
    ).toHaveLength(2)
  })

  test('forcing a filtered run keeps the checkouts it does not rebuild', async () => {
    const fakeGit = createFakeGit()

    await hydrate(fakeGit)

    const untouched = path.join(repositoryRoot, outputSliceRoot, 'other-case')

    await mkdir(untouched, { recursive: true })
    await writeFile(path.join(untouched, 'marker'), 'keep')

    await hydrate(fakeGit, {
      force: true,
      caseFilters: ['tenant-lookup-case']
    })

    expect(existsSync(path.join(untouched, 'marker'))).toBe(true)
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

// `noFindingZoneFalsePositiveCount` is only worth reporting if a zone declared
// in the corpus manifest actually reaches the matcher. The chain is manifest ->
// buildRealRepoSlice -> slice.json -> loadEvalSliceCasesFromRoot -> matcher, and
// every link is silent about a zone it drops, so it is asserted end to end here
// rather than at any single hop.
describe('no-finding zones declared in the corpus manifest', () => {
  const zonedCase = {
    ...manifestFixture.cases[0],
    expectedNoFindingZones: [
      {
        path: 'pkg/service.go',
        lineRange: [40, 50],
        reason: 'Unchanged formatting helpers; nothing here is under review.'
      }
    ]
  }

  const zonedFinding = (
    id: string,
    startLine: number
  ): AdmittedFinding =>
    ({
      id,
      taskId: `task_${id}`,
      category: 'bug',
      severity: 'medium',
      title: 'Reported defect',
      description: 'A finding produced by the reviewer under measurement.',
      location: { path: 'pkg/service.go', startLine, side: 'new' },
      evidenceIds: [`ev_${id}`],
      proposedBy: 'scripted-reviewer',
      admissionStatus: 'admitted',
      admittedAt: '2026-07-26T00:00:00.000Z',
      admissionEvidenceIds: [`ev_${id}`],
      reporterEligibility: 'inline',
      provenance: {
        reviewer: 'scripted-reviewer',
        instructionHashes: [],
        skillHashes: [],
        signalVersions: {},
        configHash: '1'.repeat(64)
      },
      baselineStatus: 'new',
      fingerprints: [{ algorithm: 'test', value: id }]
    }) as unknown as AdmittedFinding

  test('carries a zone through hydration and counts only the finding inside it', async () => {
    await writeFile(
      path.join(repositoryRoot, manifestRelativePath),
      JSON.stringify({ ...manifestFixture, cases: [zonedCase] })
    )

    await hydrate(createFakeGit())

    const cases = await loadEvalSliceCasesFromRoot(
      repositoryRoot,
      outputSliceRoot
    )
    const evalCase = cases[0]

    expect(evalCase?.expectedNoFindingZones).toEqual(
      zonedCase.expectedNoFindingZones
    )

    const result = await matchEvalFindings({
      evalCase: evalCase as Parameters<typeof matchEvalFindings>[0]['evalCase'],
      admittedFindings: [
        zonedFinding('find_inside_zone', 44),
        zonedFinding('find_outside_zone', 8)
      ],
      judge: async () => ({
        match: false,
        reason: 'Describes something other than the expected defect.'
      })
    })

    // Both findings are false positives; only the one landing in the declared
    // clean region is a no-finding-zone hit.
    expect(result.falsePositiveFindingIds).toEqual([
      'find_inside_zone',
      'find_outside_zone'
    ])
    expect(result.noFindingZoneFalsePositiveIds).toEqual(['find_inside_zone'])
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

describe('answer-key leakage in the reviewed diff', () => {
  test('rejects a case whose generated diff names the defect', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'corpus-leak-'))
    // An upstream fix that also added an advisory reference: diffing the fix
    // backwards puts that text into the reviewed input, handing the model the
    // answer. The manifest is clean, so only a check on the DIFF catches this.
    const leakingDiff = [
      'diff --git a/lib/handler.js b/lib/handler.js',
      '--- a/lib/handler.js',
      '+++ b/lib/handler.js',
      '@@ -1,3 +1,3 @@',
      '-// fixes GHSA-xxxx-yyyy-zzzz: reject encoded separators',
      '+const value = decode(input)',
      ' export const handler = () => value'
    ].join('\n')

    await expect(
      hydrateRealRepoCorpus({
        repositoryRoot: root,
        manifestPath: 'manifest.json',
        outputSliceRoot: 'out',
        runGit: async () => leakingDiff
      } as unknown as Parameters<typeof hydrateRealRepoCorpus>[0])
    ).rejects.toThrow()
  })

  test('answerKeyLeakIn reports the leaked text and passes clean content', () => {
    expect(
      answerKeyLeakIn('const x = 1 // fixes CVE-2024-1234 in the parser')
    ).toContain('CVE-2024-1234')
    expect(answerKeyLeakIn('const x = decode(input)')).toBeUndefined()
  })
})

// The reviewed diff is the upstream fix read backwards, so a comment the fix
// ADDED is a REMOVED line here. Advisory wording is not how an engineer writes
// such a comment, so the advisory scan above cannot see it; the rule that can is
// fuzzy, which is why a flagged comment must be resolved by a curator in the
// manifest rather than excused by the rule.
describe('removed comment disclosure in the reviewed diff', () => {
  const disclosingComment =
    '// No `g` flag: the same regex is reused for every route below.'
  const copyrightHeader =
    '* Copyright 2014-2026 JetBrains s.r.o and contributors. Use of this source code is governed by the Apache 2.0 license.'

  const diffRemoving = (comment: string): string =>
    [
      'diff --git a/pkg/service.go b/pkg/service.go',
      '--- a/pkg/service.go',
      '+++ b/pkg/service.go',
      '@@ -1,4 +1,3 @@',
      ' package service',
      `-${comment}`,
      '-func lookup(id string, tenant string) *Row { return find(id, tenant) }',
      '+func lookup(id string) *Row { return find(id) }',
      ''
    ].join('\n')

  const writeManifest = async (
    caseOverrides: Record<string, unknown>
  ): Promise<void> => {
    await writeFile(
      path.join(repositoryRoot, manifestRelativePath),
      JSON.stringify({
        ...manifestFixture,
        cases: [{ ...manifestFixture.cases[0], ...caseOverrides }]
      })
    )
  }

  test('fails a case whose removed prose comment nobody has judged', async () => {
    await writeManifest({})

    await expect(
      hydrate(createFakeGit({ diff: diffRemoving(disclosingComment) }))
    ).rejects.toThrow(/no curator has judged/u)
  })

  // The rule flags a licence header exactly as it flags a disclosure: it cannot
  // tell them apart, and pretending otherwise is what would let a real
  // disclosure through. Recording the judgement is what makes hydration quiet.
  test('hydrates a case whose flagged comment a curator resolved as non-disclosing', async () => {
    await writeManifest({
      removedCommentDisclosureReview: {
        reviewedAt: '2026-07-27',
        verdict: 'non-disclosing',
        rationale:
          'A licence header whose copyright year the fix commit bumped. It names no code and no behaviour, so it cannot give the expectation away.',
        acknowledgedComments: [copyrightHeader]
      }
    })

    const result = await hydrate(
      createFakeGit({ diff: diffRemoving(copyrightHeader) })
    )

    expect(result.hydratedCaseCount).toBe(1)
  })

  test('refuses a resolution that does not cover every flagged comment', async () => {
    await writeManifest({
      removedCommentDisclosureReview: {
        reviewedAt: '2026-07-27',
        verdict: 'non-disclosing',
        rationale:
          'A licence header whose copyright year the fix commit bumped. It names no code and no behaviour, so it cannot give the expectation away.',
        acknowledgedComments: [copyrightHeader]
      }
    })

    await expect(
      hydrate(createFakeGit({ diff: diffRemoving(disclosingComment) }))
    ).rejects.toThrow(/no curator has judged/u)
  })

  test('refuses an acknowledgement the reviewed diff no longer removes', async () => {
    await writeManifest({
      removedCommentDisclosureReview: {
        reviewedAt: '2026-07-27',
        verdict: 'non-disclosing',
        rationale:
          'A licence header whose copyright year the fix commit bumped. It names no code and no behaviour, so it cannot give the expectation away.',
        acknowledgedComments: [copyrightHeader]
      }
    })

    await expect(hydrate(createFakeGit())).rejects.toThrow(
      /no longer removes/u
    )
  })

  // A slice hydrated before this rule existed is served from cache, and the
  // resolution is not part of the slice, so editing the manifest does not
  // invalidate it either. Checking only on rebuild would let exactly the cases
  // this rule exists for keep scoring.
  test('re-checks a cached slice instead of trusting the checkout', async () => {
    await writeManifest({
      removedCommentDisclosureReview: {
        reviewedAt: '2026-07-27',
        verdict: 'non-disclosing',
        rationale:
          'Placeholder resolution used only to get the leaking slice onto disk for this test.',
        acknowledgedComments: [disclosingComment]
      }
    })

    const fakeGit = createFakeGit({ diff: diffRemoving(disclosingComment) })

    expect((await hydrate(fakeGit)).hydratedCaseCount).toBe(1)

    // The curator withdraws the resolution; the checkout and the slice are still
    // intact, so the case would otherwise be reused as cached.
    await writeManifest({})

    await expect(hydrate(fakeGit)).rejects.toThrow(/no curator has judged/u)
  })
})
