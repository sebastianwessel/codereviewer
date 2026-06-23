import { describe, expect, test } from 'vitest'
import {
  EvalSliceCaseSchema,
  productRecallTiers,
  resolveExpectedFindingTier
} from './eval-fixture.schema.js'

describe('eval fixture schemas', () => {
  test('accepts benchmark-compatible slices with canonical expected findings', () => {
    const parsed = EvalSliceCaseSchema.parse({
      id: 'benchmark-semantic-1',
      source: 'crb',
      sourceProfile: 'benchmark-semantic',
      prUrl: 'https://github.com/example/repo/pull/1',
      prTitle: 'Handle import failure',
      sourceRepo: 'example/repo',
      language: 'typescript',
      baseSha: 'base-sha',
      headSha: 'head-sha',
      baseRef: 'main',
      headRef: 'HEAD',
      upstreamOwner: 'example',
      upstreamRepo: 'repo',
      changedFiles: ['src/loader.ts'],
      diff: 'diff --git a/src/loader.ts b/src/loader.ts\n',
      expectedFindings: [
        {
          category: 'bug',
          severity: 'low',
          semanticSummary:
            'Consider adding error handling around the dynamic import failure.',
          matchMode: 'semantic-only'
        }
      ]
    })

    expect(parsed.sourceProfile).toBe('benchmark-semantic')
    expect(parsed.diff).toBe('diff --git a/src/loader.ts b/src/loader.ts\n')
    expect(parsed.expectedFindings).toEqual([
      {
        category: 'bug',
        severity: 'low',
        semanticSummary:
          'Consider adding error handling around the dynamic import failure.',
        matchMode: 'semantic-only'
      }
    ])
    expect(parsed.tags).toContain('benchmark-semantic')
  })

  test('rejects removed benchmark expected file aliases', () => {
    expect(() =>
      EvalSliceCaseSchema.parse({
        id: 'benchmark-semantic-removed-alias',
        source: 'crb',
        sourceProfile: 'benchmark-semantic',
        language: 'typescript',
        changedFiles: ['src/loader.ts'],
        expectedFindings: [
          {
            file: 'src/loader.ts',
            category: 'bug',
            severity: 'low',
            semanticSummary: 'Removed alias must not be normalized.'
          }
        ]
      })
    ).toThrow()
  })

  test('accepts an explicit tier on slice expected findings', () => {
    const parsed = EvalSliceCaseSchema.parse({
      id: 'benchmark-semantic-tiered',
      language: 'typescript',
      changedFiles: ['src/loader.ts'],
      expectedFindings: [
        {
          category: 'maintainability',
          severity: 'high',
          semanticSummary: 'Treat this naming nit as runtime-critical for the test.',
          tier: 'runtime-critical'
        }
      ]
    })

    expect(parsed.expectedFindings[0]?.tier).toBe('runtime-critical')
  })

  test('rejects removed benchmark expected arrays', () => {
    expect(() =>
      EvalSliceCaseSchema.parse({
        id: 'benchmark-semantic-removed-expected',
        source: 'crb',
        sourceProfile: 'benchmark-semantic',
        language: 'typescript',
        changedFiles: ['src/loader.ts'],
        expected: [
          {
            severity: 'low',
            description: 'Removed shape must not be normalized.'
          }
        ]
      })
    ).toThrow()
  })
})

describe('resolveExpectedFindingTier', () => {
  test('prefers an explicit tier over derivation', () => {
    expect(
      resolveExpectedFindingTier({
        category: 'bug',
        severity: 'critical',
        tier: 'nit'
      })
    ).toBe('nit')
  })

  test('maps security category to the security tier', () => {
    expect(
      resolveExpectedFindingTier({ category: 'security', severity: 'low' })
    ).toBe('security')
  })

  test('maps critical and high bugs to runtime-critical', () => {
    expect(
      resolveExpectedFindingTier({ category: 'bug', severity: 'critical' })
    ).toBe('runtime-critical')
    expect(
      resolveExpectedFindingTier({ category: 'bug', severity: 'high' })
    ).toBe('runtime-critical')
  })

  test('maps lower-severity bugs to logic', () => {
    for (const severity of ['medium', 'low', 'info'] as const) {
      expect(resolveExpectedFindingTier({ category: 'bug', severity })).toBe(
        'logic'
      )
    }
  })

  test('maps performance and compatibility to logic', () => {
    expect(
      resolveExpectedFindingTier({ category: 'performance', severity: 'high' })
    ).toBe('logic')
    expect(
      resolveExpectedFindingTier({
        category: 'compatibility',
        severity: 'medium'
      })
    ).toBe('logic')
  })

  test('maps maintainability, test, and policy to nit', () => {
    for (const category of ['maintainability', 'test', 'policy'] as const) {
      expect(
        resolveExpectedFindingTier({ category, severity: 'high' })
      ).toBe('nit')
    }
  })

  test('excludes nit from the headline product tiers', () => {
    expect(productRecallTiers).toEqual(['runtime-critical', 'security', 'logic'])
    expect(productRecallTiers).not.toContain('nit')
  })
})
