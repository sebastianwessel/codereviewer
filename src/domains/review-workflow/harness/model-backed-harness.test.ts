import { describe, expect, test } from 'vitest'
import type {
  JsonValue,
  ModelProvider,
  ObjectRequest,
  ObjectResponse
} from '@purista/harness'
import type { DiscoveryPosture } from '../../../shared/contracts/index.js'
import {
  investigativeDiscoveryPostureInstructions,
  modelHolisticReviewerInstructions
} from '../pipeline/agent-instructions.js'
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

// The requests a whole review actually put on the wire, for one harness
// configuration. Going through the real harness rather than a stubbed runner is
// the point: the properties spec 20 protects — how many calls are made and what
// each packet looks like — are only observable at the provider boundary.
const providerRequestsForPosture = async (
  posture: DiscoveryPosture
): Promise<readonly ObjectRequest[]> => {
  const provider = new EmptyFindingProvider()
  const harness = createModelBackedReviewHarness({
    modelAlias: {
      provider,
      model: 'scripted',
      capabilities: ['object', 'tool_use']
    },
    discoveryPosture: posture
  })

  await runModelBackedReviewWorkflow({
    harness,
    sessionId: `posture-${posture}`,
    input: {
      runId: 'posture-run',
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
  await harness.shutdown()

  return provider.requests
}

const messagesOfRole = (
  request: ObjectRequest,
  role: 'system' | 'user'
): readonly string[] =>
  request.messages.flatMap((message) =>
    message.role === role && typeof message.content === 'string'
      ? [message.content]
      : []
  )

describe('discovery posture at the provider boundary', () => {
  test('changes the instructions only, never the call count or the packet', async () => {
    const [precise, investigative] = await Promise.all([
      providerRequestsForPosture('precise'),
      providerRequestsForPosture('investigative')
    ])

    // Spec 20: the posture adds no model calls.
    expect(investigative).toHaveLength(precise.length)
    expect(precise.length).toBeGreaterThan(0)

    for (const [index, preciseRequest] of precise.entries()) {
      const investigativeRequest = investigative[index]!

      // The packet is a JSON string, so comparing it as a string compares its
      // field ORDER as well as its content — which is what a prompt cache sees.
      expect(messagesOfRole(investigativeRequest, 'user')).toEqual(
        messagesOfRole(preciseRequest, 'user')
      )

      // The only difference is the appended posture, and it is appended: the
      // precise instructions remain an exact leading prefix.
      for (const [systemIndex, preciseSystem] of messagesOfRole(
        preciseRequest,
        'system'
      ).entries()) {
        const investigativeSystem = messagesOfRole(
          investigativeRequest,
          'system'
        )[systemIndex]!

        expect(investigativeSystem.startsWith(preciseSystem)).toBe(true)
        expect(
          investigativeSystem === preciseSystem ||
            investigativeSystem ===
              `${preciseSystem}\n${investigativeDiscoveryPostureInstructions}`
        ).toBe(true)
      }
    }

    // And the default path is the prompt that exists today.
    expect(
      precise.some((request) =>
        messagesOfRole(request, 'system').includes(
          modelHolisticReviewerInstructions
        )
      )
    ).toBe(true)
  })
})
