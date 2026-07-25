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
    expect(parsed.verification).toEqual({
      enabled: false,
      providers: [],
      maxToolCallsPerClaim: 12,
      maxBytesPerRead: 20000,
      maxMatches: 20
    })
  })

  test('cross-file retrieval defaults to disabled with a loop-guard tool budget', () => {
    const defaults = CodeReviewerConfigSchema.parse({})
    expect(defaults.review.crossFileRetrieval).toEqual({
      enabled: false,
      maxToolCallsPerTask: 100,
      maxBytesPerRead: 24000
    })

    const enabled = CodeReviewerConfigSchema.parse({
      review: { crossFileRetrieval: { enabled: true, maxToolCallsPerTask: 6 } }
    })
    expect(enabled.review.crossFileRetrieval).toEqual({
      enabled: true,
      maxToolCallsPerTask: 6,
      maxBytesPerRead: 24000
    })

    // The per-read cap bounds how much ONE retrieved file can add to a discovery
    // prompt; a single oversized read measurably diluted a review.
    expect(
      CodeReviewerConfigSchema.parse({
        review: { crossFileRetrieval: { enabled: true, maxBytesPerRead: 8000 } }
      }).review.crossFileRetrieval.maxBytesPerRead
    ).toBe(8000)

    // The cap is a runaway-loop guard, so a generous value is valid; only an
    // absurd one (past the hard ceiling) is rejected.
    expect(
      CodeReviewerConfigSchema.parse({
        review: { crossFileRetrieval: { enabled: true, maxToolCallsPerTask: 200 } }
      }).review.crossFileRetrieval.maxToolCallsPerTask
    ).toBe(200)
    expect(() =>
      CodeReviewerConfigSchema.parse({
        review: { crossFileRetrieval: { enabled: true, maxToolCallsPerTask: 501 } }
      })
    ).toThrow()
  })

  test('context scout defaults to disabled with bounded symbol budgets', () => {
    const defaults = CodeReviewerConfigSchema.parse({})
    expect(defaults.review.contextScout).toEqual({
      enabled: false,
      maxSymbols: 8,
      maxBytesPerSymbol: 4000
    })

    const enabled = CodeReviewerConfigSchema.parse({
      review: { contextScout: { enabled: true, maxSymbols: 3 } }
    })
    expect(enabled.review.contextScout).toEqual({
      enabled: true,
      maxSymbols: 3,
      maxBytesPerSymbol: 4000
    })

    // The per-symbol cap keeps one large callee from flooding the packet and
    // pushing changed-file source out of it.
    expect(
      CodeReviewerConfigSchema.parse({
        review: { contextScout: { enabled: true, maxBytesPerSymbol: 12000 } }
      }).review.contextScout.maxBytesPerSymbol
    ).toBe(12000)

    // Both budgets are rations against context dilution, so out-of-range values
    // fail validation instead of being silently clamped.
    for (const invalid of [
      { maxSymbols: 0 },
      { maxSymbols: 41 },
      { maxBytesPerSymbol: 499 },
      { maxBytesPerSymbol: 40001 }
    ]) {
      expect(() =>
        CodeReviewerConfigSchema.parse({
          review: { contextScout: { enabled: true, ...invalid } }
        })
      ).toThrow()
    }
  })

  test('context scout rejects an unknown nested key', () => {
    expect(() =>
      CodeReviewerConfigSchema.parse({
        review: { contextScout: { on: true } }
      })
    ).toThrow()
  })

  test('security dedicated pass and signals default to disabled', () => {
    const disabled = CodeReviewerConfigSchema.parse({})
    expect(disabled.security.dedicatedPass.enabled).toBe(false)
    expect(disabled.security.signals.enabled).toBe(false)

    const enabled = CodeReviewerConfigSchema.parse({
      security: { dedicatedPass: { enabled: true } }
    })
    expect(enabled.security.dedicatedPass.enabled).toBe(true)
    // Signals stays disabled unless explicitly enabled; the permission literals
    // keep their secure defaults.
    expect(enabled.security.signals.enabled).toBe(false)
    expect(enabled.security.captureContentTelemetry).toBe(false)
  })

  test('security rejects an unknown nested key', () => {
    expect(() =>
      CodeReviewerConfigSchema.parse({
        security: { dedicatedPass: { on: true } }
      })
    ).toThrow()
  })

  test('verification is disabled by default and accepts configured claim providers', () => {
    const disabled = CodeReviewerConfigSchema.parse({})
    expect(disabled.verification.enabled).toBe(false)
    expect(disabled.verification.providers).toEqual([])

    const enabled = CodeReviewerConfigSchema.parse({
      verification: {
        enabled: true,
        providers: [
          { type: 'claims-file', path: '.codereviewer/claims.json' },
          { type: 'prior-findings', report: '.codereviewer/baseline.json' }
        ],
        maxToolCallsPerClaim: 8
      }
    })
    expect(enabled.verification.enabled).toBe(true)
    expect(enabled.verification.providers).toEqual([
      { type: 'claims-file', path: '.codereviewer/claims.json' },
      { type: 'prior-findings', report: '.codereviewer/baseline.json' }
    ])
    expect(enabled.verification.maxToolCallsPerClaim).toBe(8)
    expect(enabled.verification.maxBytesPerRead).toBe(20000)
    expect(enabled.verification.maxMatches).toBe(20)
  })

  test('verification rejects an unknown claim provider type', () => {
    expect(() =>
      CodeReviewerConfigSchema.parse({
        verification: {
          enabled: true,
          providers: [{ type: 'analyzer', report: '.codereviewer/sarif.json' }]
        }
      })
    ).toThrow()
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
