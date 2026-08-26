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

// A short, explicit set of field names the key pattern would otherwise refuse,
// each paired with the ONLY value type it may carry. The same exemption the
// no-content recorder makes for `inputTokens`/`outputTokens`, in the snake_case
// spellings the log call sites actually emit.
//
// This is not a loosening of the guard. The pattern asks "could this key name a
// place content hides?", which is the right question for a free-form name and the
// wrong one for `input_tokens`: a count of tokens is a number, and a number of
// tokens discloses nothing about which tokens. `adjudication_requested` is the
// same shape one step further — it trips on "request" while carrying a boolean
// saying whether adjudication was asked for, never anything that was requested.
// Because the pattern could not tell those apart, spec 07's required run-log
// counts were deleted from every line that carried them.
//
// Two properties keep this safe, and both are load-bearing:
//   - membership is by EXACT key, never by pattern, so no new name is admitted by
//     resembling one of these;
//   - an admitted key still has to carry its declared primitive type. A string
//     parked under `input_tokens` is refused exactly as before, so the exemption
//     cannot become a channel by changing the value's type.
const exemptLogKeyValueTypes: ReadonlyMap<string, 'number' | 'boolean'> = new Map([
  ['input_tokens', 'number'],
  ['output_tokens', 'number'],
  ['adjudication_requested', 'boolean']
])

const isExemptLogField = (key: string, value: unknown): boolean =>
  exemptLogKeyValueTypes.get(key) === typeof value

// What replaces a value refused by the key pattern. The KEY is kept and only the
// value is replaced, rather than the pair being removed: a removed pair vanishes
// without trace, so a reader of the line cannot tell a field that was withheld
// from one the caller never emitted — which is the same silent-absence shape the
// redaction rules exist to prevent, turned on the redactor itself. Nothing about
// the value is disclosed, so the guarantee is unchanged.
//
// Deliberately worded without any term the pattern itself matches, so the marker
// can never be mistaken for the thing it replaced.
const droppedByKeyName = '[dropped: field name is not log-safe]'

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
  if (forbiddenLogKeyPattern.test(key) && !isExemptLogField(key, value)) {
    return droppedByKeyName
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
