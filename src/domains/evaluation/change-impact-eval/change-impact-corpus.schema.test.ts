import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { SeveritySchema } from '../../../shared/contracts/index.js'
import { CompatibilityClassSchema } from '../../change-impact/index.js'
import {
  countExpectedImpactByReachability,
  directlyReachableImpactClasses,
  evidenceDateOf,
  ExpectedCompatibilityClassSchema,
  ExpectedImpactSchema,
  ImpactReachabilitySchema,
  isDirectlyReachable,
  parseChangeImpactCorpusManifest,
  parseChangeImpactCorpusManifestJson,
  type ChangeImpactCorpusCase
} from './change-impact-corpus.schema.js'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..'
)

const committedManifestPath = path.join(
  repositoryRoot,
  'eval',
  'corpora',
  'change-impact-dependents',
  'manifest.json'
)

const evidence = {
  kind: 'upstream-fix' as const,
  commit: 'c'.repeat(40),
  committedAt: '2026-06-01',
  subject: 'Fixed the caller that stopped resolving the moved contract.',
  repairedPaths: ['pkg/caller.go'],
  quotes: ['Regression in ' + 'a'.repeat(40) + '.'],
  linkVerification:
    'The full object name of the introducing commit is quoted verbatim in the evidence body.'
}

const expectedImpactFixture = {
  path: 'pkg/caller.go',
  lineRange: [10, 14] as [number, number],
  reachability: 'caller-of-changed-symbol' as const,
  compatibilityClass: 'breaks-at-runtime' as const,
  severity: 'medium' as const,
  severityRationale:
    'Signalled failure reachable only under a configured tenant scope.',
  semanticSummary:
    'The caller passes a tenant argument the helper no longer accepts, so the lookup runs unscoped and returns another tenant rows.'
}

const baseCase = {
  id: 'moved-contract-breaks-caller',
  language: 'go',
  split: 'held-out' as const,
  repositoryUrl: 'https://example.test/owner/repo.git',
  upstreamOwner: 'owner',
  upstreamRepo: 'repo',
  license: 'MIT' as const,
  source: 'upstream-regression-mining',
  capturedAt: '2026-07-28',
  introducingCommit: 'a'.repeat(40),
  introducingCommittedAt: '2026-02-01T10:00:00+00:00',
  parentCommit: 'b'.repeat(40),
  reviewedPaths: ['pkg/service.go'],
  reviewIntent: 'Simplify the tenant lookup helper.',
  evidenceOfBreakage: [evidence],
  expectedImpact: [expectedImpactFixture],
  localPlausibility: {
    verdict: 'plausible' as const,
    rationale:
      'The diff removes a parameter that the function body no longer uses, which reads as a clean simplification from inside the change alone.'
  }
}

const manifestWith = (
  cases: readonly Record<string, unknown>[]
): Record<string, unknown> => ({
  schemaVersion: '1.0',
  datasetId: 'test-change-impact',
  modelTrainingCutoff: '2026-01-01',
  description: 'Test corpus.',
  cases
})

const parseWith = (cases: readonly Record<string, unknown>[]) =>
  parseChangeImpactCorpusManifest(manifestWith(cases))

describe('change-impact corpus schema', () => {
  test('accepts a case whose expectation lies outside the reviewed paths', () => {
    const manifest = parseWith([baseCase])

    expect(manifest.cases).toHaveLength(1)
    expect(manifest.cases[0]?.expectedImpact[0]?.path).toBe('pkg/caller.go')
  })

  // THE invariant, and the exact negation of spec 17's. A conditional version of
  // it would enforce nothing, which is why this corpus has its own schema.
  test('rejects an expectation inside the reviewed diff', () => {
    expect(() =>
      parseWith([
        {
          ...baseCase,
          expectedImpact: [
            { ...expectedImpactFixture, path: 'pkg/service.go' }
          ]
        }
      ])
    ).toThrow(/outside the diff/u)
  })

  test('rejects a case with no evidence of breakage', () => {
    expect(() =>
      parseWith([{ ...baseCase, evidenceOfBreakage: [] }])
    ).toThrow()
  })

  test('rejects evidence that repairs a file this case does not expect', () => {
    expect(() =>
      parseWith([
        {
          ...baseCase,
          evidenceOfBreakage: [
            { ...evidence, repairedPaths: ['pkg/somewhere-else.go'] }
          ]
        }
      ])
    ).toThrow(/A curator's inference is not admissible/u)
  })

  test('rejects evidence dated before the change it claims to prove broke', () => {
    expect(() =>
      parseWith([
        {
          ...baseCase,
          evidenceOfBreakage: [{ ...evidence, committedAt: '2026-01-15' }]
        }
      ])
    ).toThrow(/before the change it is supposed to prove/u)
  })

  test('rejects a case citing the introducing commit as its own evidence', () => {
    expect(() =>
      parseWith([
        {
          ...baseCase,
          evidenceOfBreakage: [
            { ...evidence, commit: baseCase.introducingCommit }
          ]
        }
      ])
    ).toThrow(/its own evidence/u)
  })

  test('rejects a missing reachability label', () => {
    const { reachability: _unused, ...withoutReachability } =
      expectedImpactFixture

    expect(() =>
      parseWith([{ ...baseCase, expectedImpact: [withoutReachability] }])
    ).toThrow()
  })

  test('rejects a non-permissive upstream license', () => {
    expect(() => parseWith([{ ...baseCase, license: 'GPL-3.0' }])).toThrow()
  })

  test('rejects a held-out case whose change predates the training cutoff', () => {
    expect(() =>
      parseWith([
        { ...baseCase, introducingCommittedAt: '2025-12-31T10:00:00+00:00' }
      ])
    ).toThrow(/not after the declared training cutoff/u)
  })

  // The window spec 22 calls structurally narrow. There is deliberately no
  // separate cutoff rule for the evidence: it may not predate the change, and a
  // held-out change may not predate the cutoff, so the evidence clears the cutoff
  // by construction rather than by a second check that could drift out of step.
  test('keeps held-out evidence after the cutoff without a second rule', () => {
    const manifest = parseWith([baseCase])
    const [corpusCase] = manifest.cases

    expect(corpusCase?.split).toBe('held-out')
    expect(
      (corpusCase?.evidenceOfBreakage ?? []).every(
        (entry) => evidenceDateOf(entry) > manifest.modelTrainingCutoff
      )
    ).toBe(true)
  })

  test('rejects answer-key wording in a reviewed-input field', () => {
    expect(() =>
      parseWith([
        {
          ...baseCase,
          reviewIntent: 'Fix the vulnerability in the tenant lookup helper.'
        }
      ])
    ).toThrow()
  })

  test('rejects two expectations on one destination file', () => {
    expect(() =>
      parseWith([
        {
          ...baseCase,
          expectedImpact: [
            expectedImpactFixture,
            { ...expectedImpactFixture, lineRange: [30, 34] }
          ]
        }
      ])
    ).toThrow(/the scoring unit is the destination file/u)
  })

  test('rejects excluded paths recorded without a reason', () => {
    expect(() =>
      parseWith([{ ...baseCase, excludedPaths: ['pkg/service_test.go'] }])
    ).toThrow(/without recording why/u)
  })

  test('rejects a duplicate case id', () => {
    expect(() => parseWith([baseCase, { ...baseCase }])).toThrow(
      /Duplicate change-impact case id/u
    )
  })

  test('reports evidence dates for both commit and issue variants', () => {
    expect(evidenceDateOf(evidence)).toBe('2026-06-01')
    expect(
      evidenceDateOf({
        kind: 'issue',
        url: 'https://example.test/issues/1',
        reportedAt: '2026-06-02',
        symptomQuote:
          'Our callers started failing with an unscoped lookup after upgrading.',
        linkVerification:
          'The issue body names the introducing commit and the caller-side symptom.'
      })
    ).toBe('2026-06-02')
  })
})

describe('reachability vocabulary', () => {
  test('splits directly reachable classes from the search-only one', () => {
    expect(directlyReachableImpactClasses).not.toContain('whole-repo-search')
    expect(isDirectlyReachable('caller-of-changed-symbol')).toBe(true)
    expect(isDirectlyReachable('whole-repo-search')).toBe(false)
    expect(ImpactReachabilitySchema.options).toHaveLength(
      directlyReachableImpactClasses.length + 1
    )
  })

  // Both vocabularies are now NARROWED from their canonical enum rather than
  // retyped, so membership cannot drift. What a test still has to hold is the
  // EXCLUSION: each schema drops exactly one member, and it is the one whose
  // meaning a corpus of proven breakage cannot carry.
  test('excludes exactly the members proven breakage cannot express', () => {
    expect(ExpectedCompatibilityClassSchema.options).not.toContain('no-impact')
    expect(ExpectedCompatibilityClassSchema.options).toHaveLength(
      CompatibilityClassSchema.options.length - 1
    )
    expect(ExpectedImpactSchema.shape.severity.options).not.toContain('info')
    expect(ExpectedImpactSchema.shape.severity.options).toHaveLength(
      SeveritySchema.options.length - 1
    )
  })
})

describe('committed change-impact manifest', () => {
  const loadManifest = async () =>
    parseChangeImpactCorpusManifestJson(
      await readFile(committedManifestPath, 'utf8')
    )

  test('parses, so every case carries its evidence, reachability and license', async () => {
    const manifest = await loadManifest()

    expect(manifest.cases.length).toBeGreaterThan(0)

    for (const corpusCase of manifest.cases) {
      expect(corpusCase.evidenceOfBreakage.length).toBeGreaterThan(0)
      expect(corpusCase.expectedImpact.length).toBeGreaterThan(0)

      for (const expected of corpusCase.expectedImpact) {
        expect(ImpactReachabilitySchema.parse(expected.reachability)).toBe(
          expected.reachability
        )
      }
    }
  })

  test('keeps every expectation outside its case reviewed paths', async () => {
    const manifest = await loadManifest()
    const violations = manifest.cases.flatMap((corpusCase) =>
      corpusCase.expectedImpact
        .filter((expected) =>
          corpusCase.reviewedPaths.includes(expected.path)
        )
        .map((expected) => `${corpusCase.id}:${expected.path}`)
    )

    expect(violations).toEqual([])
  })

  // Reporting split by contamination risk is a spec 22 requirement, so the corpus
  // has to be able to answer the question at all: both populations non-empty, or
  // the split is a field nobody can use.
  test('carries both contamination populations', async () => {
    const manifest = await loadManifest()
    const splits = new Set(manifest.cases.map((corpusCase) => corpusCase.split))

    expect(splits.has('dev')).toBe(true)
    expect(splits.has('held-out')).toBe(true)
  })

  test('carries directly reachable and search-only dependents alike', async () => {
    const manifest = await loadManifest()
    const counts = countExpectedImpactByReachability(manifest.cases)
    const direct = directlyReachableImpactClasses.reduce(
      (total, reachability) => total + counts[reachability],
      0
    )

    expect(direct).toBeGreaterThan(0)
    expect(counts['whole-repo-search']).toBeGreaterThan(0)
  })

  test('records a plausibility verdict for every case', async () => {
    const manifest = await loadManifest()
    const missing = manifest.cases
      .filter(
        (corpusCase: ChangeImpactCorpusCase) =>
          corpusCase.localPlausibility.rationale.trim().length === 0
      )
      .map((corpusCase) => corpusCase.id)

    expect(missing).toEqual([])
  })
})
