import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema, RepositoryRelativePathSchema } from './config.schema.js'

describe('CodeReviewerConfigSchema', () => {
  test('accepts an empty config and applies safe defaults', () => {
    const parsed = CodeReviewerConfigSchema.parse({})

    expect(parsed.review.mode).toBe('local')
    expect(parsed.review.depth).toBe('balanced')
    expect(parsed.instructions.files).toEqual([])
    expect(parsed.skills.enabled).toBe(false)
    expect(parsed.skills.directories).toEqual(['.codereviewer/skills'])
    expect(parsed.skills.allowTools).toEqual(['read', 'list', 'grep'])
    expect(parsed.paths.artifactDir).toBe('.codereviewer/runs')
    expect(parsed.baseline.path).toBe('.codereviewer/baseline.json')
    expect(parsed.qualityGate).toEqual({
      maxCritical: 0,
      maxHigh: 0,
      failOnProviderError: true
    })
    expect(parsed.aiReview).toEqual({
      requireRefutation: true,
      deterministicSignalMode: 'support',
      actionableSeverityThreshold: 'medium'
    })
    expect(parsed.promotionPolicy).toEqual({
      modelWeakOrRefuted: 'artifact-only'
    })
    expect(parsed.paths.exclude).toEqual(
      expect.arrayContaining([
        '.git/**',
        'node_modules/**',
        'dist/**',
        'coverage/**',
        '.codereviewer/**',
        // Generated / non-reviewable data files are excluded from model review.
        '**/package-lock.json',
        '**/yarn.lock',
        '**/*.min.js',
        '**/*.map',
        '**/*.snap'
      ])
    )
    expect(parsed.paths.exclude).not.toContain(`.${'review'}/**`)
    expect(parsed.security.captureContentTelemetry).toBe(false)
    expect(parsed.drift).toEqual({
      enabled: true,
      failOn: ['generated-artifact-drift', 'security-drift'],
      includeDocs: true,
      includeSpecs: true,
      includeGenerated: true
    })
    expect(parsed.reporting.formats).toEqual(['json', 'markdown', 'sarif'])
  })

  test('accepts an openai-compatible provider only with baseUrl', () => {
    const parsed = CodeReviewerConfigSchema.parse({
      provider: {
        id: 'openai-compatible',
        model: 'model-a',
        baseUrl: 'https://provider.example/v1'
      }
    })

    expect(parsed.provider?.id).toBe('openai-compatible')
  })

  test('rejects unknown top-level and nested keys', () => {
    expect(() => CodeReviewerConfigSchema.parse({ unknown: true })).toThrow()
    expect(() => CodeReviewerConfigSchema.parse({ review: { unknown: true } })).toThrow()
    expect(() =>
      CodeReviewerConfigSchema.parse({
        qualityGate: { minEvidenceLevel: 'model-ok' }
      })
    ).toThrow()
    expect(() =>
      CodeReviewerConfigSchema.parse({
        promotionPolicy: { deterministicSignalOnly: 'actionable' }
      })
    ).toThrow()
  })

  test('rejects unsafe repository-relative paths', () => {
    expect(() => RepositoryRelativePathSchema.parse('/absolute/path')).toThrow()
    expect(() => RepositoryRelativePathSchema.parse('C:/absolute/path')).toThrow()
    expect(() => RepositoryRelativePathSchema.parse('../escape')).toThrow()
    expect(() => RepositoryRelativePathSchema.parse('safe/../escape')).toThrow()
    expect(() => RepositoryRelativePathSchema.parse('bad\0path')).toThrow()
  })

  test('rejects invalid provider and telemetry settings', () => {
    expect(() =>
      CodeReviewerConfigSchema.parse({
        provider: { id: 'openai-compatible', model: 'model-a' }
      })
    ).toThrow()

    expect(() =>
      CodeReviewerConfigSchema.parse({
        security: { captureContentTelemetry: true }
      })
    ).toThrow()

    expect(() =>
      CodeReviewerConfigSchema.parse({
        security: { allowShell: true }
      })
    ).toThrow()

    expect(() =>
      CodeReviewerConfigSchema.parse({
        security: { allowNetwork: true }
      })
    ).toThrow()

    expect(() =>
      CodeReviewerConfigSchema.parse({
        security: { allowFilesystemWrite: true }
      })
    ).toThrow()

    expect(() =>
      CodeReviewerConfigSchema.parse({
        skills: {
          allowTools: ['bash']
        }
      })
    ).toThrow()
  })

  test('accepts configurable drift gates', () => {
    const parsed = CodeReviewerConfigSchema.parse({
      drift: {
        failOn: ['security-drift', 'ambiguity']
      }
    })

    expect(parsed.drift.failOn).toEqual(['security-drift', 'ambiguity'])
  })

  test('rejects git refs that start with a dash', () => {
    expect(() =>
      CodeReviewerConfigSchema.parse({
        review: { baseRef: '-bad' }
      })
    ).toThrow()
  })
})
