import type { Logger } from '@purista/harness'
import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../../../../shared/contracts/index.js'
import { createNoContentEventRecorder } from '../../../observability/index.js'
import { prepareReviewRunnerRunObservability } from './run-observability.js'

type CapturedLogRecord = {
  readonly level: string
  readonly message: string
  readonly fields?: Record<string, unknown>
}

const createCapturingLogger = (): {
  readonly logger: Logger
  readonly records: CapturedLogRecord[]
  readonly childBindings: Record<string, unknown>[]
} => {
  const records: CapturedLogRecord[] = []
  const childBindings: Record<string, unknown>[] = []
  const capture =
    (level: string) =>
    (message: string, fields?: Record<string, unknown>): void => {
      records.push({ level, message, ...(fields === undefined ? {} : { fields }) })
    }

  const logger: Logger = {
    trace: capture('trace'),
    debug: capture('debug'),
    info: capture('info'),
    warn: capture('warn'),
    error: capture('error'),
    fatal: capture('fatal'),
    child: (bindings) => {
      childBindings.push(bindings)
      return logger
    }
  }

  return { logger, records, childBindings }
}

describe('review runner run observability', () => {
  test('starts run observability and scopes start logging with safe provider metadata', () => {
    const observability = createNoContentEventRecorder()
    const { logger, records, childBindings } = createCapturingLogger()
    const config = CodeReviewerConfigSchema.parse({
      provider: {
        id: 'openai',
        model: 'review-model'
      },
      review: {
        mode: 'pr',
        depth: 'thorough'
      }
    })

    const state = prepareReviewRunnerRunObservability({
      runId: 'run_observability',
      configHash: 'abc123',
      config,
      observability,
      logger
    })

    expect(state.observability).toBe(observability)
    expect(state.logger).toBe(logger)
    expect(childBindings).toEqual([{ run_id: 'run_observability' }])
    expect(records).toEqual([
      {
        level: 'info',
        message: 'Review run started.',
        fields: {
          mode: 'pr',
          depth: 'thorough',
          provider_configured: true
        }
      }
    ])
    expect(observability.snapshot().events).toMatchObject([
      {
        type: 'run-started',
        attributes: {
          runId: 'run_observability',
          mode: 'pr',
          depth: 'thorough',
          configHash: 'abc123',
          providerId: 'openai',
          modelName: 'review-model'
        }
      }
    ])
  })

  test('creates default no-content observability and noop logging when not injected', () => {
    const config = CodeReviewerConfigSchema.parse({})

    const state = prepareReviewRunnerRunObservability({
      runId: 'run_default_observability',
      configHash: 'def456',
      config
    })

    expect(state.observability.snapshot().events).toMatchObject([
      {
        type: 'run-started',
        attributes: {
          runId: 'run_default_observability',
          mode: 'local',
          depth: 'balanced',
          configHash: 'def456'
        }
      }
    ])
  })
})
