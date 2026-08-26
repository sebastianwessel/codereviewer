import { describe, expect, test } from 'vitest'
import {
  CodeReviewerConfigSchema,
  type CodeReviewerConfig
} from '../../../shared/contracts/index.js'
import { createNoContentEventRecorder } from '../../observability/index.js'
import type { DriftCheckResult } from '../../drift/index.js'
import { runReviewRunnerPreflight } from './preflight.js'

const passedDrift = {
  passed: true,
  warningCount: 1,
  errorCount: 0,
  generatedArtifactStatus: 'compared',
  scanCoverageStatus: 'scanned',
  scannedFileCount: 1,
  absentScanRoots: [],
  findings: [
    {
      id: 'docs-warning',
      category: 'documentation-drift',
      gate: 'warning',
      path: 'docs/example.md',
      message: 'Documentation warning.',
      evidence: 'docs',
      recommendation: 'Update docs.'
    }
  ]
} satisfies DriftCheckResult

const failedDrift = {
  passed: false,
  warningCount: 0,
  errorCount: 1,
  generatedArtifactStatus: 'compared',
  scanCoverageStatus: 'scanned',
  scannedFileCount: 1,
  absentScanRoots: [],
  findings: [
    {
      id: 'security-error',
      category: 'security-drift',
      gate: 'error',
      path: 'README.md',
      message: 'Security drift.',
      evidence: 'legacy artifact path',
      recommendation: 'Use .codereviewer.'
    }
  ]
} satisfies DriftCheckResult

const logger = {
  debug: () => {},
  warn: () => {}
}

// Carries a provider because these two cases are about drift and telemetry: a
// configuration that asks for a model review without one is refused by the first
// check in preflight, and every later assertion would then be unreachable.
const configFor = (input: {
  readonly openTelemetryEnabled: boolean
}): CodeReviewerConfig =>
  CodeReviewerConfigSchema.parse({
    provider: { id: 'openai', model: 'review-model' },
    observability: {
      openTelemetry: input.openTelemetryEnabled
        ? {
            enabled: true,
            endpoint: 'https://otel.example.test',
            serviceName: 'codereviewer-test'
          }
        : {
            enabled: false
          }
    }
  })

describe('review runner preflight', () => {
  test('refuses a run asked for a model review with no provider, before any work', async () => {
    const observability = createNoContentEventRecorder()
    let driftChecked = false

    await expect(
      runReviewRunnerPreflight({
        repositoryRoot: '/repo/project',
        // The SHIPPED DEFAULT: `aiReview.enabled` defaults true and `provider`
        // defaults undefined, so this is what an unconfigured repository runs.
        config: CodeReviewerConfigSchema.parse({}),
        observability,
        logger,
        runDriftCheck: async () => {
          driftChecked = true

          return passedDrift
        }
      })
    ).rejects.toMatchObject({
      code: 'model_review_provider_missing',
      category: 'config',
      exitCode: 2
    })
    // Both remedies, named: a message that only states the contradiction leaves
    // the operator to guess which half of it they meant.
    await expect(
      runReviewRunnerPreflight({
        repositoryRoot: '/repo/project',
        config: CodeReviewerConfigSchema.parse({}),
        observability,
        logger,
        runDriftCheck: async () => passedDrift
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining('aiReview.enabled') as unknown as string
    })
    // Refused before the run does anything: no drift scan, and no step recorded
    // that would suggest a review had started.
    expect(driftChecked).toBe(false)
    expect(observability.snapshot().events).toEqual([])
  })

  test('runs a deliberately deterministic-only review that has no provider', async () => {
    const observability = createNoContentEventRecorder()

    const result = await runReviewRunnerPreflight({
      repositoryRoot: '/repo/project',
      // `aiReview.enabled: false` is the operator switching the model review
      // off. It is NOT the refused case: nobody can be surprised by the absence
      // of a search they turned off, and the report discloses it.
      config: CodeReviewerConfigSchema.parse({ aiReview: { enabled: false } }),
      observability,
      logger,
      runDriftCheck: async () => passedDrift
    })

    expect(result.drift).toBe(passedDrift)
  })

  test('runs drift check and optional telemetry setup with safe step metrics', async () => {
    const observability = createNoContentEventRecorder()
    const configuredTelemetry: CodeReviewerConfig['observability']['openTelemetry'][] = []

    const result = await runReviewRunnerPreflight({
      repositoryRoot: '/repo/project',
      config: configFor({ openTelemetryEnabled: true }),
      observability,
      logger,
      runDriftCheck: async () => passedDrift,
      configureOpenTelemetry: async ({ config }) => {
        configuredTelemetry.push(config)
        return {
          enabled: true,
          endpoint: 'https://otel.example.test',
          serviceName: 'codereviewer-test'
        }
      }
    })

    expect(result.drift).toBe(passedDrift)
    expect(configuredTelemetry).toHaveLength(1)
    expect(
      observability
        .snapshot()
        .events.filter((event) => event.type === 'step-ended')
        .map((event) => ({
          step: event.step,
          attributes: event.attributes
        }))
    ).toEqual([
      {
        step: 'drift_check',
        attributes: {
          passed: true,
          errorCount: 0,
          warningCount: 1
        }
      },
      {
        step: 'opentelemetry_setup',
        // Not `{ enabled: true }`. The step proves the packages are installed; it
        // does not export a span, and the attributes must not imply it did.
        attributes: { dependenciesPresent: true, spansExported: false }
      }
    ])
  })

  test('throws drift gate errors before telemetry setup when hard drift fails', async () => {
    const observability = createNoContentEventRecorder()
    let telemetryConfigured = false

    await expect(
      runReviewRunnerPreflight({
        repositoryRoot: '/repo/project',
        config: configFor({ openTelemetryEnabled: true }),
        observability,
        logger,
        runDriftCheck: async () => failedDrift,
        configureOpenTelemetry: async () => {
          telemetryConfigured = true
          return {
            enabled: true,
            endpoint: 'https://otel.example.test',
            serviceName: 'codereviewer-test'
          }
        }
      })
    ).rejects.toMatchObject({
      code: 'drift_gate_failed',
      details: {
        errorCount: 1,
        warningCount: 0
      }
    })
    expect(telemetryConfigured).toBe(false)
  })
})
