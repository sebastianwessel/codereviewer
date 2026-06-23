import { createRedactor, type RedactorOptions } from '../redaction/redactor.js'

type ZodLikeIssue = {
  readonly path?: ReadonlyArray<string | number>
  readonly message?: string
}

type ZodLikeError = {
  readonly name: string
  readonly issues: readonly ZodLikeIssue[]
}

// Duck-typed detection avoids depending on a specific Zod instance across
// module boundaries while still recognizing validation failures.
export const isZodError = (value: unknown): value is ZodLikeError =>
  typeof value === 'object' &&
  value !== null &&
  'name' in value &&
  value.name === 'ZodError' &&
  'issues' in value &&
  Array.isArray((value as { issues: unknown }).issues)

// Errno-style filesystem errors expose a string `code` such as `ENOENT`.
export const isFileSystemError = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  'code' in value &&
  typeof (value as { code: unknown }).code === 'string' &&
  /^E[A-Z]+$/u.test((value as { code: string }).code)

const maxSummarizedIssues = 5

// Summarize validation issues by field path and rule message only. The
// submitted value is never included so invalid config cannot echo secrets.
const summarizeZodIssues = (error: ZodLikeError): string => {
  const summaries = error.issues.slice(0, maxSummarizedIssues).map((issue) => {
    const fieldPath =
      issue.path !== undefined && issue.path.length > 0
        ? issue.path.join('.')
        : '(root)'

    return `${fieldPath}: ${issue.message ?? 'invalid value'}`
  })
  const remaining = error.issues.length - summaries.length
  const suffix = remaining > 0 ? `; and ${remaining} more issue(s)` : ''

  return `Configuration is invalid: ${summaries.join('; ')}${suffix}`
}

export type StructuredErrorCategory =
  | 'config'
  | 'repository'
  | 'provider'
  | 'admission'
  | 'report'
  | 'quality-gate'
  | 'internal'

export type ErrorSource =
  | 'config'
  | 'repository'
  | 'provider'
  | 'admission'
  | 'report'
  | 'internal'

export type StructuredErrorDetailValue = string | number | boolean | null

export type StructuredErrorDetails = {
  readonly [key: string]: StructuredErrorDetailValue | StructuredErrorDetailValue[]
}

export type StructuredError = {
  readonly code: string
  readonly message: string
  readonly category: StructuredErrorCategory
  readonly recoverable: boolean
  readonly exitCode: number
  readonly details: StructuredErrorDetails
}

export type NormalizeErrorOptions = RedactorOptions & {
  readonly source?: ErrorSource
  readonly operation?: string
  readonly details?: StructuredErrorDetails
}

// Construct a StructuredError, defaulting `details` to an empty object. Shared
// so domains do not each redefine the same helper.
export const createStructuredError = (
  error: Omit<StructuredError, 'details'> & {
    readonly details?: StructuredError['details']
  }
): StructuredError => ({
  ...error,
  details: error.details ?? {}
})

const defaultMessagesBySource: Readonly<Record<ErrorSource, string>> = {
  config: 'Configuration failed.',
  repository: 'Repository operation failed.',
  provider: 'Provider operation failed.',
  admission: 'Admission failed.',
  report: 'Report operation failed.',
  internal: 'Unexpected internal error.'
}

const exitCodeByCategory: Readonly<Record<StructuredErrorCategory, number>> = {
  config: 2,
  repository: 3,
  provider: 4,
  // A failed quality/drift gate is a meaningful completion signal, not a crash.
  'quality-gate': 1,
  admission: 5,
  report: 5,
  internal: 5
}

const recoverableByCategory: Readonly<Record<StructuredErrorCategory, boolean>> = {
  config: true,
  repository: true,
  provider: true,
  'quality-gate': true,
  admission: false,
  report: false,
  internal: false
}

const isErrorWithMessage = (value: unknown): value is { readonly message: string } =>
  typeof value === 'object' &&
  value !== null &&
  'message' in value &&
  typeof value.message === 'string'

const isStructuredError = (value: unknown): value is StructuredError =>
  typeof value === 'object' &&
  value !== null &&
  'code' in value &&
  'message' in value &&
  'category' in value &&
  'recoverable' in value &&
  'exitCode' in value &&
  'details' in value &&
  typeof value.code === 'string' &&
  typeof value.message === 'string' &&
  typeof value.category === 'string' &&
  typeof value.recoverable === 'boolean' &&
  typeof value.exitCode === 'number' &&
  typeof value.details === 'object' &&
  value.details !== null

const rawMessageFrom = (error: unknown, source: ErrorSource): string => {
  if (isErrorWithMessage(error) && error.message.trim().length > 0) {
    return error.message
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error
  }

  return defaultMessagesBySource[source]
}

const classifyErrorKind = (message: string): 'error' | 'timeout' | 'cancelled' => {
  const lowerCaseMessage = message.toLowerCase()

  if (
    lowerCaseMessage.includes('timeout') ||
    lowerCaseMessage.includes('timed out') ||
    lowerCaseMessage.includes('etimedout')
  ) {
    return 'timeout'
  }

  if (
    lowerCaseMessage.includes('abort') ||
    lowerCaseMessage.includes('cancel') ||
    lowerCaseMessage.includes('interrupt')
  ) {
    return 'cancelled'
  }

  return 'error'
}

// Extract an HTTP-like status code from common provider error shapes
// (`status`, `statusCode`, `response.status`) without relying on a specific SDK.
const httpStatusFrom = (error: unknown): number | undefined => {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }

  const candidate = error as {
    readonly status?: unknown
    readonly statusCode?: unknown
    readonly response?: { readonly status?: unknown }
  }
  const status = candidate.status ?? candidate.statusCode ?? candidate.response?.status

  return typeof status === 'number' ? status : undefined
}

// Finer provider sub-classification from HTTP status and message patterns.
// Returns undefined when nothing specific matches so the generic
// `provider_error` fallback applies. Patterns are matched against an
// already-lowercased message; the raw message is redacted separately.
const providerErrorSubcode = (
  input: {
    readonly status: number | undefined
    readonly lowerCaseMessage: string
  }
): string | undefined => {
  const { status, lowerCaseMessage } = input

  if (
    status === 429 ||
    lowerCaseMessage.includes('rate limit') ||
    lowerCaseMessage.includes('rate-limit') ||
    lowerCaseMessage.includes('overloaded') ||
    lowerCaseMessage.includes('too many requests')
  ) {
    return 'provider_rate_limited'
  }

  if (
    status === 401 ||
    status === 403 ||
    lowerCaseMessage.includes('api key') ||
    lowerCaseMessage.includes('api-key') ||
    lowerCaseMessage.includes('unauthorized') ||
    lowerCaseMessage.includes('forbidden')
  ) {
    return 'provider_auth'
  }

  if (
    lowerCaseMessage.includes('context length') ||
    lowerCaseMessage.includes('maximum context') ||
    lowerCaseMessage.includes('too many tokens') ||
    lowerCaseMessage.includes('context window')
  ) {
    return 'provider_context_length'
  }

  if (status !== undefined && status >= 500 && status <= 599) {
    return 'provider_server_error'
  }

  return undefined
}

const codeFor = (
  input: {
    readonly kind: 'error' | 'timeout' | 'cancelled'
    readonly source: ErrorSource
    readonly status: number | undefined
    readonly lowerCaseMessage: string
  }
): string => {
  const { kind, source } = input

  if (kind === 'timeout') {
    return `${source}_timeout`
  }

  if (kind === 'cancelled') {
    return `${source}_cancelled`
  }

  if (source === 'provider') {
    return (
      providerErrorSubcode({
        status: input.status,
        lowerCaseMessage: input.lowerCaseMessage
      }) ?? 'provider_error'
    )
  }

  if (source === 'internal') {
    return 'unknown_error'
  }

  return `${source}_error`
}

const redactDetails = (
  details: StructuredErrorDetails,
  redact: (value: string) => string
): StructuredErrorDetails =>
  Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      redactDetailValue(value, redact)
    ])
  )

const redactScalarDetailValue = (
  value: StructuredErrorDetailValue,
  redact: (value: string) => string
): StructuredErrorDetailValue => {
  if (typeof value === 'string') {
    return redact(value)
  }

  return value
}

const redactDetailValue = (
  value: StructuredErrorDetails[keyof StructuredErrorDetails],
  redact: (value: string) => string
): StructuredErrorDetails[keyof StructuredErrorDetails] => {
  if (Array.isArray(value)) {
    return value.map((item) => redactScalarDetailValue(item, redact))
  }

  return redactScalarDetailValue(value, redact)
}

export const normalizeError = (
  error: unknown,
  options: NormalizeErrorOptions = {}
): StructuredError => {
  const redactorOptions: RedactorOptions =
    options.exactSecrets === undefined
      ? {}
      : { exactSecrets: options.exactSecrets }
  const redactor = createRedactor(redactorOptions)
  const redact = redactor.redact

  if (isStructuredError(error)) {
    return {
      code: error.code,
      message: redact(error.message),
      category: error.category,
      recoverable: error.recoverable,
      exitCode: error.exitCode,
      details: redactDetails(error.details, redact)
    }
  }

  const source = options.source ?? 'internal'
  const rawMessage = isZodError(error)
    ? summarizeZodIssues(error)
    : rawMessageFrom(error, source)
  const kind = classifyErrorKind(rawMessage)
  const category = source
  const details: StructuredErrorDetails = {
    ...options.details,
    ...(options.operation === undefined ? {} : { operation: options.operation })
  }

  return {
    code: codeFor({
      kind,
      source,
      status: httpStatusFrom(error),
      lowerCaseMessage: rawMessage.toLowerCase()
    }),
    message: redact(rawMessage),
    category,
    recoverable: recoverableByCategory[category],
    exitCode: exitCodeByCategory[category],
    details: redactDetails(details, redact)
  }
}
