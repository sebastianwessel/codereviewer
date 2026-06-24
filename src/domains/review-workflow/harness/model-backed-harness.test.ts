import { describe, expect, test } from 'vitest'
import type {
  JsonValue,
  ModelProvider,
  ObjectRequest,
  ObjectResponse
} from '@purista/harness'
import { runModelBackedReviewWorkflow } from './session.js'
import { createModelBackedReviewHarness } from './model-backed-harness.js'

class EmptyFindingProvider implements ModelProvider {
  readonly id = 'empty'
  readonly genAiSystem = 'scripted'
  readonly requests: ObjectRequest[] = []

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requests.push(req)

    return {
      object: { findings: [] } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    }
  }
}

const configHash =
  '9999999999999999999999999999999999999999999999999999999999999999'

describe('model-backed harness', () => {
  test('wires provider-backed review agents through the shared workflow handler', async () => {
    const provider = new EmptyFindingProvider()
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider,
        model: 'scripted',
        capabilities: ['object', 'tool_use']
      }
    })

    const result = await runModelBackedReviewWorkflow({
      harness,
      sessionId: 'model-backed-test',
      input: {
        runId: 'model-backed-run',
        reviewedPaths: ['src/model-backed.ts'],
        evidence: [],
        candidates: [],
        instructions: [],
        skills: [],
        baselineConfigured: false,
        provenance: {
          reviewer: 'review-agent',
          signalVersions: {},
          configHash
        },
        qualityGate: {
          maxHigh: 0
        }
      }
    })

    expect(result.admittedFindings).toEqual([])
    expect(result.providerIssues).toEqual([])
    expect(result.qualityGate.passed).toBe(true)
    expect(provider.requests.length).toBeGreaterThan(0)

    await harness.shutdown()
  })
})
