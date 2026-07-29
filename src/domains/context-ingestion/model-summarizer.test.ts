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

  test('invokes a class-based provider as a method, not through a detached reference', async () => {
    // Regression: the summarizer read `provider.object` into a local and called
    // it detached. Provider adapters are CLASSES that reach for `this` (the
    // bundled OpenAI adapter reads `this.options` and `this.client`), so the call
    // threw inside the adapter, `runContextIngestion` swallowed it into the
    // deterministic digest, and the `model` summarization mode — the documented
    // default whenever a provider is configured — never ran at all. A plain
    // object literal cannot catch this; only a `this`-dependent provider can.
    class ClassBasedProvider {
      readonly id = 'class-based'
      readonly genAiSystem = 'scripted'
      private readonly brief = 'Intent: reject expired tokens.'

      async object(): Promise<unknown> {
        // Throws a TypeError when called detached, exactly like a real adapter.
        return {
          object: { brief: this.brief },
          usage: { inputTokens: 5, outputTokens: 3 }
        }
      }
    }

    const modelAlias = {
      model: 'gpt-x',
      provider: new ClassBasedProvider()
    } as unknown as ModelAlias

    const brief = await createModelSummarizer({ modelAlias }).summarize(
      [fragment],
      { maxBytes: 4_000 }
    )

    expect(brief.mode).toBe('model')
    expect(brief.text).toBe('Intent: reject expired tokens.')
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
