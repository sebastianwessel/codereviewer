import { describe, expect, test } from 'vitest'
import { EvalSliceCaseSchema } from './eval-fixture.schema.js'

describe('eval fixture schemas', () => {
  test('accepts benchmark-compatible slices and normalizes expected comments', () => {
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
      expected: [
        {
          line: null,
          lineEnd: null,
          type: 'bug',
          severity: 'low',
          description:
            'Consider adding error handling around the dynamic import failure.'
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
})
