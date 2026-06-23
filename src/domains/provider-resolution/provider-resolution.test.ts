import { describe, expect, test } from 'vitest'
import { createReviewLogger } from '../observability/index.js'
import { resolveProviderModelAlias } from './provider-resolution.js'

const fakeProvider = {
  id: 'fake-provider',
  genAiSystem: 'fake'
}

describe('provider resolution', () => {
  test('dynamically imports only the selected OpenAI-compatible adapter', async () => {
    const importedSpecifiers: string[] = []
    let logs = ''

    const resolution = await resolveProviderModelAlias({
      provider: {
        id: 'openai-compatible',
        model: 'local-model',
        baseUrl: 'https://models.example.test/v1',
        temperature: 0,
        timeoutMs: 10_000,
        maxRetries: 1,
        retryBackoffMs: 0,
        retryMaxDelayMs: 0
      },
      environment: {
        OPENAI_API_KEY: 'secret-value'
      },
      logger: createReviewLogger({
        level: 'debug',
        out: {
          write: (chunk) => {
            logs += chunk
          }
        }
      }),
      importProvider: async (specifier) => {
        importedSpecifiers.push(specifier)

        return {
          openai: (options: unknown) => ({
            ...fakeProvider,
            options
          })
        }
      }
    })

    expect(importedSpecifiers).toEqual(['@purista/harness-openai'])
    expect(resolution.providerPackage).toBe('@purista/harness-openai')
    expect(resolution.modelAlias.model).toBe('local-model')
    expect(resolution.modelAlias.capabilities).toEqual(['object', 'tool_use'])
    // Retry is delegated to the harness model retry policy, mapped from config.
    expect(resolution.modelAlias.retry).toEqual({
      maxAttempts: 2,
      minDelayMs: 0,
      maxActiveDelayMs: 0,
      longRetry: 'error'
    })
    expect(resolution.modelAlias.provider).toMatchObject({
      id: 'fake-provider',
      genAiSystem: 'fake'
    })
    expect(logs).toContain('Provider adapter import started.')
    expect(logs).toContain('Provider adapter import completed.')
    expect(logs).toContain('Provider adapter creation completed.')
    expect(logs).toContain('auth_source_count')
    expect(logs).not.toContain('secret-value')
  })

  test('omits unsupported OpenAI GPT-5 temperature defaults', async () => {
    const resolution = await resolveProviderModelAlias({
      provider: {
        id: 'openai',
        model: 'gpt-5-mini',
        temperature: 0,
        timeoutMs: 10_000,
        maxRetries: 1,
        retryBackoffMs: 0,
        retryMaxDelayMs: 0
      },
      environment: {
        OPENAI_API_KEY: 'secret-value'
      },
      importProvider: async () => ({
        openai: (options: unknown) => ({
          ...fakeProvider,
          options
        })
      })
    })

    expect(resolution.modelAlias.defaults).not.toHaveProperty('temperature')
  })

  test('omits temperature for dotted GPT-5 versions and passes reasoning effort', async () => {
    // Regression: `gpt-5.4-mini` (dot separator) previously slipped past the
    // temperature exclusion and triggered an HTTP 400, especially with reasoning.
    const resolution = await resolveProviderModelAlias({
      provider: {
        id: 'openai',
        model: 'gpt-5.4-mini',
        temperature: 0,
        reasoningEffort: 'high',
        timeoutMs: 10_000,
        maxRetries: 1,
        retryBackoffMs: 0,
        retryMaxDelayMs: 0
      },
      environment: {
        OPENAI_API_KEY: 'secret-value'
      },
      importProvider: async () => ({
        openai: (options: unknown) => ({
          ...fakeProvider,
          options
        })
      })
    })

    expect(resolution.modelAlias.defaults).not.toHaveProperty('temperature')
    expect(resolution.modelAlias.defaults?.providerOptions).toEqual({
      reasoning_effort: 'high'
    })
    // The OpenAI adapter must use the Responses API: it is required for reasoning
    // models with function tools, and chat-completions drops reasoning effort.
    expect(
      (resolution.modelAlias.provider as { readonly options?: { readonly api?: string } })
        .options?.api
    ).toBe('responses')
  })

  test('reports an actionable error when the selected adapter package is missing', async () => {
    await expect(
      resolveProviderModelAlias({
        provider: {
          id: 'openai',
          model: 'gpt-5-mini',
          temperature: 0,
          timeoutMs: 10_000,
          maxRetries: 1,
          retryBackoffMs: 0,
          retryMaxDelayMs: 0
        },
        environment: {
          OPENAI_API_KEY: 'secret-value'
        },
        importProvider: async () => {
          throw Object.assign(new Error('Cannot find package'), {
            code: 'ERR_MODULE_NOT_FOUND'
          })
        }
      })
    ).rejects.toMatchObject({
      code: 'provider_adapter_missing',
      category: 'config',
      exitCode: 2,
      message:
        'Provider adapter "@purista/harness-openai" is not installed. Install it with: npm install @purista/harness-openai'
    })
  })

  test('reports missing provider credentials without exposing secret values', async () => {
    await expect(
      resolveProviderModelAlias({
        provider: {
          id: 'azure',
          model: 'gpt-4.1-mini',
          temperature: 0,
          timeoutMs: 10_000,
          maxRetries: 1,
          retryBackoffMs: 0,
          retryMaxDelayMs: 0
        },
        environment: {
          AZURE_AI_ENDPOINT: 'https://azure.example.test'
        },
        importProvider: async () => ({})
      })
    ).rejects.toMatchObject({
      code: 'provider_credentials_missing',
      category: 'config',
      exitCode: 2,
      details: {
        credentialSource: 'AZURE_AI_API_KEY'
      }
    })
  })

  test('rejects OpenAI-compatible providers without a base URL before importing', async () => {
    let importCalled = false

    await expect(
      resolveProviderModelAlias({
        provider: {
          id: 'openai-compatible',
          model: 'local-model',
          temperature: 0,
          timeoutMs: 10_000,
          maxRetries: 1,
          retryBackoffMs: 0,
          retryMaxDelayMs: 0
        },
        environment: {
          OPENAI_API_KEY: 'secret-value'
        },
        importProvider: async () => {
          importCalled = true
          return {}
        }
      })
    ).rejects.toMatchObject({
      code: 'provider_base_url_missing',
      category: 'config',
      exitCode: 2
    })
    expect(importCalled).toBe(false)
  })

  test('normalizes provider timeout-shaped setup errors as provider runtime errors', async () => {
    await expect(
      resolveProviderModelAlias({
        provider: {
          id: 'openai',
          model: 'gpt-5-mini',
          temperature: 0,
          timeoutMs: 10_000,
          maxRetries: 1,
          retryBackoffMs: 0,
          retryMaxDelayMs: 0
        },
        environment: {
          OPENAI_API_KEY: 'secret-value'
        },
        importProvider: async () => ({
          openai: () => {
            throw new Error('provider setup timed out')
          }
        })
      })
    ).rejects.toMatchObject({
      code: 'provider_timeout',
      category: 'provider',
      exitCode: 4
    })
  })
})
