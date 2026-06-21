import type { Logger, ModelAlias, ModelProvider } from '@purista/harness'
import type { ProviderConfig } from '../../shared/contracts/index.js'
import {
  createStructuredError,
  normalizeError
} from '../../shared/errors/error-normalizer.js'

type ProviderId = ProviderConfig['id']

type ProviderFactory = (options: Record<string, unknown>) => ModelProvider

type ProviderAdapterDefinition = {
  readonly providerId: ProviderId
  readonly packageName: string
  readonly factoryName: string
  readonly credentialSources: readonly string[]
}

export type ProviderImport = (specifier: string) => Promise<unknown>

export type ResolveProviderModelAliasOptions = {
  readonly provider: ProviderConfig
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly importProvider?: ProviderImport
  readonly logger?: Logger
}

export type ProviderResolution = {
  readonly providerId: ProviderId
  readonly providerPackage: string
  readonly modelAlias: ModelAlias
}

const providerAdapters = {
  openai: {
    providerId: 'openai',
    packageName: '@purista/harness-openai',
    factoryName: 'openai',
    credentialSources: ['OPENAI_API_KEY']
  },
  'openai-compatible': {
    providerId: 'openai-compatible',
    packageName: '@purista/harness-openai',
    factoryName: 'openai',
    credentialSources: ['OPENAI_API_KEY']
  },
  bedrock: {
    providerId: 'bedrock',
    packageName: '@purista/harness-bedrock',
    factoryName: 'bedrock',
    credentialSources: ['AWS_REGION', 'AWS credential chain']
  },
  azure: {
    providerId: 'azure',
    packageName: '@purista/harness-azure-foundry',
    factoryName: 'azureFoundry',
    credentialSources: ['AZURE_AI_ENDPOINT', 'AZURE_AI_API_KEY']
  }
} satisfies Record<ProviderId, ProviderAdapterDefinition>

const defaultImportProvider: ProviderImport = (specifier) => import(specifier)

const environmentValue = (
  environment: Readonly<Record<string, string | undefined>>,
  key: string
): string | undefined => {
  const value = environment[key]

  return value === undefined || value.trim().length === 0 ? undefined : value
}

const isMissingModuleError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'ERR_MODULE_NOT_FOUND'

const assertCredentialSources = (
  definition: ProviderAdapterDefinition,
  environment: Readonly<Record<string, string | undefined>>
): void => {
  for (const credentialSource of definition.credentialSources) {
    if (credentialSource === 'AWS credential chain') {
      continue
    }

    if (environmentValue(environment, credentialSource) === undefined) {
      throw createStructuredError({
        code: 'provider_credentials_missing',
        message: `Provider credential source "${credentialSource}" is required.`,
        category: 'config',
        recoverable: true,
        exitCode: 2,
        details: {
          provider: definition.providerId,
          credentialSource
        }
      })
    }
  }
}

const assertProviderConfig = (provider: ProviderConfig): void => {
  if (provider.id === 'openai-compatible' && provider.baseUrl === undefined) {
    throw createStructuredError({
      code: 'provider_base_url_missing',
      message: 'Provider "openai-compatible" requires provider.baseUrl.',
      category: 'config',
      recoverable: true,
      exitCode: 2,
      details: {
        provider: provider.id
      }
    })
  }
}

const getFactory = (
  adapterModule: unknown,
  definition: ProviderAdapterDefinition
): ProviderFactory => {
  if (
    typeof adapterModule === 'object' &&
    adapterModule !== null &&
    definition.factoryName in adapterModule
  ) {
    const factory = adapterModule[definition.factoryName as keyof typeof adapterModule]

    if (typeof factory === 'function') {
      return factory as ProviderFactory
    }
  }

  throw createStructuredError({
    code: 'provider_adapter_invalid',
    message: `Provider adapter "${definition.packageName}" does not export "${definition.factoryName}".`,
    category: 'config',
    recoverable: true,
    exitCode: 2,
    details: {
      provider: definition.providerId,
      packageName: definition.packageName,
      factoryName: definition.factoryName
    }
  })
}

const createProviderOptions = (
  provider: ProviderConfig,
  environment: Readonly<Record<string, string | undefined>>
): Record<string, unknown> => {
  if (provider.id === 'bedrock') {
    return {
      region: environmentValue(environment, 'AWS_REGION'),
      harnessTimeoutMs: provider.timeoutMs
    }
  }

  if (provider.id === 'azure') {
    return {
      endpoint: environmentValue(environment, 'AZURE_AI_ENDPOINT'),
      apiKey: environmentValue(environment, 'AZURE_AI_API_KEY'),
      harnessTimeoutMs: provider.timeoutMs
    }
  }

  return {
    apiKey: environmentValue(environment, 'OPENAI_API_KEY'),
    ...(provider.baseUrl === undefined ? {} : { baseURL: provider.baseUrl }),
    api: 'responses',
    harnessTimeoutMs: provider.timeoutMs
  }
}

const modelSupportsTemperatureDefault = (provider: ProviderConfig): boolean =>
  provider.id !== 'openai' || !/^gpt-5(?:-|$)/iu.test(provider.model)

const createModelAlias = (
  provider: ProviderConfig,
  modelProvider: ModelProvider
): ModelAlias => ({
  provider: modelProvider,
  model: provider.model,
  capabilities: ['object', 'tool_use'],
  // Retry is handled by the harness model retry policy, which classifies
  // failures (transient/network/timeout/rate-limit/5xx are retried; oversized
  // context, auth, and payment are not), honors `Retry-After`, and fails fast
  // (`longRetry: 'error'`) when a provider asks us to wait longer than the cap.
  retry: {
    maxAttempts: provider.maxRetries + 1,
    minDelayMs: provider.retryBackoffMs,
    maxActiveDelayMs: provider.retryMaxDelayMs,
    longRetry: 'error'
  },
  defaults: {
    ...(modelSupportsTemperatureDefault(provider)
      ? { temperature: provider.temperature }
      : {}),
    ...(provider.maxOutputTokens === undefined
      ? {}
      : { maxTokens: provider.maxOutputTokens })
  }
})

export const resolveProviderModelAlias = async (
  options: ResolveProviderModelAliasOptions
): Promise<ProviderResolution> => {
  const environment = options.environment ?? process.env
  const importProvider = options.importProvider ?? defaultImportProvider
  const definition = providerAdapters[options.provider.id]

  options.logger?.debug('Provider config validation started.', {
    provider_id: options.provider.id,
    model: options.provider.model
  })
  assertProviderConfig(options.provider)
  assertCredentialSources(definition, environment)
  options.logger?.debug('Provider config validation completed.', {
    provider_id: definition.providerId,
    auth_source_count: definition.credentialSources.length
  })

  let adapterModule: unknown

  try {
    options.logger?.debug('Provider adapter import started.', {
      provider_id: definition.providerId,
      adapter_package: definition.packageName
    })
    adapterModule = await importProvider(definition.packageName)
    options.logger?.debug('Provider adapter import completed.', {
      provider_id: definition.providerId,
      adapter_package: definition.packageName
    })
  } catch (error) {
    if (isMissingModuleError(error)) {
      throw createStructuredError({
        code: 'provider_adapter_missing',
        message: `Provider adapter "${definition.packageName}" is not installed. Install it with: npm install ${definition.packageName}`,
        category: 'config',
        recoverable: true,
        exitCode: 2,
        details: {
          provider: definition.providerId,
          packageName: definition.packageName
        }
      })
    }

    throw normalizeError(error, {
      source: 'provider',
      operation: 'import_provider_adapter',
      details: {
        provider: definition.providerId,
        packageName: definition.packageName
      }
    })
  }

  try {
    options.logger?.debug('Provider adapter factory lookup started.', {
      provider_id: definition.providerId,
      adapter_package: definition.packageName,
      factory_name: definition.factoryName
    })
    const factory = getFactory(adapterModule, definition)
    options.logger?.debug('Provider adapter creation started.', {
      provider_id: definition.providerId,
      adapter_package: definition.packageName,
      model: options.provider.model
    })
    const modelProvider = factory(createProviderOptions(options.provider, environment))
    options.logger?.debug('Provider adapter creation completed.', {
      provider_id: definition.providerId,
      adapter_package: definition.packageName,
      model: options.provider.model
    })

    return {
      providerId: definition.providerId,
      providerPackage: definition.packageName,
      modelAlias: createModelAlias(options.provider, modelProvider)
    }
  } catch (error) {
    throw normalizeError(error, {
      source: 'provider',
      operation: 'create_provider_adapter',
      details: {
        provider: definition.providerId,
        packageName: definition.packageName
      }
    })
  }
}
