import { describe, expect, test } from 'vitest'
import {
  CodeReviewerConfigSchema,
  type CodeReviewerConfig
} from '../../shared/contracts/index.js'
import { createNoContentEventRecorder } from '../observability/index.js'
import type { DriftCheckResult } from '../drift/index.js'
import { runReviewRunnerPreflight } from './review-runner-preflight.js'

const passedDrift = {
  passed: true,
  warningCount: 1,
  errorCount: 0,
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
  debug: () => {}
}

const configFor = (input: {
  readonly openTelemetryEnabled: boolean
}): CodeReviewerConfig =>
  CodeReviewerConfigSchema.parse({
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
        attributes: { enabled: true }
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
