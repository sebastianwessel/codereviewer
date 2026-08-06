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
      // Naming a provider and a model is enough to get a review: the AI review is
      // ON unless explicitly disabled. It used to be an optional tri-state where
      // `undefined` and `true` were indistinguishable.
      enabled: true,
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
    // `maxBytesPerRead` ABSENT here for the same reason it is absent from
    // cross-file retrieval below: a proactive per-read cut chosen in advance
    // resolves a claim against a prefix of a file and calls it the file.
    expect(parsed.verification).toEqual({
      enabled: false,
      providers: [],
      maxToolCallsPerClaim: 12,
      maxMatches: 20
    })
  })

  test('cross-file retrieval defaults to ON, with no proactive per-read cap', () => {
    const defaults = CodeReviewerConfigSchema.parse({})
    // Enabled: two runs put it ahead on recall, false alarms, cost and reliability.
    // maxBytesPerRead ABSENT: spec 28 removed the guessed 24,000-byte cut, which had
    // truncated files mid-read and caused three measurements to blame the feature.
    expect(defaults.review.crossFileRetrieval).toEqual({
      enabled: true,
      maxToolCallsPerTask: 100
    })

    const enabled = CodeReviewerConfigSchema.parse({
      review: { crossFileRetrieval: { enabled: true, maxToolCallsPerTask: 6 } }
    })
    expect(enabled.review.crossFileRetrieval).toEqual({
      enabled: true,
      maxToolCallsPerTask: 6
    })

    // An explicit cap is a deliberate operator choice and still binds — and when it
    // does, the cut is disclosed to the reviewer rather than silent.
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

  // Refutation retrieval was removed on 2026-08-06, after the A/B recorded in spec
  // 05 fired the removal clause of the rule pre-registered before the measurement:
  // adjusted precision fell 96.1% → 92.9% with genuine false positives up in every
  // seed position, no recall effect (5 gained, 7 lost, p = 0.7744), for +10% cost.
  // Same rule as the removals below: no compatibility shim, so a config that still
  // asks the refuter to retrieve fails loudly rather than running a review that
  // quietly ignores what the file asks for.
  test('a config still setting the removed refutation retrieval block fails validation', () => {
    for (const removed of [
      { refutationRetrieval: { enabled: true, maxToolCallsPerBatch: 24 } },
      { refutationRetrieval: { enabled: false } },
      { refutationRetrieval: {} }
    ]) {
      expect(() => CodeReviewerConfigSchema.parse({ review: removed })).toThrow()
    }
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

  // Invariant-conformance review (spec 24) was withdrawn on 2026-08-02 after its
  // step-1 measurement fired 7.0 reports per PR-sized range against a
  // pre-registered kill criterion of ~0.5, with ZERO true positives across ~300
  // hand-judged divergences from five codebases. The whole capability went, and
  // `invariantConformance` went with it. Same rule as the removals above: no
  // compatibility shim, because a config that still enables a stage that no
  // longer exists must say so rather than run a pipeline that quietly does less
  // than the file asks for.
  test('a config still setting the removed invariant conformance block fails validation', () => {
    for (const removed of [
      { enabled: true, maxPeerFiles: 300 },
      { enabled: false },
      { adjudication: { enabled: true } },
      {}
    ]) {
      expect(() =>
        CodeReviewerConfigSchema.parse({ invariantConformance: removed })
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
    // Unset unless an operator asks for it; an explicit cap still binds, and the
    // cut it causes is disclosed to the investigator rather than silent.
    expect(enabled.verification.maxBytesPerRead).toBeUndefined()
    expect(
      CodeReviewerConfigSchema.parse({
        verification: { enabled: true, maxBytesPerRead: 8000 }
      }).verification.maxBytesPerRead
    ).toBe(8000)
    expect(enabled.verification.maxMatches).toBe(20)
  })

  test('change impact is disabled by default with bounded discovery limits', () => {
    const disabled = CodeReviewerConfigSchema.parse({})
    expect(disabled.changeImpact).toEqual({
      enabled: false,
      maxChangedSymbols: 50,
      maxReferencesPerSymbol: 25,
      maxSearchDepth: 12,
      adjudication: { enabled: false, maxCalls: 40 }
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
      maxSearchDepth: 3,
      adjudication: { enabled: false, maxCalls: 40 }
    })
  })

  // ADJUDICATION IS SEPARATELY OFF, and that is the point of the second switch.
  // Everything else `impact check` does is deterministic and free; adjudication is
  // the only part that can reach a provider, so enabling the command must not
  // silently start billing an operator who asked for the reference list.
  test('change impact adjudication stays off when the command is turned on', () => {
    const enabled = CodeReviewerConfigSchema.parse({
      changeImpact: { enabled: true }
    })

    expect(enabled.changeImpact.enabled).toBe(true)
    expect(enabled.changeImpact.adjudication.enabled).toBe(false)
    expect(
      CodeReviewerConfigSchema.parse({
        changeImpact: { adjudication: { enabled: true, maxCalls: 5 } }
      }).changeImpact.adjudication
    ).toEqual({ enabled: true, maxCalls: 5 })
    expect(() =>
      CodeReviewerConfigSchema.parse({
        changeImpact: { adjudication: { maxCalls: 0 } }
      })
    ).toThrow()
  })

  // Spec 22 makes the lane non-blocking and states that it "MUST NOT be
  // configurable to block". This is settled rather than pending: a breaking change
  // is frequently intentional, so there is nothing to block on, and a `blocking`
  // key would be accepted and then silently ignored — the failure the security
  // `signals` key was removed for. The strict object turns setting it into a
  // configuration error instead of a switch an operator believes gated the build.
  test('change impact rejects a blocking key it must never honour', () => {
    expect(() =>
      CodeReviewerConfigSchema.parse({ changeImpact: { blocking: true } })
    ).toThrow()
    expect(() =>
      CodeReviewerConfigSchema.parse({
        changeImpact: { adjudication: { blocking: true } }
      })
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

describe('InstructionsConfigSchema path scoping', () => {
  test('accepts an unscoped file entry and leaves scope unset', () => {
    const parsed = CodeReviewerConfigSchema.parse({
      instructions: { files: [{ path: 'AGENTS.md' }] }
    })

    expect(parsed.instructions.files).toEqual([{ path: 'AGENTS.md' }])
    expect(parsed.instructions.files[0]?.scope).toBeUndefined()
  })

  test('accepts a scoped file entry', () => {
    const parsed = CodeReviewerConfigSchema.parse({
      instructions: {
        files: [{ path: 'backend/AGENTS.md', scope: ['backend/**', 'services/**'] }]
      }
    })

    expect(parsed.instructions.files).toEqual([
      { path: 'backend/AGENTS.md', scope: ['backend/**', 'services/**'] }
    ])
  })

  // An empty scope is rejected rather than accepted as "matches nothing": a
  // present-but-empty array reads as a mistake, and turning it into a silent
  // permanent exclusion would hide a configured instruction with nothing
  // saying why. Delete `scope` to go back to unscoped.
  test('rejects an empty scope array', () => {
    expect(() =>
      CodeReviewerConfigSchema.parse({
        instructions: { files: [{ path: 'AGENTS.md', scope: [] }] }
      })
    ).toThrow()
  })

  // The pre-scoping shape (`files: string[]`) is a breaking change, on
  // purpose (no compatibility layer): a bare string is no longer a valid
  // entry.
  test('rejects the pre-scoping bare-string file entry shape', () => {
    expect(() =>
      CodeReviewerConfigSchema.parse({
        instructions: { files: ['AGENTS.md'] }
      })
    ).toThrow()
  })

  test('rejects unknown keys on a file entry', () => {
    expect(() =>
      CodeReviewerConfigSchema.parse({
        instructions: { files: [{ path: 'AGENTS.md', globs: ['**'] }] }
      })
    ).toThrow()
  })

  test('inline stays a single unscoped string', () => {
    const parsed = CodeReviewerConfigSchema.parse({
      instructions: { inline: 'Repo-wide guidance' }
    })

    expect(parsed.instructions.inline).toBe('Repo-wide guidance')
  })
})

// Spec 15, Mechanism 2. The block ships WITH its behaviour, off by default, and
// refuses the one shape that would be a switch that lies: on, with nothing to read.
describe('security.signals', () => {
  test('is off by default and configures no artifact', () => {
    const parsed = CodeReviewerConfigSchema.parse({})

    expect(parsed.security.signals.enabled).toBe(false)
    expect(parsed.security.signals.artifacts).toEqual([])
    expect(parsed.security.signals.maxArtifactBytes).toBe(4_000_000)
    expect(parsed.security.signals.maxAlerts).toBe(40)
  })

  test('accepts an enabled block with a repository-relative artifact', () => {
    const parsed = CodeReviewerConfigSchema.parse({
      security: {
        signals: {
          enabled: true,
          artifacts: [{ path: 'reports/analyzer.sarif.json' }]
        }
      }
    })

    expect(parsed.security.signals.artifacts[0]).toEqual({
      path: 'reports/analyzer.sarif.json',
      format: 'sarif'
    })
  })

  test('rejects enabling the block with no artifact to read', () => {
    expect(() =>
      CodeReviewerConfigSchema.parse({
        security: { signals: { enabled: true } }
      })
    ).toThrow(/no artifacts are configured/u)
  })

  test('rejects an artifact path that traverses above the repository', () => {
    expect(() =>
      CodeReviewerConfigSchema.parse({
        security: {
          signals: {
            enabled: true,
            artifacts: [{ path: '../outside/analyzer.sarif.json' }]
          }
        }
      })
    ).toThrow(/traverse above root/u)
  })

  test('rejects an unknown artifact format', () => {
    expect(() =>
      CodeReviewerConfigSchema.parse({
        security: {
          signals: {
            enabled: true,
            artifacts: [{ path: 'reports/a.json', format: 'json' }]
          }
        }
      })
    ).toThrow()
  })
})
