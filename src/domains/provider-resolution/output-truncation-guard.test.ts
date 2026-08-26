import { describe, expect, test } from 'vitest'
import type {
  JsonValue,
  ModelProvider,
  ObjectRequest,
  ObjectResponse,
  TextRequest,
  TextResponse
} from '@purista/harness'
import { guardTruncatedProviderOutput } from './output-truncation-guard.js'

const usage = {
  inputTokens: 100,
  outputTokens: 64,
  totalTokens: 164
}

const providerReturning = (
  finishReason: 'stop' | 'length' | 'tool_calls'
): ModelProvider & { readonly requests: ObjectRequest[] } => {
  const requests: ObjectRequest[] = []

  return {
    id: 'scripted',
    genAiSystem: 'scripted',
    requests,
    async object<T extends JsonValue = JsonValue>(
      request: ObjectRequest<T>
    ): Promise<ObjectResponse<T>> {
      requests.push(request)

      return {
        object: { findings: [{ title: 'partial' }] } as unknown as T,
        finishReason,
        usage
      }
    },
    async text(_request: TextRequest): Promise<TextResponse> {
      return { content: 'partial answer', finishReason, usage }
    }
  }
}

const guard = (provider: ModelProvider): ModelProvider =>
  guardTruncatedProviderOutput({
    provider,
    model: 'test-model',
    maxOutputTokens: 256
  })

const objectRequest: ObjectRequest = {
  model: 'test-model',
  messages: [{ role: 'user', content: 'review this' }],
  schema: { type: 'object' },
  signal: new AbortController().signal
}

describe('provider output truncation guard', () => {
  // The defect this module exists for. A response cut off at the output-token
  // ceiling still parses: the body is a valid, shorter list of findings. Before
  // the guard, that was returned as the complete answer.
  test('rejects an object response that stopped at the output-token limit', async () => {
    const guarded = guard(providerReturning('length'))

    await expect(guarded.object!(objectRequest)).rejects.toMatchObject({
      code: 'provider_output_truncated',
      category: 'provider',
      details: {
        model: 'test-model',
        finishReason: 'length',
        maxOutputTokens: 256,
        outputTokens: 64
      }
    })
  })

  test('rejects a truncated text response the same way', async () => {
    const guarded = guard(providerReturning('length'))

    await expect(
      guarded.text!({
        model: 'test-model',
        messages: [{ role: 'user', content: 'summarize' }],
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({ code: 'provider_output_truncated' })
  })

  // The guard must be invisible on the overwhelming majority of calls, which are
  // the ones that finished normally.
  test('passes a completed response through untouched', async () => {
    const guarded = guard(providerReturning('stop'))
    const response = await guarded.object!(objectRequest)

    expect(response.finishReason).toBe('stop')
    expect(response.object).toEqual({ findings: [{ title: 'partial' }] })
  })

  // A tool-call turn is a normal intermediate state of an agent loop, not a
  // truncation. Failing it would break every tool-using discovery call.
  test('passes a tool-call response through untouched', async () => {
    const guarded = guard(providerReturning('tool_calls'))

    await expect(guarded.object!(objectRequest)).resolves.toMatchObject({
      finishReason: 'tool_calls'
    })
  })

  // Truncation is a property of the response, not of our configuration: a model's
  // own default ceiling cuts a response off just as silently. The message has to
  // say which ceiling it was, because the remedy differs.
  test('reports the model default ceiling when maxOutputTokens is unset', async () => {
    const guarded = guardTruncatedProviderOutput({
      provider: providerReturning('length'),
      model: 'test-model',
      maxOutputTokens: undefined
    })

    await expect(guarded.object!(objectRequest)).rejects.toMatchObject({
      code: 'provider_output_truncated',
      details: { model: 'test-model', outputTokens: 64 }
    })
    await expect(guarded.object!(objectRequest)).rejects.toThrow(
      /No provider\.maxOutputTokens is configured/u
    )
  })

  // Capability detection is by method presence. Defining `text`/`object`
  // unconditionally would advertise operations the delegate cannot perform.
  test('does not advertise methods the wrapped provider lacks', () => {
    const guarded = guard({
      id: 'object-only',
      genAiSystem: 'scripted',
      async object<T extends JsonValue = JsonValue>(): Promise<ObjectResponse<T>> {
        return { object: {} as T, finishReason: 'stop', usage }
      }
    })

    expect(guarded.text).toBeUndefined()
    expect(guarded.embed).toBeUndefined()
    expect(guarded.rerank).toBeUndefined()
    expect(guarded.objectStream).toBeUndefined()
    expect(guarded.object).toBeTypeOf('function')
    expect(guarded.id).toBe('object-only')
    expect(guarded.genAiSystem).toBe('scripted')
  })

  // The wrapper must not swallow the request it was given.
  test('forwards the request to the wrapped provider unchanged', async () => {
    const provider = providerReturning('stop')

    await guard(provider).object!(objectRequest)

    expect(provider.requests).toHaveLength(1)
    expect(provider.requests[0]).toBe(objectRequest)
  })
})
