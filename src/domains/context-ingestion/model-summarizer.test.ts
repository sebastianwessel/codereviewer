import { describe, expect, test, vi } from 'vitest'
import type { ModelAlias } from '@purista/harness'
import { createModelSummarizer, summarizerInstructions } from './model-summarizer.js'
import { createDigestSummarizer } from './digest-summarizer.js'
import { runContextIngestion } from './ingest.js'
import type { ContextFragment } from './contracts.js'

const fragment: ContextFragment = {
  origin: 'inbox:jira/PROJ-1',
  kind: 'inbox',
  title: 'Reject expired tokens',
  body: 'Reject tokens older than five minutes.',
  metadata: {}
}

const modelAliasWith = (
  object: ModelAlias['provider']['object']
): ModelAlias =>
  ({
    model: 'gpt-x',
    provider: { id: 'stub', genAiSystem: 'stub', object }
  }) as unknown as ModelAlias

describe('summarizer instructions', () => {
  test('forbid broadening scope or asserting approval', () => {
    // The summarizer must not launder "available to team X" into "make public"
    // or claim the change is safe/approved — that would let a weak ticket hide a
    // security defect from the reviewer.
    expect(summarizerInstructions).toContain('do not broaden')
    expect(summarizerInstructions).toContain('never restate')
    expect(summarizerInstructions).toContain('safe, correct, approved')
    expect(summarizerInstructions).toContain('do not infer requirements')
  })
})

describe('model summarizer', () => {
  test('calls the provider and reports usage', async () => {
    const onUsage = vi.fn()
    const object = vi.fn(async () => ({
      object: { brief: 'Intent: reject expired tokens.' },
      usage: { inputTokens: 40, outputTokens: 12 }
    }))

    const summarizer = createModelSummarizer({
      modelAlias: modelAliasWith(object as never),
      onUsage
    })
    const brief = await summarizer.summarize([fragment], { maxBytes: 4000 })

    expect(brief.mode).toBe('model')
    expect(brief.text).toBe('Intent: reject expired tokens.')
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ inputTokens: 40, outputTokens: 12 })
    )
    // The provider is called with a schema and no tools.
    expect(object).toHaveBeenCalledTimes(1)
  })

  test('truncates the brief to the byte cap', async () => {
    const object = vi.fn(async () => ({
      object: { brief: 'x'.repeat(500) },
      usage: { inputTokens: 10, outputTokens: 200 }
    }))

    const brief = await createModelSummarizer({
      modelAlias: modelAliasWith(object as never)
    }).summarize([fragment], { maxBytes: 50 })

    expect(Buffer.byteLength(brief.text, 'utf8')).toBeLessThanOrEqual(50)
  })

  test('a provider without object support throws (caller falls back)', async () => {
    await expect(
      createModelSummarizer({ modelAlias: modelAliasWith(undefined) }).summarize(
        [fragment],
        { maxBytes: 4000 }
      )
    ).rejects.toThrow()
  })
})

describe('runContextIngestion model → digest fallback', () => {
  test('falls back to the digest when the model summarizer throws', async () => {
    const throwingModel = {
      mode: 'model' as const,
      summarize: async () => {
        throw new Error('provider unavailable')
      }
    }

    const result = await runContextIngestion({
      providers: [{ type: 'changed-files', include: ['**/*.md'], maxFiles: 10, maxFileBytes: 1000 }],
      repositoryRoot: '/repo',
      changedFiles: [{ path: 'a.md', content: 'intent body' }],
      summarizer: throwingModel,
      fallbackSummarizer: createDigestSummarizer(),
      maxBytes: 4000,
      redact: (value) => value
    })

    expect(result.brief?.mode).toBe('digest')
    expect(result.brief?.text).toContain('intent body')
  })
})
