import { readFile } from 'node:fs/promises'
import { resolveExistingPathInsideRoot } from '../../platform/path-service.js'
import {
  CodeReviewerConfigSchema,
  type CodeReviewerConfig
} from '../../shared/contracts/index.js'
import {
  createStructuredError,
  isFileNotFoundError
} from '../../shared/errors/error-normalizer.js'
import { applyConfiguredSecretRedaction } from './secret-redaction.js'

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
type JsonObject = {
  readonly [key: string]: JsonValue
}

type EnvironmentSource = Readonly<Record<string, string | undefined>>

type ConfigLoaderOptions = {
  readonly repositoryRoot: string
  readonly configPath?: string
  readonly environment?: EnvironmentSource
  readonly cliConfig?: JsonObject
  readonly loadDotEnv?: boolean
}

type LoadedConfig = {
  readonly config: CodeReviewerConfig
  readonly environment: EnvironmentSource
  readonly warnings: readonly string[]
  // True when the user explicitly provided baseline settings (file/env/CLI),
  // so a missing baseline file should be reported rather than silently ignored.
  readonly baselineExplicitlyConfigured: boolean
}

const defaultReviewConfigPath = '.codereviewer/config.json'
const defaultEnvPath = '.env'

const configPathEnvKey = 'CODEREVIEWER_CONFIG_PATH'

const prototypePollutionKeys = new Set(['__proto__', 'constructor', 'prototype'])

const assertSafeConfigKey = (key: string): void => {
  if (prototypePollutionKeys.has(key)) {
    throw new TypeError(`Unsupported configuration key: ${key}`)
  }
}

const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const mergeJsonObjects = (left: JsonObject, right: JsonObject): JsonObject => {
  const merged: Record<string, JsonValue> = { ...left }

  for (const [key, rightValue] of Object.entries(right)) {
    assertSafeConfigKey(key)
    const leftValue = merged[key]

    if (isJsonObject(leftValue) && isJsonObject(rightValue)) {
      merged[key] = mergeJsonObjects(leftValue, rightValue)
    } else {
      merged[key] = rightValue
    }
  }

  return merged
}

const rejectPollutionKeysReviver = (key: string, value: unknown): unknown => {
  // The reviver is invoked for every key, including `__proto__`, which
  // `JSON.parse` would otherwise apply as the object prototype rather than an
  // own-enumerable key. Rejecting here turns prototype-pollution attempts into a
  // clear configuration error instead of silently dropped input.
  assertSafeConfigKey(key)
  return value
}

const parseJsonObject = (content: string): JsonObject => {
  const parsed: unknown = JSON.parse(content, rejectPollutionKeysReviver)

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('Config file must contain a JSON object.')
  }

  return parsed as JsonObject
}

// A config file that is absent means two different things, and reading them the
// same way is what makes the second one dangerous.
//
// At the DEFAULT path, absence is the ordinary case: most repositories have no
// config file and the defaults are the intended settings. At a path the user
// NAMED -- `--config <path>` or `CODEREVIEWER_CONFIG_PATH` -- absence is a
// mistake, and continuing on defaults runs a review with settings nobody asked
// for while reporting success. This project has already paid for exactly that:
// an A/B whose config flag never reached the run cost roughly $11.50 to compare
// a build against itself, and the run exited 0 throughout.
//
// So a requested path that does not exist is a `config` error, and the default
// path that does not exist is a warning.
const readConfigFile = async (
  repositoryRoot: string,
  configPath: string,
  requestedExplicitly: boolean
): Promise<JsonObject | undefined> => {
  try {
    return parseJsonObject(
      await readFile(
        await resolveExistingPathInsideRoot(repositoryRoot, configPath),
        'utf8'
      )
    )
  } catch (error) {
    if (isFileNotFoundError(error)) {
      if (requestedExplicitly) {
        throw createStructuredError({
          code: 'config_error',
          message: `The configuration file "${configPath}" does not exist. It was requested explicitly, so the run stops here rather than continuing on default settings.`,
          category: 'config',
          details: { configPath }
        })
      }

      return undefined
    }

    throw error
  }
}

const readOptionalTextFile = async (
  repositoryRoot: string,
  requestedPath: string
): Promise<string | undefined> => {
  try {
    return await readFile(
      await resolveExistingPathInsideRoot(repositoryRoot, requestedPath),
      'utf8'
    )
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return undefined
    }

    throw error
  }
}

const setNestedValue = (
  target: Record<string, JsonValue>,
  path: readonly string[],
  value: JsonValue
): void => {
  const [head, ...tail] = path

  if (head === undefined) {
    return
  }

  if (tail.length === 0) {
    target[head] = value
    return
  }

  const existing = target[head]
  const next =
    typeof existing === 'object' && existing !== null && !Array.isArray(existing)
      ? { ...existing }
      : {}

  target[head] = next
  setNestedValue(next, tail, value)
}

const envValue = (environment: EnvironmentSource, key: string): string | undefined => {
  const value = environment[key]
  return value === undefined || value.length === 0 ? undefined : value
}

const parseBooleanEnv = (key: string, value: string): boolean => {
  if (value === 'true') {
    return true
  }

  if (value === 'false') {
    return false
  }

  throw new TypeError(`${key} must be "true" or "false".`)
}

const parseNumberEnv = (key: string, value: string): number => {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${key} must be a finite number.`)
  }

  return parsed
}

const parseHeadersEnv = (key: string, value: string): JsonObject => {
  const parsed: unknown = JSON.parse(value)

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    !Object.values(parsed).every((headerValue) => typeof headerValue === 'string')
  ) {
    throw new TypeError(`${key} must be a JSON object with string values.`)
  }

  return parsed as JsonObject
}

const parseDotEnv = (content: string): EnvironmentSource => {
  const parsed: Record<string, string> = {}
  const lines = content.split(/\r?\n/u)

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim()

    if (line.length === 0 || line.startsWith('#')) {
      continue
    }

    const separatorIndex = line.indexOf('=')

    if (separatorIndex <= 0) {
      throw new TypeError(`Invalid .env line ${index + 1}.`)
    }

    const key = line.slice(0, separatorIndex).trim()
    const rawValue = line.slice(separatorIndex + 1).trim()

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
      throw new TypeError(`Invalid .env line ${index + 1}.`)
    }

    parsed[key] = rawValue.replace(/^"|"$/gu, '').replace(/^'|'$/gu, '')
  }

  return parsed
}

const configFromEnvironment = (environment: EnvironmentSource): JsonObject => {
  const config: Record<string, JsonValue> = {}
  const stringMappings: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['CODEREVIEWER_REVIEW_MODE', ['review', 'mode']],
    ['CODEREVIEWER_REVIEW_DEPTH', ['review', 'depth']],
    ['CODEREVIEWER_BASE_REF', ['review', 'baseRef']],
    ['CODEREVIEWER_HEAD_REF', ['review', 'headRef']],
    ['CODEREVIEWER_PROVIDER_ID', ['provider', 'id']],
    ['CODEREVIEWER_PROVIDER_MODEL', ['provider', 'model']],
    ['CODEREVIEWER_PROVIDER_BASE_URL', ['provider', 'baseUrl']],
    ['CODEREVIEWER_PROVIDER_REASONING_EFFORT', ['provider', 'reasoningEffort']],
    // Pins the eval judges' model apart from the reviewer's. Deliberately its
    // own variable rather than a suffix on the provider one: a model comparison
    // sets `CODEREVIEWER_PROVIDER_MODEL` per arm and must be able to hold this
    // one FIXED across those arms.
    ['CODEREVIEWER_JUDGE_MODEL', ['evaluation', 'judgeModel']],
    ['CODEREVIEWER_ARTIFACT_DIR', ['paths', 'artifactDir']],
    [
      'CODEREVIEWER_AI_DETERMINISTIC_SIGNAL_MODE',
      ['aiReview', 'deterministicSignalMode']
    ],
    ['CODEREVIEWER_LOG_LEVEL', ['observability', 'logging', 'level']],
    ['CODEREVIEWER_OPENTELEMETRY_ENDPOINT', ['observability', 'openTelemetry', 'endpoint']]
  ]

  for (const [key, path] of stringMappings) {
    const value = envValue(environment, key)
    if (value !== undefined) {
      setNestedValue(config, path, value)
    }
  }

  const openTelemetryEnabled = envValue(environment, 'CODEREVIEWER_OPENTELEMETRY_ENABLED')
  if (openTelemetryEnabled !== undefined) {
    setNestedValue(
      config,
      ['observability', 'openTelemetry', 'enabled'],
      parseBooleanEnv('CODEREVIEWER_OPENTELEMETRY_ENABLED', openTelemetryEnabled)
    )
  }

  const openTelemetryHeaders = envValue(environment, 'CODEREVIEWER_OPENTELEMETRY_HEADERS')
  if (openTelemetryHeaders !== undefined) {
    setNestedValue(
      config,
      ['observability', 'openTelemetry', 'headers'],
      parseHeadersEnv('CODEREVIEWER_OPENTELEMETRY_HEADERS', openTelemetryHeaders)
    )
  }

  const inputPerMillion = envValue(environment, 'CODEREVIEWER_COST_INPUT_PER_MILLION')
  if (inputPerMillion !== undefined) {
    setNestedValue(
      config,
      ['costs', 'inputPerMillion'],
      parseNumberEnv('CODEREVIEWER_COST_INPUT_PER_MILLION', inputPerMillion)
    )
  }

  const cachedInputPerMillion = envValue(
    environment,
    'CODEREVIEWER_COST_CACHED_INPUT_PER_MILLION'
  )
  if (cachedInputPerMillion !== undefined) {
    setNestedValue(
      config,
      ['costs', 'cachedInputPerMillion'],
      parseNumberEnv(
        'CODEREVIEWER_COST_CACHED_INPUT_PER_MILLION',
        cachedInputPerMillion
      )
    )
  }

  const outputPerMillion = envValue(environment, 'CODEREVIEWER_COST_OUTPUT_PER_MILLION')
  if (outputPerMillion !== undefined) {
    setNestedValue(
      config,
      ['costs', 'outputPerMillion'],
      parseNumberEnv('CODEREVIEWER_COST_OUTPUT_PER_MILLION', outputPerMillion)
    )
  }

  const skillsDirectory = envValue(environment, 'CODEREVIEWER_SKILLS_DIR')
  if (skillsDirectory !== undefined) {
    setNestedValue(config, ['skills', 'directories'], [skillsDirectory])
  }

  return config
}

const combinedEnvironment = async (
  repositoryRoot: string,
  environment: EnvironmentSource,
  loadDotEnv: boolean
): Promise<EnvironmentSource> => {
  if (!loadDotEnv) {
    return { ...environment }
  }

  const envFileContent = await readOptionalTextFile(repositoryRoot, defaultEnvPath)
  const fileEnvironment =
    envFileContent === undefined ? {} : parseDotEnv(envFileContent)

  return {
    ...environment,
    ...fileEnvironment
  }
}

const configPathFromEnvironment = (
  environment: EnvironmentSource
): string | undefined => envValue(environment, configPathEnvKey)

export const loadCodeReviewerConfig = async (
  options: ConfigLoaderOptions
): Promise<LoadedConfig> => {
  const environment = await combinedEnvironment(
    options.repositoryRoot,
    options.environment ?? {},
    options.loadDotEnv ?? true
  )
  const requestedConfigPath =
    options.configPath ?? configPathFromEnvironment(environment)
  const configPath = requestedConfigPath ?? defaultReviewConfigPath
  const fileConfig = await readConfigFile(
    options.repositoryRoot,
    configPath,
    requestedConfigPath !== undefined
  )
  const warnings = fileConfig === undefined ? ['config-file-missing'] : []
  const environmentConfig = configFromEnvironment(environment)
  const cliConfig = options.cliConfig ?? {}
  const mergedConfig = mergeJsonObjects(
    mergeJsonObjects(fileConfig ?? {}, environmentConfig),
    cliConfig
  )
  const baselineRaw = mergedConfig.baseline
  const baselineExplicitlyConfigured =
    isJsonObject(baselineRaw) &&
    ('path' in baselineRaw || 'enabled' in baselineRaw)
  const config = CodeReviewerConfigSchema.parse(mergedConfig)

  // The one effect this loader has beyond returning a value, and it is here
  // because this is the only place configuration and environment are both in
  // hand. Redaction is ambient — no seam that redacts takes configuration — so
  // the configured secrets have to be established once, on the path every entry
  // point already takes, rather than by each caller remembering to. A run that
  // loaded configuration and did not apply it would emit artifacts that look
  // redacted and are not.
  applyConfiguredSecretRedaction({ config, environment })

  return {
    config,
    environment,
    warnings,
    baselineExplicitlyConfigured
  }
}
