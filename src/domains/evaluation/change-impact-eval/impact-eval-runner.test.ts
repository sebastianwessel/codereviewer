import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../../../shared/contracts/index.js'
import { corpusCaseFixture } from './change-impact-fixture.js'
import {
  changeImpactAdjudicationCallBounds,
  configForCase,
  hydratedCaseMatchesManifest,
  runChangeImpactEvalCase
} from './impact-eval-runner.js'

const baseConfig = CodeReviewerConfigSchema.parse({})

describe('change-impact eval runner: the reviewed surface', () => {
  // A manifest excludes paths from review for a reason it records — commonly
  // that the updated tests state the moved contract in assertions. Showing the
  // engine those files would hand it the answer key.
  test('excludes the manifest paths the corpus deliberately does not review', () => {
    const corpusCase = corpusCaseFixture({
      id: 'case-a',
      reviewedPaths: ['src/changed.py'],
      excludedPaths: ['tests/test_changed.py'],
      expected: [{ path: 'src/a.py', reachability: 'caller-of-changed-symbol' }]
    })

    const config = configForCase({ config: baseConfig, corpusCase })

    expect(config.paths.exclude).toContain('tests/test_changed.py')
    // The configured excludes survive; the case's are added to them.
    for (const pattern of baseConfig.paths.exclude) {
      expect(config.paths.exclude).toContain(pattern)
    }
    expect(baseConfig.paths.exclude).not.toContain('tests/test_changed.py')
  })

  test('leaves the configured excludes untouched when the case excludes nothing', () => {
    const config = configForCase({
      config: baseConfig,
      corpusCase: corpusCaseFixture({
        id: 'case-a',
        expected: [
          { path: 'src/a.py', reachability: 'caller-of-changed-symbol' }
        ]
      })
    })

    expect(config.paths.exclude).toEqual(baseConfig.paths.exclude)
  })
})

describe('change-impact eval runner: the adjudication-call flag bounds', () => {
  // A flag range below the schema's would reject a value the config allows; one
  // above it would be accepted by the parser and then rejected by config
  // validation, after the run had already started. The schema is probed rather
  // than the constant restated.
  const parsesMaxCalls = (maxCalls: number): boolean =>
    CodeReviewerConfigSchema.safeParse({
      changeImpact: { adjudication: { maxCalls } }
    }).success

  test('match the config schema at both ends', () => {
    expect(parsesMaxCalls(changeImpactAdjudicationCallBounds.min)).toBe(true)
    expect(parsesMaxCalls(changeImpactAdjudicationCallBounds.max)).toBe(true)
    expect(parsesMaxCalls(changeImpactAdjudicationCallBounds.min - 1)).toBe(false)
    expect(parsesMaxCalls(changeImpactAdjudicationCallBounds.max + 1)).toBe(false)
  })
})

describe('change-impact eval runner: a stale checkout is not scored', () => {
  const corpusCase = corpusCaseFixture({
    id: 'case-a',
    expected: [{ path: 'src/a.py', reachability: 'caller-of-changed-symbol' }]
  })
  const storedFor = (
    overrides: Record<string, unknown> = {}
  ): Record<string, unknown> => ({
    headSha: corpusCase.introducingCommit,
    baseSha: corpusCase.parentCommit,
    expectedImpact: corpusCase.expectedImpact,
    ...overrides
  })

  test('accepts a checkout that matches the manifest', () => {
    expect(
      hydratedCaseMatchesManifest({ stored: storedFor(), corpusCase })
    ).toEqual({ matches: true })
  })

  test('refuses a checkout at a different head commit', () => {
    expect(
      hydratedCaseMatchesManifest({
        stored: storedFor({ headSha: 'f'.repeat(40) }),
        corpusCase
      }).matches
    ).toBe(false)
  })

  test('refuses a checkout whose base commit disagrees', () => {
    expect(
      hydratedCaseMatchesManifest({
        stored: storedFor({ baseSha: 'f'.repeat(40) }),
        corpusCase
      }).matches
    ).toBe(false)
  })

  // The incident this guards against: a published recall figure scored against
  // an answer key that had changed underneath the checkout.
  test('refuses a checkout carrying a different answer key', () => {
    const result = hydratedCaseMatchesManifest({
      stored: storedFor({
        expectedImpact: [
          { ...corpusCase.expectedImpact[0], path: 'src/somewhere-else.py' }
        ]
      }),
      corpusCase
    })

    expect(result.matches).toBe(false)
    expect(result.matches === false ? result.detail : '').toContain(
      're-hydrate'
    )
  })

  // Key ORDER is representation, not content. Refusing on it would block ordinary
  // work and train people to pass `--force`.
  test('accepts a checkout whose answer key differs only in key order', () => {
    const [expected] = corpusCase.expectedImpact

    if (expected === undefined) {
      throw new Error('the fixture must carry an expectation')
    }

    const reordered = {
      severityRationale: expected.severityRationale,
      severity: expected.severity,
      semanticSummary: expected.semanticSummary,
      compatibilityClass: expected.compatibilityClass,
      reachability: expected.reachability,
      lineRange: expected.lineRange,
      path: expected.path
    }

    expect(
      hydratedCaseMatchesManifest({
        stored: storedFor({ expectedImpact: [reordered] }),
        corpusCase
      })
    ).toEqual({ matches: true })
  })
})

describe('change-impact eval runner: an absent checkout is unmeasured', () => {
  test('reports not-hydrated rather than an empty prediction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codereviewer-impact-eval-'))

    try {
      const result = await runChangeImpactEvalCase({
        repositoryRoot: root,
        caseRoot: '.codereviewer/eval/change-impact-cases/nothing-here',
        corpusCase: corpusCaseFixture({
          id: 'case-a',
          expected: [
            { path: 'src/a.py', reachability: 'caller-of-changed-symbol' }
          ]
        }),
        config: baseConfig
      })

      expect(result.outcome.status).toBe('unmeasured')
      expect(
        result.outcome.status === 'unmeasured' ? result.outcome.reason : ''
      ).toBe('not-hydrated')
      expect(
        result.outcome.status === 'unmeasured' ? result.outcome.detail : ''
      ).toContain('eval:impact-corpus:hydrate')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
