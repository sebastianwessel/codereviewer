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
      actionableSeverityThreshold: 'medium',
      // Measured, not chosen: a 1 / 2 / 4 / unlimited sweep put 2 level with the
      // strongest setting on both recall and precision at 27% less cost.
      maxFilesPerDiscoveryCall: 2
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

  // The context scout was removed on 2026-07-27, along with its configuration.
  // No compatibility shim is offered on purpose: a config that still enables it
  // would otherwise run a review that silently does something different from
  // what the file asks for. Failing loudly is the whole point, and it matches how
  // the withdrawn discovery passes were handled.
  test('a config still setting the removed context scout fails validation', () => {
    for (const removed of [
      { contextScout: { enabled: true, maxSymbols: 8, maxBytesPerSymbol: 4000 } },
      { contextScout: { enabled: false } },
      { contextScout: {} }
    ]) {
      expect(() => CodeReviewerConfigSchema.parse({ review: removed })).toThrow()
    }
  })

  // The discovery posture was removed on 2026-07-27 after its A/B failed the rule
  // fixed in advance. As with the context scout above, no compatibility shim is
  // offered: a config that still selects a posture must fail loudly rather than
  // run a review that quietly ignores what the file asks for.
  test('a config still setting the removed discovery posture fails validation', () => {
    for (const removed of ['precise', 'investigative', 'aggressive']) {
      expect(() =>
        CodeReviewerConfigSchema.parse({
          review: { discoveryPosture: removed }
        })
      ).toThrow()
    }
  })

  // Independent discovery sampling was removed on 2026-07-27 after k=3 failed its
  // decision rule and falsified its own premise. Same rule as the removals above:
  // no shim, so a config that still asks for k samples fails loudly instead of
  // silently running one.
  test('a config still setting the removed discovery sample count fails validation', () => {
    for (const removed of [1, 3, 5]) {
      expect(() =>
        CodeReviewerConfigSchema.parse({
          review: { discoverySampleCount: removed }
        })
      ).toThrow()
    }
  })

  test('security dedicated pass defaults to disabled', () => {
    const disabled = CodeReviewerConfigSchema.parse({})
    expect(disabled.security.dedicatedPass.enabled).toBe(false)

    const enabled = CodeReviewerConfigSchema.parse({
      security: { dedicatedPass: { enabled: true } }
    })
    expect(enabled.security.dedicatedPass.enabled).toBe(true)
    // The permission literals keep their secure defaults regardless.
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

  test('change impact is disabled by default with bounded discovery limits', () => {
    const disabled = CodeReviewerConfigSchema.parse({})
    expect(disabled.changeImpact).toEqual({
      enabled: false,
      maxChangedSymbols: 50,
      maxReferencesPerSymbol: 25,
      maxSearchDepth: 12
    })

    const enabled = CodeReviewerConfigSchema.parse({
      changeImpact: {
        enabled: true,
        maxChangedSymbols: 10,
        maxReferencesPerSymbol: 5,
        maxSearchDepth: 3
      }
    })
    expect(enabled.changeImpact).toEqual({
      enabled: true,
      maxChangedSymbols: 10,
      maxReferencesPerSymbol: 5,
      maxSearchDepth: 3
    })
  })

  // Spec 22 requires blocking to be configurable and non-blocking by default,
  // but the command currently reports references rather than findings and has
  // nothing to block on. A `blocking` key would therefore be accepted and then
  // silently ignored, which is the failure the security `signals` key was removed
  // for. Rejecting it keeps the config honest until the key does something.
  test('change impact rejects a blocking key it could not yet honour', () => {
    expect(() =>
      CodeReviewerConfigSchema.parse({ changeImpact: { blocking: true } })
    ).toThrow()
  })

  test('change impact rejects out-of-range discovery bounds', () => {
    expect(() =>
      CodeReviewerConfigSchema.parse({ changeImpact: { maxChangedSymbols: 0 } })
    ).toThrow()
    expect(() =>
      CodeReviewerConfigSchema.parse({
        changeImpact: { maxReferencesPerSymbol: 1000 }
      })
    ).toThrow()
  })

  // The defaults are RUNAWAY GUARDS, not rations. Two of the three were rations
  // until 2026-08-01 and both were measured to bind on real input: 24 of 28 runs
  // returned exactly maxObligations, and 43% of this repository's last 60 commits
  // exceed the old maxChangeLines of 400. Every one of these limits degrades the
  // answer SILENTLY when it binds, so a value real input reaches makes the
  // capability report "nothing left" because it could not see.
  test('intent fulfilment is disabled by default with runaway-guard limits', () => {
    const disabled = CodeReviewerConfigSchema.parse({})
    expect(disabled.intentFulfilment).toEqual({
      enabled: false,
      maxObligations: 100,
      maxIntentBytes: 100_000,
      maxChangeLines: 5000
    })

    const enabled = CodeReviewerConfigSchema.parse({
      intentFulfilment: {
        enabled: true,
        maxObligations: 5,
        maxIntentBytes: 1_000,
        maxChangeLines: 50
      }
    })
    expect(enabled.intentFulfilment).toEqual({
      enabled: true,
      maxObligations: 5,
      maxIntentBytes: 1_000,
      maxChangeLines: 50
    })
  })

  // Spec 23 says the command MUST NOT be able to fail a pipeline on fulfilment
  // grounds and states explicitly that this "is not configurable", because the
  // underlying judgement is not accurate enough to gate on. A `blocking` key would
  // therefore be accepted and then silently ignored — the failure the security
  // `signals` key was removed for. Unlike `changeImpact`, there is no later change
  // that adds it.
  test('intent fulfilment rejects a blocking key it must never honour', () => {
    expect(() =>
      CodeReviewerConfigSchema.parse({ intentFulfilment: { blocking: true } })
    ).toThrow()
    expect(() =>
      CodeReviewerConfigSchema.parse({
        intentFulfilment: { failOnUnaddressed: true }
      })
    ).toThrow()
  })

  test('intent fulfilment rejects out-of-range spend bounds', () => {
    // A bound of zero would enable the capability and forbid every call it
    // consists of.
    expect(() =>
      CodeReviewerConfigSchema.parse({ intentFulfilment: { maxObligations: 0 } })
    ).toThrow()
    expect(() =>
      CodeReviewerConfigSchema.parse({ intentFulfilment: { maxChangeLines: 0 } })
    ).toThrow()
    expect(() =>
      CodeReviewerConfigSchema.parse({
        intentFulfilment: { maxIntentBytes: 500_000 }
      })
    ).toThrow()
  })

  test('invariant conformance is disabled by default with bounded peer limits', () => {
    const disabled = CodeReviewerConfigSchema.parse({})
    expect(disabled.invariantConformance).toEqual({
      enabled: false,
      maxChangedDeclarations: 50,
      maxPeersPerDeclaration: 60,
      maxPeerFiles: 300,
      maxDivergences: 50,
      maxPreExistingDivergences: 25,
      adjudication: { enabled: false, maxAdjudications: 25 }
    })

    const enabled = CodeReviewerConfigSchema.parse({
      invariantConformance: {
        enabled: true,
        maxChangedDeclarations: 5,
        maxPeersPerDeclaration: 8,
        maxPeerFiles: 20,
        maxDivergences: 4,
        maxPreExistingDivergences: 0
      }
    })
    expect(enabled.invariantConformance).toEqual({
      enabled: true,
      maxChangedDeclarations: 5,
      maxPeersPerDeclaration: 8,
      maxPeerFiles: 20,
      maxDivergences: 4,
      maxPreExistingDivergences: 0,
      adjudication: { enabled: false, maxAdjudications: 25 }
    })
  })

  // The one part of spec 24 that can spend money, and the only reason the whole
  // capability is not free. It is off independently of `enabled`, so turning the
  // deterministic baseline arm on can never start a provider call by itself.
  test('conformance adjudication is disabled independently of the capability', () => {
    expect(
      CodeReviewerConfigSchema.parse({
        invariantConformance: { enabled: true }
      }).invariantConformance.adjudication
    ).toEqual({ enabled: false, maxAdjudications: 25 })

    expect(
      CodeReviewerConfigSchema.parse({
        invariantConformance: {
          enabled: true,
          adjudication: { enabled: true, maxAdjudications: 4 }
        }
      }).invariantConformance.adjudication
    ).toEqual({ enabled: true, maxAdjudications: 4 })

    // A bound of zero would be a configuration that enables the arm and forbids
    // every call it consists of.
    expect(() =>
      CodeReviewerConfigSchema.parse({
        invariantConformance: { adjudication: { maxAdjudications: 0 } }
      })
    ).toThrow()
    expect(() =>
      CodeReviewerConfigSchema.parse({
        invariantConformance: { adjudication: { blocking: true } }
      })
    ).toThrow()
  })

  // Spec 24 says the capability is advisory only and MUST NOT be able to fail a
  // pipeline, and `conformance check` always exits 0. A `blocking` key would
  // therefore be accepted and then silently ignored — the failure the security
  // `signals` key was removed for. Unlike `changeImpact`, there is no later
  // change that adds it: advisory-only is a spec requirement, not a stage.
  test('invariant conformance rejects a blocking key it must never honour', () => {
    expect(() =>
      CodeReviewerConfigSchema.parse({
        invariantConformance: { blocking: true }
      })
    ).toThrow()
  })

  test('invariant conformance rejects out-of-range peer bounds', () => {
    // Below three peers a divergence could never cite the three sites spec 24
    // requires, so the schema refuses to express that configuration at all.
    expect(() =>
      CodeReviewerConfigSchema.parse({
        invariantConformance: { maxPeersPerDeclaration: 2 }
      })
    ).toThrow()
    expect(() =>
      CodeReviewerConfigSchema.parse({
        invariantConformance: { maxChangedDeclarations: 0 }
      })
    ).toThrow()
    expect(() =>
      CodeReviewerConfigSchema.parse({
        invariantConformance: { maxPeerFiles: 5000 }
      })
    ).toThrow()
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
