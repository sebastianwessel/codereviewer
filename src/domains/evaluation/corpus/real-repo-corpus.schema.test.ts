import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseChangeImpactCorpusManifestJson } from '../change-impact-eval/change-impact-corpus.schema.js'
import { describe, expect, test } from 'vitest'
import {
  containsAnswerKey,
  isFullCommitSha,
  parseRealRepoCorpusManifest,
  parseRealRepoCorpusManifestJson,
  selectCorpusCases,
  tokenNormalizedDiffFingerprint,
  type RealRepoCorpusCase
} from './real-repo-corpus.schema.js'

const committedManifestPath = 'eval/corpora/real-repo-cross-file/manifest.json'

// Every corpus shipped in the repository, discovered rather than listed. Naming one
// manifest is what let a second corpus ship with a screening note over its schema
// bound: the suite was green, the drift check was green, and nothing parsed the file.
const shippedManifestPaths = async (): Promise<readonly string[]> => {
  const root = 'eval/corpora'
  const entries = await readdir(root, { withFileTypes: true })

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name, 'manifest.json'))
}

const baseCase = {
  id: 'sample-case',
  language: 'go',
  split: 'held-out',
  repositoryUrl: 'https://example.test/owner/repo.git',
  upstreamOwner: 'owner',
  upstreamRepo: 'repo',
  license: 'MIT',
  source: 'upstream-fix-commit',
  capturedAt: '2026-07-25',
  fixCommit: 'a'.repeat(40),
  fixCommittedAt: '2026-06-01T10:00:00+00:00',
  parentCommit: 'b'.repeat(40),
  reviewedPaths: ['pkg/service.go'],
  reviewIntent: 'Simplify the tenant lookup helper',
  expectedFindings: [
    {
      category: 'bug',
      severity: 'medium',
      path: 'pkg/service.go',
      semanticSummary: 'The helper no longer scopes the lookup by tenant.'
    }
  ]
} as const

const manifestWith = (
  cases: readonly Record<string, unknown>[],
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  schemaVersion: '1.0',
  datasetId: 'test-corpus',
  modelTrainingCutoff: '2026-01-01',
  splitIntegrity: {
    status: 'single-split',
    contaminationNote:
      'Every case here is held-out and there is no dev set, so the chronological rule compares nothing. Read every figure from this corpus as a dev-set figure that does not satisfy the held-out criterion.'
  },
  description: 'Test corpus.',
  cases,
  ...overrides
})

const chronologicalSplit = { splitIntegrity: { status: 'chronological-split' } }

describe('real repository corpus manifest schema', () => {
  test('parses a minimal valid manifest and applies defaults', () => {
    const manifest = parseRealRepoCorpusManifest(manifestWith([baseCase]))
    const corpusCase = manifest.cases[0] as RealRepoCorpusCase

    expect(corpusCase.expectedNoFindingZones).toEqual([])
    expect(corpusCase.tags).toEqual([])
  })

  test('rejects short or uppercase commit object names', () => {
    expect(isFullCommitSha('a'.repeat(40))).toBe(true)
    expect(isFullCommitSha('a'.repeat(64))).toBe(true)
    expect(isFullCommitSha('a'.repeat(7))).toBe(false)
    expect(isFullCommitSha('A'.repeat(40))).toBe(false)
    expect(() =>
      parseRealRepoCorpusManifest(
        manifestWith([{ ...baseCase, fixCommit: 'abc1234' }])
      )
    ).toThrow(/full lowercase git object name/u)
  })

  test('rejects non-https and credential-bearing repository URLs', () => {
    expect(() =>
      parseRealRepoCorpusManifest(
        manifestWith([
          { ...baseCase, repositoryUrl: 'git@example.test:owner/repo.git' }
        ])
      )
    ).toThrow()
    expect(() =>
      parseRealRepoCorpusManifest(
        manifestWith([
          {
            ...baseCase,
            repositoryUrl: 'https://user:token@example.test/owner/repo.git'
          }
        ])
      )
    ).toThrow(/credentials/u)
  })

  test('rejects a copyleft upstream license', () => {
    expect(() =>
      parseRealRepoCorpusManifest(
        manifestWith([{ ...baseCase, license: 'GPL-3.0' }])
      )
    ).toThrow()
  })

  test('keeps the answer key out of the reviewed intent', () => {
    expect(containsAnswerKey('Fixes CVE-2026-12345 in the parser')).toBe(true)
    expect(containsAnswerKey('See GHSA-abcd-efgh-ijkl')).toBe(true)
    expect(containsAnswerKey('Patches a vulnerability in the router')).toBe(true)
    expect(containsAnswerKey('Simplify the tenant lookup helper')).toBe(false)
    expect(() =>
      parseRealRepoCorpusManifest(
        manifestWith([
          { ...baseCase, reviewIntent: 'Fix the CVE-2026-12345 regression' }
        ])
      )
    ).toThrow(/must not name the defect/u)
  })

  // Hydration matches acknowledged text against the flagged comments as a set,
  // and it matches exactly, so a padded or duplicated entry records a judgement
  // that covers nothing while reading as though it did.
  test('keeps a removed-comment resolution matchable against the flagged text', () => {
    const reviewWith = (
      acknowledgedComments: readonly string[]
    ): Record<string, unknown> => ({
      ...baseCase,
      removedCommentDisclosureReview: {
        reviewedAt: '2026-07-27',
        verdict: 'non-disclosing',
        rationale:
          'A licence header whose copyright year the fix commit bumped; it names no code and no behaviour.',
        acknowledgedComments
      }
    })

    expect(
      parseRealRepoCorpusManifest(manifestWith([reviewWith(['// a header'])]))
        .cases[0]?.removedCommentDisclosureReview?.verdict
    ).toBe('non-disclosing')
    expect(() =>
      parseRealRepoCorpusManifest(manifestWith([reviewWith(['  // a header'])]))
    ).toThrow(/trimmed exactly as hydration reports it/u)
    expect(() =>
      parseRealRepoCorpusManifest(
        manifestWith([reviewWith(['// a header', '// a header'])])
      )
    ).toThrow(/acknowledges the same removed comment twice/u)
  })

  test('rejects duplicate case ids and duplicate fix commits', () => {
    expect(() =>
      parseRealRepoCorpusManifest(manifestWith([baseCase, baseCase]))
    ).toThrow(/Duplicate corpus case id/u)
    expect(() =>
      parseRealRepoCorpusManifest(
        manifestWith([baseCase, { ...baseCase, id: 'other-case' }])
      )
    ).toThrow(/Duplicate corpus fix commit/u)
  })

  test('rejects an identical fix and parent commit', () => {
    expect(() =>
      parseRealRepoCorpusManifest(
        manifestWith([{ ...baseCase, parentCommit: baseCase.fixCommit }])
      )
    ).toThrow(/same fix and parent commit/u)
  })

  test('rejects an expected finding outside the reviewed paths', () => {
    expect(() =>
      parseRealRepoCorpusManifest(
        manifestWith([
          {
            ...baseCase,
            expectedFindings: [
              { ...baseCase.expectedFindings[0], path: 'pkg/other.go' }
            ]
          }
        ])
      )
    ).toThrow(/not a reviewed path/u)
  })

  test('enforces the temporal cutoff for held-out cases', () => {
    expect(() =>
      parseRealRepoCorpusManifest(
        manifestWith([
          { ...baseCase, fixCommittedAt: '2025-11-30T10:00:00+00:00' }
        ])
      )
    ).toThrow(/not after the declared training cutoff/u)
  })

  test('enforces a chronological, non-random split', () => {
    const devCase = {
      ...baseCase,
      id: 'dev-case',
      split: 'dev',
      fixCommit: 'c'.repeat(40),
      fixCommittedAt: '2026-06-10T10:00:00+00:00'
    }

    expect(() =>
      parseRealRepoCorpusManifest(
        manifestWith([devCase, baseCase], chronologicalSplit)
      )
    ).toThrow(/must be chronological/u)
    expect(
      parseRealRepoCorpusManifest(
        manifestWith(
          [
            { ...devCase, fixCommittedAt: '2026-02-01T10:00:00+00:00' },
            baseCase
          ],
          chronologicalSplit
        )
      ).cases
    ).toHaveLength(2)
  })

  // The chronological rule has exactly one silent failure mode: with one split
  // empty it compares nothing and passes. These two tests are what stop that
  // pass from being quoted as a verified split.
  test('rejects a declared chronological split that has nothing to compare', () => {
    expect(() =>
      parseRealRepoCorpusManifest(manifestWith([baseCase], chronologicalSplit))
    ).toThrow(/nothing to compare/u)
  })

  test('rejects a stale single-split declaration once a comparison set exists', () => {
    const devCase = {
      ...baseCase,
      id: 'dev-case',
      split: 'dev',
      fixCommit: 'c'.repeat(40),
      fixCommittedAt: '2026-02-01T10:00:00+00:00'
    }

    expect(() =>
      parseRealRepoCorpusManifest(manifestWith([devCase, baseCase]))
    ).toThrow(/declares a single split but has both/u)
  })

  test('requires a single-split manifest to state what its figures mean', () => {
    expect(() =>
      parseRealRepoCorpusManifest(
        manifestWith([baseCase], {
          splitIntegrity: { status: 'single-split', contaminationNote: 'none' }
        })
      )
    ).toThrow()
  })
})

describe('corpus case selection', () => {
  const cases = parseRealRepoCorpusManifest(
    manifestWith([
      baseCase,
      {
        ...baseCase,
        id: 'second-case',
        fixCommit: 'd'.repeat(40)
      }
    ])
  ).cases

  test('returns every case when no filter is supplied', () => {
    expect(selectCorpusCases(cases, []).map((entry) => entry.id)).toEqual([
      'sample-case',
      'second-case'
    ])
  })

  test('filters by exact case id', () => {
    expect(
      selectCorpusCases(cases, ['second-case']).map((entry) => entry.id)
    ).toEqual(['second-case'])
  })

  test('fails loudly on an unknown filter instead of hydrating nothing', () => {
    expect(() => selectCorpusCases(cases, ['missing-case'])).toThrow(
      /Unknown corpus case filter/u
    )
  })
})

describe('token normalized diff fingerprint', () => {
  const diff = [
    'diff --git a/pkg/service.go b/pkg/service.go',
    '--- a/pkg/service.go',
    '+++ b/pkg/service.go',
    '@@ -1,2 +1,2 @@',
    '-  return lookup(id, tenant)',
    '+  return lookup(id)',
    ' // unchanged'
  ].join('\n')

  test('ignores indentation and file headers', () => {
    const reindented = diff
      .replace('-  return lookup(id, tenant)', '-\treturn lookup(id, tenant)')
      .replace('+  return lookup(id)', '+    return   lookup(id)')

    expect(tokenNormalizedDiffFingerprint(reindented)).toBe(
      tokenNormalizedDiffFingerprint(diff)
    )
  })

  test('separates genuinely different changes', () => {
    expect(
      tokenNormalizedDiffFingerprint(
        diff.replace('+  return lookup(id)', '+  return lookup(id, "")')
      )
    ).not.toBe(tokenNormalizedDiffFingerprint(diff))
  })
})

// Which parser owns each shipped corpus. Corpora do not carry a discriminator, so
// coverage is DECLARED: a new corpus directory fails the test below until it is
// added here, rather than being silently skipped.
const parserByCorpus: Readonly<Record<string, (json: string) => unknown>> = {
  'real-repo-cross-file': parseRealRepoCorpusManifestJson,
  'security-advisory-2026': parseRealRepoCorpusManifestJson,
  'change-impact-dependents': parseChangeImpactCorpusManifestJson
}

describe('every shipped corpus manifest', () => {
  // A manifest that fails its own schema is invisible until someone hydrates it, and
  // hydration is not part of the suite. This is the cheap guard for that.
  test('parses against the schema that owns it', async () => {
    const paths = await shippedManifestPaths()

    expect(paths.length).toBeGreaterThan(1)

    for (const path of paths) {
      const corpus = path.split('/')[2] ?? ''
      const parse = parserByCorpus[corpus]

      expect(parse, `${path} has no declared parser in parserByCorpus`).toBeDefined()

      const contents = await readFile(path, 'utf8')

      // Named in the failure so a broken manifest says WHICH corpus is broken.
      expect(
        () => parse?.(contents),
        `${path} does not satisfy the schema that owns it`
      ).not.toThrow()
    }
  })
})

describe('committed real repository corpus manifest', () => {
  test('validates and stays inside the declared anti-contamination policy', async () => {
    const manifest = parseRealRepoCorpusManifestJson(
      await readFile(committedManifestPath, 'utf8')
    )

    expect(manifest.cases.length).toBeGreaterThanOrEqual(3)

    for (const corpusCase of manifest.cases) {
      expect(corpusCase.fixCommittedAt.slice(0, 10) > manifest.modelTrainingCutoff).toBe(
        true
      )
      expect(corpusCase.expectedFindings.length).toBeGreaterThan(0)
      expect(containsAnswerKey(corpusCase.reviewIntent)).toBe(false)
    }
  })

  // A no-finding zone is an assertion that a region is clean, and a wrong one
  // manufactures false "false positives" instead of measuring them. Two
  // properties keep an unjustifiable zone out: it must cover a file the reviewer
  // was actually asked to look at, and it must not sit on top of the case's own
  // answer key, which would score a correct finding as a false alarm.
  test('declares no-finding zones that are reviewable and clear of the answer key', async () => {
    const manifest = parseRealRepoCorpusManifestJson(
      await readFile(committedManifestPath, 'utf8')
    )
    const zonedCases = manifest.cases.filter(
      (corpusCase) => corpusCase.expectedNoFindingZones.length > 0
    )

    expect(zonedCases.length).toBeGreaterThan(0)

    for (const corpusCase of zonedCases) {
      for (const zone of corpusCase.expectedNoFindingZones) {
        expect(corpusCase.reviewedPaths).toContain(zone.path)
        // A whole-file zone would flag every unmatched finding in the file,
        // including one aimed at a defect nobody listed.
        expect(zone.lineRange).toBeDefined()

        for (const expected of corpusCase.expectedFindings) {
          if (expected.path !== zone.path || expected.lineRange === undefined) {
            continue
          }

          const [zoneStart, zoneEnd] = zone.lineRange ?? [0, 0]
          const [expectedStart, expectedEnd] = expected.lineRange

          expect(expectedStart <= zoneEnd && zoneStart <= expectedEnd).toBe(
            false
          )
        }
      }
    }
  })
})
