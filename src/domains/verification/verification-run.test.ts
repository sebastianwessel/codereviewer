import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type {
  JsonValue,
  ModelProvider,
  ObjectRequest,
  ObjectResponse
} from '@purista/harness'
import { CodeReviewerConfigSchema } from '../../shared/contracts/index.js'
import { runVerificationRun } from './verification-run.js'

const baseConfig = (overrides: Record<string, unknown>) =>
  CodeReviewerConfigSchema.parse(overrides)

const claim = {
  id: 'claim_run1',
  kind: 'prior-finding',
  title: 'insecure call',
  detail: 'a prior review reported an insecure call in src/a.ts',
  location: { path: 'src/a.ts', startLine: 1, side: 'file' },
  source: 'prior-finding',
  question: 'does the insecure call still exist?'
}

// A minimal fake provider that concludes immediately with a verdict — enough to
// drive runVerificationRun's success path (provider resolution, the harness
// agent, and usage/cost accounting) without a network call.
const verdictProvider: ModelProvider = {
  id: 'openai',
  genAiSystem: 'openai',
  object: async <T extends JsonValue = JsonValue>(
    _request: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> => ({
    object: {
      status: 'confirmed',
      rationale: 'the reported insecure call is still present',
      citedEvidenceIds: []
    } as unknown as T,
    finishReason: 'stop',
    usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 }
  })
}

describe('runVerificationRun', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'verification-run-'))
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'src', 'a.ts'), 'eval(userInput)\n')
    await mkdir(path.join(root, '.codereviewer'), { recursive: true })
    await writeFile(
      path.join(root, '.codereviewer', 'claims.json'),
      JSON.stringify([claim])
    )
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('returns an empty report when verification is disabled', async () => {
    const result = await runVerificationRun({
      config: baseConfig({}),
      repositoryRoot: root,
      environment: {}
    })
    expect(result.report.verdicts).toHaveLength(0)
    expect(result.claims).toHaveLength(0)
  })

  test('returns an empty report when enabled with no configured providers', async () => {
    const result = await runVerificationRun({
      config: baseConfig({ verification: { enabled: true, providers: [] } }),
      repositoryRoot: root,
      environment: {}
    })
    expect(result.report.verdicts).toHaveLength(0)
    expect(result.claims).toHaveLength(0)
  })

  test('returns an empty report when enabled but no provider is configured', async () => {
    const result = await runVerificationRun({
      config: baseConfig({
        verification: {
          enabled: true,
          providers: [{ type: 'claims-file', path: '.codereviewer/claims.json' }]
        }
      }),
      repositoryRoot: root,
      environment: {}
    })
    expect(result.report.verdicts).toHaveLength(0)
    expect(result.report.usage).toBeUndefined()
  })

  test('is non-fatal when the provider cannot be resolved', async () => {
    const result = await runVerificationRun({
      config: baseConfig({
        provider: { id: 'openai', model: 'gpt-x' },
        verification: {
          enabled: true,
          providers: [{ type: 'claims-file', path: '.codereviewer/claims.json' }]
        }
      }),
      repositoryRoot: root,
      environment: { OPENAI_API_KEY: 'sk-test' },
      providerImport: async () => {
        throw new Error('adapter not installed')
      }
    })
    expect(result.report.verdicts).toHaveLength(0)
  })

  test('runs the flow and accounts token usage on the success path', async () => {
    const result = await runVerificationRun({
      config: baseConfig({
        provider: { id: 'openai', model: 'gpt-x' },
        costs: { inputPerMillion: 1, outputPerMillion: 2 },
        verification: {
          enabled: true,
          providers: [{ type: 'claims-file', path: '.codereviewer/claims.json' }],
          maxToolCallsPerClaim: 3
        }
      }),
      repositoryRoot: root,
      environment: { OPENAI_API_KEY: 'sk-test' },
      providerImport: async () => ({ openai: () => verdictProvider })
    })

    expect(result.report.verdicts).toHaveLength(1)
    expect(result.report.verdicts[0]?.claimId).toBe('claim_run1')
    // Verification model spend is accounted in the report (not dropped).
    expect(result.report.usage?.inputTokens).toBeGreaterThan(0)
    expect(result.report.usage?.costUsd).toBeGreaterThan(0)
    expect(result.claims).toHaveLength(1)
  })
})
