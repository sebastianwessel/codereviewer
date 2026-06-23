import { describe, expect, test } from 'vitest'
import type {
  JsonValue,
  Logger,
  ModelProvider,
  ObjectRequest,
  ObjectResponse
} from '@purista/harness'
import { CodeReviewerConfigSchema } from '../../shared/contracts/index.js'
import { createNoContentEventRecorder } from '../observability/index.js'
import { ReviewWorkflowInputSchema } from './workflow-contracts.js'
import { runProviderWorkflow } from './review-runner-provider-workflow.js'

class UsageRecordingProvider implements ModelProvider {
  readonly id = 'usage-recording'
  readonly genAiSystem = 'scripted'
  readonly requests: ObjectRequest[] = []

  async object<T extends JsonValue = JsonValue>(
    request: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requests.push(request)

    return {
      object: { suspicions: [] } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 11,
        outputTokens: 7,
        totalTokens: 18
      }
    }
  }
}

const configHash =
  '7777777777777777777777777777777777777777777777777777777777777777'

type CapturedLogRecord = {
  readonly message: string
  readonly fields?: Record<string, unknown>
}

const createDebugLogger = (): {
  readonly logger: Logger
  readonly records: CapturedLogRecord[]
} => {
  const records: CapturedLogRecord[] = []
  const logger: Logger = {
    trace: () => {},
    debug: (message, fields) => {
      records.push({ message, ...(fields === undefined ? {} : { fields }) })
    },
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: () => logger
  }

  return { logger, records }
}

describe('review runner provider workflow', () => {
  test('resolves the provider, invokes the model-backed harness, and returns token usage', async () => {
    const provider = new UsageRecordingProvider()
    const importedSpecifiers: string[] = []
    const observability = createNoContentEventRecorder()
    const { logger, records } = createDebugLogger()
    const config = CodeReviewerConfigSchema.parse({
      provider: {
        id: 'openai',
        model: 'gpt-5-mini'
      },
      review: {
        maxConcurrentTasks: 1
      }
    })

    const result = await runProviderWorkflow({
      workflowInput: ReviewWorkflowInputSchema.parse({
        runId: 'run-provider-boundary',
        reviewedPaths: ['src/app.ts'],
        evidence: [],
        candidates: [],
        instructions: [],
        skills: [],
        provenance: {
          reviewer: 'review-agent',
          signalVersions: {},
          configHash
        },
        baselineConfigured: false,
        qualityGate: {
          maxHigh: 0
        }
      }),
      config,
      environment: {
        OPENAI_API_KEY: 'test-key'
      },
      providerImport: async (specifier) => {
        importedSpecifiers.push(specifier)

        return {
          openai: () => provider
        }
      },
      skillDefinitions: {},
      skillIds: [],
      observability,
      logger
    })

    expect(importedSpecifiers).toEqual(['@purista/harness-openai'])
    expect(provider.requests.length).toBeGreaterThan(0)
    expect(result?.usage).toEqual({
      inputTokens: 11 * provider.requests.length,
      outputTokens: 7 * provider.requests.length
    })
    expect(result?.output.admittedFindings).toEqual([])
    expect(result?.output.qualityGate.passed).toBe(true)
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
        step: 'provider_workflow',
        attributes: {}
      }
    ])
    expect(records).toContainEqual({
      message: 'Provider workflow step completed.',
      fields: {
        input_tokens: 11 * provider.requests.length,
        output_tokens: 7 * provider.requests.length
      }
    })
  })

  test('skips the provider workflow when provider review is disabled', async () => {
    const config = CodeReviewerConfigSchema.parse({
      provider: {
        id: 'openai',
        model: 'gpt-5-mini'
      },
      aiReview: {
        enabled: false
      }
    })

    await expect(
      runProviderWorkflow({
        workflowInput: ReviewWorkflowInputSchema.parse({
          runId: 'run-provider-disabled',
          reviewedPaths: ['src/app.ts'],
          evidence: [],
          candidates: [],
          instructions: [],
          skills: [],
          provenance: {
            reviewer: 'review-agent',
            signalVersions: {},
            configHash
          },
          baselineConfigured: false
        }),
        config,
        environment: {},
        skillDefinitions: {},
        skillIds: []
      })
    ).resolves.toBeUndefined()
  })
})
