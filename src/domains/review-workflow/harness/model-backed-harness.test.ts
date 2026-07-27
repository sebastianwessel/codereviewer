import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
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
  modelFindingRefuterInstructions,
  modelHolisticReviewerInstructions,
  modelSemanticMergeInstructions
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

// Spec 21: a sample answers with a marker no other sample could have produced, so
// a marker reaching a later request could only have come from an earlier sample's
// output. This runs through the real harness on purpose: independence is a
// property of how the agent is invoked, and only the provider boundary can show
// whether an invocation carried anything over from the one before it.
class MarkedFindingProvider implements ModelProvider {
  readonly id = 'marked'
  readonly genAiSystem = 'scripted'
  readonly requests: ObjectRequest[] = []
  private sample = 0

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requests.push(req)
    this.sample += 1

    return {
      object: {
        findings: [
          {
            category: 'bug',
            severity: 'high',
            title: `SAMPLE-MARKER-${this.sample}`,
            description: `SAMPLE-MARKER-${this.sample} was raised by one sample only.`,
            path: 'src/model-backed.ts',
            startLine: this.sample
          }
        ]
      } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    }
  }
}

describe('independent discovery samples at the provider boundary', () => {
  test('no request ever carries a marker an earlier sample answered with', async () => {
    const provider = new MarkedFindingProvider()
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider,
        model: 'scripted',
        capabilities: ['object', 'tool_use']
      }
    })

    await runModelBackedReviewWorkflow({
      harness,
      sessionId: 'sampling-blindness',
      input: {
        runId: 'sampling-run',
        reviewedPaths: ['src/model-backed.ts'],
        discoverySampleCount: 3,
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

    const discoveryRequests = provider.requests.filter((request) =>
      messagesOfRole(request, 'system').some((instruction) =>
        instruction.startsWith(modelHolisticReviewerInstructions)
      )
    )

    expect(discoveryRequests).toHaveLength(3)

    for (const request of discoveryRequests) {
      const serialized = JSON.stringify(request.messages)

      expect(serialized).not.toContain('SAMPLE-MARKER-')
    }

    // Identical packets are the same statement from the other side: nothing that
    // varies between samples reached any of them.
    expect(
      new Set(
        discoveryRequests.map((request) =>
          messagesOfRole(request, 'user').join('\n')
        )
      ).size
    ).toBe(1)
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

// Spec 21, Conversation History: NO stage forwards prior conversation.
//
// The whole review runs in one session and the harness appends every completed
// agent call's output to it, so without `historyWindow: 0` a call is handed the
// JSON output of every call that finished before it — across tasks and across
// stages — as `assistant` messages, i.e. attributed to the model itself. The
// refuter would then open its call appearing to have already asserted the
// candidates it must adjudicate, and holding its own verdicts for other tasks.
//
// This is asserted at the provider boundary and nowhere else, because carrying
// history is a property of how the harness invokes an agent, not of anything this
// codebase's own modules can observe.
const REVIEW_AGENT_STAGES = {
  semantic_merge: modelSemanticMergeInstructions,
  refute_finding: modelFindingRefuterInstructions,
  holistic_review: modelHolisticReviewerInstructions
} as const

type ReviewAgentStage = keyof typeof REVIEW_AGENT_STAGES

// Longest instruction prefix wins, so a stage whose prompt happens to start with
// another's is still attributed to the right agent.
const stageOfRequest = (request: ObjectRequest): ReviewAgentStage | 'unknown' => {
  const system = messagesOfRole(request, 'system').join('\n')

  return (
    (Object.entries(REVIEW_AGENT_STAGES) as readonly [
      ReviewAgentStage,
      string
    ][])
      .filter(([, instructions]) => system.startsWith(instructions))
      .sort(([, left], [, right]) => right.length - left.length)[0]?.[0] ??
    'unknown'
  )
}

// Every stage answers with a marker no other call could have produced, so a marker
// appearing in a later request could only have arrived through the session's
// conversation.
class MarkedEveryStageProvider implements ModelProvider {
  readonly id = 'marked-stages'
  readonly genAiSystem = 'scripted'
  readonly requests: ObjectRequest[] = []
  private call = 0

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    const request = req as unknown as ObjectRequest
    this.requests.push(request)
    this.call += 1
    const stage = stageOfRequest(request)
    const marker = `${stage.toUpperCase()}-MARKER-${this.call}`
    const userText = messagesOfRole(request, 'user').join('\n')

    const object = ((): unknown => {
      switch (stage) {
        case 'semantic_merge':
          return { groups: [] }
        case 'refute_finding':
          return {
            verdicts: [...userText.matchAll(/"id":"(cand_[a-z0-9]+)"/gu)].map(
              (match) => ({
                candidateId: match[1],
                verdict: 'proved',
                rationaleSummary: `${marker}: the provided context proves it.`
              })
            )
          }
        default: {
          // Two findings on one file, so the semantic merge has something to
          // merge and actually issues a call.
          const filePath = userText.includes('src/b.ts') ? 'src/b.ts' : 'src/a.ts'

          return {
            findings: [1, 2].map((ordinal) => ({
              category: 'bug',
              severity: ordinal === 1 ? 'high' : 'medium',
              title: `${marker}-${ordinal}`,
              description: `${marker}-${ordinal} describes a concrete defect.`,
              path: filePath,
              startLine: ordinal
            }))
          }
        }
      }
    })()

    return {
      object: object as T,
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
    }
  }
}

const createHistoryFixtureRepository = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'review-history-'))
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(
    path.join(root, 'src', 'a.ts'),
    'export const a = (): number => lookup()\n',
    'utf8'
  )
  await writeFile(
    path.join(root, 'src', 'b.ts'),
    'export const b = (): number => lookup()\n',
    'utf8'
  )
  return root
}

describe('conversation history at the provider boundary', () => {
  test('no stage receives the output of any earlier call in the session', async () => {
    const repositoryRoot = await createHistoryFixtureRepository()
    const provider = new MarkedEveryStageProvider()
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider,
        model: 'scripted',
        capabilities: ['object', 'tool_use']
      },
      // One task at a time, so the call order is deterministic and a request that
      // carried history would carry a known set of earlier answers.
      maxConcurrentTasks: 1
    })

    await runModelBackedReviewWorkflow({
      harness,
      sessionId: 'review',
      input: {
        runId: 'history-run',
        repositoryRoot,
        // Two tasks and two candidates per file: this is the shape that made the
        // leak visible — later tasks and later stages are the ones that had
        // something to inherit.
        reviewedPaths: ['src/a.ts', 'src/b.ts'],
        maxConcurrentTasks: 1,
        reviewContext: [
          {
            kind: 'file',
            path: 'src/a.ts',
            content: 'export const a = (): number => lookup()\n',
            ledgerEntryId: 'ctx_a'
          },
          {
            kind: 'file',
            path: 'src/b.ts',
            content: 'export const b = (): number => lookup()\n',
            ledgerEntryId: 'ctx_b'
          }
        ],
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
        qualityGate: { maxHigh: 0 }
      }
    })
    await harness.shutdown()

    // The run genuinely exercised all three stages; otherwise this test would pass
    // by never issuing the calls that could have inherited anything.
    const stages = provider.requests.map(stageOfRequest)
    expect(new Set(stages)).toEqual(
      new Set(['holistic_review', 'semantic_merge', 'refute_finding'])
    )
    // And more than one call per stage, so a later call of each stage existed to
    // inherit an earlier one's answer.
    for (const stage of Object.keys(REVIEW_AGENT_STAGES)) {
      expect(stages.filter((entry) => entry === stage).length).toBeGreaterThan(1)
    }

    for (const request of provider.requests) {
      // The decisive assertion: conversation can only arrive as `assistant` or
      // `tool` messages, so exactly one system message and one user packet means
      // nothing was forwarded.
      expect(request.messages.map((message) => message.role)).toEqual([
        'system',
        'user'
      ])

      const serialized = JSON.stringify(request.messages)

      // Belt and braces on the packet itself. A refuter's verdicts are consumed
      // in code and never travel in any later packet, so the marker appearing
      // anywhere could only have come from the session.
      expect(serialized).not.toContain('REFUTE_FINDING-MARKER-')

      // Discovery's findings legitimately travel onward as candidates, so they are
      // only checked on the stages whose packets never carry candidates.
      if (stageOfRequest(request) === 'holistic_review') {
        expect(serialized).not.toContain('HOLISTIC_REVIEW-MARKER-')
      }
    }
  })
})
