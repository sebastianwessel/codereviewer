import type {
  JsonValue,
  ModelAlias,
  ModelProvider,
  ObjectRequest,
  ObjectResponse
} from '@purista/harness'
import { type RunTokenUsage } from './token-cost.js'

export type ProviderUsageRecorder = {
  readonly modelAlias: ModelAlias
  readonly usage: () => RunTokenUsage
}

/**
 * Wraps a resolved `ModelAlias` so every `text`/`object` request the harness
 * makes through it accumulates token usage. Both the general review
 * (`run/provider/provider-workflow.ts`) and the agentic verification flow reuse
 * this recorder so run cost is accounted for identically regardless of which
 * flow issued the model calls. `cachedInputTokens` is a subset of `inputTokens`
 * (see `token-cost.ts`), so it accumulates the same way, not additively.
 */
export const createProviderUsageRecorder = (
  modelAlias: ModelAlias
): ProviderUsageRecorder => {
  let inputTokens = 0
  let outputTokens = 0
  let cachedInputTokens = 0
  let reasoningTokens = 0
  const provider = modelAlias.provider
  const wrappedProvider: ModelProvider = {
    ...provider,
    id: provider.id,
    genAiSystem: provider.genAiSystem,
    ...(provider.info === undefined ? {} : { info: provider.info }),
    ...(provider.text === undefined
      ? {}
      : {
          text: async (request) => {
            const response = await provider.text!(request)

            inputTokens += response.usage.inputTokens
            outputTokens += response.usage.outputTokens
            cachedInputTokens += response.usage.cachedInputTokens ?? 0
            reasoningTokens += response.usage.reasoningTokens ?? 0

            return response
          }
        }),
    ...(provider.object === undefined
      ? {}
      : {
          object: async <T extends JsonValue = JsonValue>(
            request: ObjectRequest<T>
          ): Promise<ObjectResponse<T>> => {
            const response = await provider.object!(request)

            inputTokens += response.usage.inputTokens
            outputTokens += response.usage.outputTokens
            cachedInputTokens += response.usage.cachedInputTokens ?? 0
            reasoningTokens += response.usage.reasoningTokens ?? 0

            return response
          }
        }),
    ...(provider.textStream === undefined
      ? {}
      : { textStream: provider.textStream.bind(provider) }),
    ...(provider.objectStream === undefined
      ? {}
      : { objectStream: provider.objectStream.bind(provider) }),
    ...(provider.embed === undefined ? {} : { embed: provider.embed.bind(provider) }),
    ...(provider.rerank === undefined
      ? {}
      : { rerank: provider.rerank.bind(provider) }),
    ...(provider.close === undefined ? {} : { close: provider.close.bind(provider) })
  }

  return {
    modelAlias: {
      ...modelAlias,
      provider: wrappedProvider
    },
    usage: () => ({
      inputTokens,
      outputTokens,
      cachedInputTokens,
      reasoningTokens
    })
  }
}
