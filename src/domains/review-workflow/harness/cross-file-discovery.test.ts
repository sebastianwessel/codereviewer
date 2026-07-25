import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import type {
  JsonValue,
  ModelProvider,
  ObjectRequest,
  ObjectResponse
} from '@purista/harness'
import { runModelBackedReviewWorkflow } from './session.js'
import { createModelBackedReviewHarness } from './model-backed-harness.js'

const configHash =
  '9999999999999999999999999999999999999999999999999999999999999999'

// A provider that, on its first call, asks to read an unchanged dependency file,
// then reports a finding that depends on what that file contained. This is the
// cross-file shape spec 16 targets: the defect is only decidable after reading a
// definition outside the changed set.
class CrossFileReadingProvider implements ModelProvider {
  readonly id = 'cross-file'
  readonly genAiSystem = 'scripted'
  readonly toolCalls: { readonly name: string; readonly input: JsonValue }[] = []
  readonly toolResultContents: string[] = []
  readonly offeredToolNames: string[][] = []
  private calls = 0

  toolsOffered(): boolean {
    return (this.offeredToolNames.at(-1) ?? []).includes('repo_read')
  }

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.calls += 1
    this.offeredToolNames.push(
      ((req as unknown as { readonly tools?: readonly { readonly name: string }[] })
        .tools ?? []).map((tool) => tool.name)
    )

    // Capture any tool result the harness fed back so the test can assert the
    // mediated content actually reached the model.
    for (const message of req.messages ?? []) {
      const record = message as unknown as {
        readonly role?: string
        readonly content?: unknown
      }
      if (record.role === 'tool' && typeof record.content === 'string') {
        this.toolResultContents.push(record.content)
      }
    }

    const hasToolResult = this.toolResultContents.length > 0

    if (!hasToolResult && this.calls === 1 && this.toolsOffered()) {
      this.toolCalls.push({ name: 'repo_read', input: { path: 'src/dep.ts' } })

      return {
        object: {} as unknown as T,
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: 'call_1',
            name: 'repo_read',
            arguments: { path: 'src/dep.ts' }
          }
        ],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
      } as unknown as ObjectResponse<T>
    }

    return {
      object: {
        findings: [
          {
            category: 'bug',
            severity: 'high',
            title: 'Caller ignores the sentinel the callee returns',
            description:
              'src/dep.ts returns -1 on lookup failure, but the changed caller treats every return value as a valid index.',
            path: 'src/app.ts',
            startLine: 1
          }
        ]
      } as unknown as T,
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
    }
  }
}

const createRepositoryFixture = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'crossfile-'))
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(
    path.join(root, 'src', 'app.ts'),
    'export const run = (): number => lookup()\n',
    'utf8'
  )
  await writeFile(
    path.join(root, 'src', 'dep.ts'),
    'export const lookup = (): number => -1\n',
    'utf8'
  )

  return root
}

const workflowInputFor = (repositoryRoot: string) =>
  ({
    runId: 'cross-file-run',
    repositoryRoot,
    reviewedPaths: ['src/app.ts'],
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
  }) as unknown as Parameters<typeof runModelBackedReviewWorkflow>[0]['input']

describe('agentic cross-file discovery (spec 16)', () => {
  test('lets discovery read an unchanged file through the mediated tools when enabled', async () => {
    const repositoryRoot = await createRepositoryFixture()
    const provider = new CrossFileReadingProvider()
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider,
        model: 'scripted',
        capabilities: ['object', 'tool_use']
      },
      crossFileRetrieval: {
        enabled: true,
        maxToolCallsPerTask: 4,
        maxBytesPerRead: 24000
      }
    })

    const result = await runModelBackedReviewWorkflow({
      harness,
      sessionId: 'cross-file-enabled',
      input: workflowInputFor(repositoryRoot)
    })

    // The model asked for a file outside the changed set and the mediated tool
    // returned its line-numbered content.
    expect(provider.offeredToolNames[0]).toEqual([
      'repo_read',
      'repo_list',
      'repo_grep'
    ])
    expect(provider.toolCalls).toEqual([
      { name: 'repo_read', input: { path: 'src/dep.ts' } }
    ])
    expect(provider.toolResultContents.join('\n')).toContain(
      'export const lookup'
    )
    // The resulting candidate still went through the normal pipeline.
    expect(result.candidateFindings.length).toBeGreaterThan(0)
  })

  test('exposes no tools to discovery when cross-file retrieval is disabled', async () => {
    const repositoryRoot = await createRepositoryFixture()
    const provider = new CrossFileReadingProvider()
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider,
        model: 'scripted',
        capabilities: ['object', 'tool_use']
      }
    })

    await runModelBackedReviewWorkflow({
      harness,
      sessionId: 'cross-file-disabled',
      input: workflowInputFor(repositoryRoot)
    })

    // Disabled: the discovery agent is offered no tools at all, so no repository
    // read can happen from the discovery lane.
    expect(provider.offeredToolNames.flat()).toEqual([])
    expect(provider.toolResultContents).toEqual([])
  })
})
