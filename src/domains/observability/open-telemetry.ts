import type { OpenTelemetryConfig } from '../../shared/contracts/index.js'
import { createStructuredError } from '../../shared/errors/error-normalizer.js'

export type OpenTelemetrySetupResult =
  | {
      readonly enabled: false
      readonly warning: 'opentelemetry-disabled'
    }
  | {
      readonly enabled: true
      readonly endpoint: string
      readonly serviceName: string
    }

export type ModuleImporter = (specifier: string) => Promise<unknown>

const defaultImportModule: ModuleImporter = (specifier) => import(specifier)

const isMissingModuleError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'ERR_MODULE_NOT_FOUND'

export const configureOpenTelemetry = async (options: {
  readonly config: OpenTelemetryConfig
  readonly importModule?: ModuleImporter
}): Promise<OpenTelemetrySetupResult> => {
  if (!options.config.enabled) {
    return {
      enabled: false,
      warning: 'opentelemetry-disabled'
    }
  }

  if (options.config.endpoint === undefined) {
    throw createStructuredError({
      code: 'opentelemetry_endpoint_missing',
      message: 'OpenTelemetry endpoint is required when telemetry is enabled.',
      category: 'config',
      recoverable: true,
      exitCode: 2
    })
  }

  const importModule = options.importModule ?? defaultImportModule

  try {
    await Promise.all([
      importModule('@opentelemetry/sdk-trace-node'),
      importModule('@opentelemetry/exporter-trace-otlp-http')
    ])
  } catch (error) {
    if (isMissingModuleError(error)) {
      throw createStructuredError({
        code: 'opentelemetry_dependency_missing',
        message:
          'OpenTelemetry dependencies are not installed. Install @opentelemetry/sdk-trace-node and @opentelemetry/exporter-trace-otlp-http to enable telemetry.',
        category: 'config',
        recoverable: true,
        exitCode: 2,
        details: {
          cause: error instanceof Error ? error.message : String(error)
        }
      })
    }

    throw error
  }

  return {
    enabled: true,
    endpoint: options.config.endpoint,
    serviceName: options.config.serviceName
  }
}

