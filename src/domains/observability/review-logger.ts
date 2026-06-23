import { JsonLogger, type Logger, type LogLevel } from '@purista/harness'
import { z } from 'zod'

export type { Logger } from '@purista/harness'

export const ReviewLogLevelSchema = z.enum([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent'
])

export type ReviewLogLevel = z.infer<typeof ReviewLogLevelSchema>

export type ReviewLogSink = {
  readonly write: (chunk: string) => unknown
}

const forbiddenLogKeyPattern =
  /(?:body|content|credential|env|environment|header|input|key|output|password|prompt|raw|request|response|secret|snippet|token)/iu

const maxStringLength = 500

const noopLogger: Logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => noopLogger
}

const sanitizeLogValue = (key: string, value: unknown): unknown => {
  if (forbiddenLogKeyPattern.test(key)) {
    return undefined
  }

  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (typeof value === 'string') {
    return value.length > maxStringLength
      ? `${value.slice(0, maxStringLength)}...`
      : value
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeLogValue(key, entry))
      .filter((entry) => entry !== undefined)
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message:
        value.message.length > maxStringLength
          ? `${value.message.slice(0, maxStringLength)}...`
          : value.message
    }
  }

  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeLogValue(entryKey, entryValue)
      ] as const)
      .filter((entry): entry is readonly [string, unknown] => entry[1] !== undefined)

    return Object.fromEntries(entries)
  }

  return undefined
}

const sanitizeLogFields = (
  fields: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  const sanitized = sanitizeLogValue('fields', fields ?? {})

  if (
    typeof sanitized !== 'object' ||
    sanitized === null ||
    Array.isArray(sanitized)
  ) {
    return undefined
  }

  return sanitized as Record<string, unknown>
}

const wrapLogger = (logger: Logger): Logger => ({
  trace: (message, fields) => {
    logger.trace(message, sanitizeLogFields(fields))
  },
  debug: (message, fields) => {
    logger.debug(message, sanitizeLogFields(fields))
  },
  info: (message, fields) => {
    logger.info(message, sanitizeLogFields(fields))
  },
  warn: (message, fields) => {
    logger.warn(message, sanitizeLogFields(fields))
  },
  error: (message, fields) => {
    logger.error(message, sanitizeLogFields(fields))
  },
  fatal: (message, fields) => {
    logger.fatal(message, sanitizeLogFields(fields))
  },
  child: (bindings) => wrapLogger(logger.child(sanitizeLogFields(bindings) ?? {}))
})

export const createNoopReviewLogger = (): Logger => noopLogger

export const createReviewLogger = (options: {
  readonly level: ReviewLogLevel
  readonly out?: ReviewLogSink
  readonly bindings?: Record<string, unknown>
}): Logger => {
  if (options.level === 'silent' || options.out === undefined) {
    return noopLogger
  }

  return wrapLogger(
    new JsonLogger({
      level: options.level as LogLevel,
      out: options.out,
      bindings: sanitizeLogFields(options.bindings) ?? {}
    })
  )
}
