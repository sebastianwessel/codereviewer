// Fixture builders shared by the change-impact scoring, report, rendering and
// per-case-runner suites, and by the CLI test that drives `eval impact`. Nothing
// at runtime imports this; `tsconfig.build.json` excludes it by path.
//
// WHY IT IS NOT IN `shared/testing/`. That is where a cross-domain test fixture
// normally goes, and `report-fixture.ts` went there. This one cannot: it is
// typed in terms of `domains/change-impact`'s `ChangeImpactReferenceReport`, and
// spec 01 forbids `shared` importing from `domains` outright. Putting it on the
// `evaluation` barrel instead would be worse — a test-only module on a runtime
// entrypoint that `src/cli/` and the hydration scripts import. So
// `cli/eval-impact-command.test.ts` imports this path directly, and that is
// deliberate: `src/cli/` is the composition root, not a sibling domain, so "no
// domain imports sibling internals" is not the rule being bent.
//
// The builders take the few fields a scoring test actually varies — the answer
// key, the reference list, the finding list, the adjudication status — and fill
// everything else with values that satisfy the real contracts, so a test states
// only what it is about.

import type { ChangeImpactReferenceReport } from '../../change-impact/index.js'
import type { CorpusSplit } from '../corpus/real-repo-corpus.schema.js'
import type {
  ChangeImpactCorpusCase,
  ImpactReachability
} from './change-impact-corpus.schema.js'

export type ExpectedDependentFixture = {
  readonly path: string
  readonly reachability: ImpactReachability
}

export const corpusCaseFixture = (input: {
  readonly id: string
  readonly split?: CorpusSplit
  readonly language?: string
  readonly reviewedPaths?: readonly string[]
  readonly excludedPaths?: readonly string[]
  readonly expected: readonly ExpectedDependentFixture[]
  // Real object names, for the suites that hydrate an actual checkout. The
  // placeholders below are fine for a pure scoring test, which never resolves a
  // ref.
  readonly introducingCommit?: string
  readonly parentCommit?: string
}): ChangeImpactCorpusCase => ({
  id: input.id,
  language: input.language ?? 'python',
  split: input.split ?? 'dev',
  repositoryUrl: 'https://github.com/example/project.git',
  upstreamOwner: 'example',
  upstreamRepo: 'project',
  license: 'BSD-3-Clause',
  source: 'upstream-regression-mining',
  capturedAt: '2026-08-06',
  introducingCommit: input.introducingCommit ?? 'a'.repeat(40),
  introducingCommittedAt: '2026-03-01T10:00:00+00:00',
  parentCommit: input.parentCommit ?? 'b'.repeat(40),
  reviewedPaths: [...(input.reviewedPaths ?? ['src/changed.py'])],
  excludedPaths: [...(input.excludedPaths ?? [])],
  ...(input.excludedPaths === undefined || input.excludedPaths.length === 0
    ? {}
    : { excludedPathsReason: 'Tests only; they state the moved contract.' }),
  reviewIntent: 'Move a helper and change what it returns when the input is empty.',
  evidenceOfBreakage: [
    {
      kind: 'upstream-fix',
      commit: 'c'.repeat(40),
      committedAt: '2026-05-01',
      subject: 'Fix the regression introduced upstream',
      repairedPaths: input.expected.map((expected) => expected.path),
      quotes: [
        'Regression in the earlier change. The caller stopped receiving a value.'
      ],
      linkVerification:
        'The fix body names the introducing commit by its full object name.'
    }
  ],
  expectedImpact: input.expected.map((expected) => ({
    path: expected.path,
    lineRange: [10, 12] as const,
    reachability: expected.reachability,
    compatibilityClass: 'breaks-at-runtime' as const,
    semanticSummary:
      'The dependent reads the value the changed helper no longer guarantees, and now dereferences nothing.',
    severity: 'medium' as const,
    severityRationale:
      'Descriptive only; spec 22 makes severity metadata rather than a scoring input.'
  })),
  localPlausibility: {
    verdict: 'plausible',
    rationale:
      'Read alone the diff is a clean refactor. The defect is only that the set of call sites is larger than the set the diff touches.'
  },
  tags: []
})

const impactedFile = (input: {
  readonly path: string
}): ChangeImpactReferenceReport['impactedFiles'][number] => ({
  path: input.path,
  symbols: [
    {
      name: 'changedHelper',
      definitionPath: 'src/changed.py',
      definitionLine: 4,
      sites: [{ line: 11, text: 'value = changed_helper(row)' }]
    }
  ]
})

const impactFinding = (input: {
  readonly path: string
}): ChangeImpactReferenceReport['impactFindings'][number] => ({
  id: `finding-${input.path}`,
  path: input.path,
  destination: 'production',
  compatibilityClass: 'breaks-at-runtime',
  reliances: [
    {
      symbolName: 'changedHelper',
      definitionPath: 'src/changed.py',
      definitionLine: 4,
      line: 11,
      contractElement: 'changedHelper may now return nothing for an empty input',
      consequence: 'This call site dereferences the result without a guard.',
      adjudicatedBy: 'model'
    }
  ]
})

export const impactReportFixture = (input: {
  readonly referenceFiles?: readonly string[]
  readonly referenceTestFiles?: readonly string[]
  readonly findingFiles?: readonly string[]
  readonly adjudicationStatus?: ChangeImpactReferenceReport['adjudicationStatus']
  readonly status?: ChangeImpactReferenceReport['status']
  // Pairs no adjudicator settled — a failed call, an undecided answer, or the
  // call cap. Non-zero makes the run partial rather than exhaustive.
  readonly unadjudicatedPairCount?: number
  readonly adjudicationCallsTruncated?: boolean
  // THE TIER THAT ANSWERED. By default every pair is model-answered, which is the
  // ordinary shape of an adjudicated run. Set this to make the deterministic tier
  // the one that settled the pairs — and with it, `adjudicationCallCount` to 0 —
  // to reproduce the shape of the run spec 22 voided.
  readonly deterministicNoImpactPairCount?: number
  readonly adjudicationCallCount?: number
}): ChangeImpactReferenceReport => {
  const referenceFiles = input.referenceFiles ?? []
  const referenceTestFiles = input.referenceTestFiles ?? []
  const findingFiles = input.findingFiles ?? []
  const pairCount = referenceFiles.length + referenceTestFiles.length
  const deterministicNoImpactPairCount = input.deterministicNoImpactPairCount ?? 0
  // Whatever the deterministic tier did not settle and did not become a finding
  // was answered by the model, so the default report is one in which the judge
  // actually ran on the residue.
  const modelNoImpactPairCount = Math.max(
    pairCount - deterministicNoImpactPairCount - findingFiles.length,
    0
  )
  // A run that spent no call has no verdicts, whatever else it reported. Derived
  // rather than accepted as a parameter, so a fixture cannot state a shape the
  // engine could not produce.
  const noCallsWereSpent = input.adjudicationCallCount === 0
  const modelVerdictCounts = {
    relies: noCallsWereSpent ? 0 : findingFiles.length,
    'does-not-rely': noCallsWereSpent ? 0 : modelNoImpactPairCount,
    undetermined: 0
  }

  return {
    schemaVersion: '1.0',
    status: input.status ?? 'completed',
    adjudicationStatus: input.adjudicationStatus ?? 'completed',
    generatedAt: '2026-08-06T00:00:00.000Z',
    scope: {
      baseRef: 'b'.repeat(40),
      headRef: 'a'.repeat(40),
      changedFileCount: 1,
      deletedFileCount: 0
    },
    summary: {
      changedSymbolCount: 1,
      changedSymbolsTruncated: false,
      referencedSymbolCount: referenceFiles.length + referenceTestFiles.length,
      impactedFileCount: referenceFiles.length,
      impactedTestFileCount: referenceTestFiles.length,
      referenceCount: referenceFiles.length,
      testReferenceCount: referenceTestFiles.length,
      nonSourceReferenceCount: 0,
      impactFindingCount: findingFiles.length,
      reliedUponPairCount: findingFiles.length,
      deterministicNoImpactPairCount,
      unadjudicatedPairCount: input.unadjudicatedPairCount ?? 0,
      adjudicationCallCount:
        input.adjudicationCallCount ??
        modelNoImpactPairCount + findingFiles.length,
      failedAdjudicationCallCount: 0,
      modelVerdictCounts,
      adjudicationCallsTruncated: input.adjudicationCallsTruncated ?? false,
      rejectedFindingCount: 0
    },
    impactFindings: findingFiles.map((path) => impactFinding({ path })),
    changedSymbols: [
      {
        name: 'changedHelper',
        kind: 'export',
        language: 'python',
        definitionPath: 'src/changed.py',
        definitionLine: 4,
        changeKind: 'modified',
        contractChanges: ['may now return nothing for an empty input'],
        referencesInDefinitionFile: 0,
        referencesInNonSourceFiles: 0,
        referencesTruncated: false,
        referenceSearchTruncated: false
      }
    ],
    impactedFiles: referenceFiles.map((path) => impactedFile({ path })),
    impactedTestFiles: referenceTestFiles.map((path) => impactedFile({ path })),
    warnings: []
  }
}
