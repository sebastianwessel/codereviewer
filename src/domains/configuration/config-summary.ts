import { redactText } from '../../shared/redaction/redactor.js'
import type { CodeReviewerConfig } from '../../shared/contracts/index.js'

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue | undefined }

const sensitiveKeyPattern = /(authorization|header|token|secret|api.?key|password|credential)/iu

// Keys whose values are network endpoints. Per spec 07 these must be displayed
// by host only (with scheme), never with embedded userinfo, path, or query, so
// credentials carried in a URL never reach a printed config summary.
const endpointKeyPattern = /^(baseurl|endpoint)$/iu

const formatEndpointHostOnly = (value: string): string => {
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}`
  } catch {
    return '[REDACTED]'
  }
}

const redactSummaryValue = (
  value: unknown,
  keyPath: readonly string[] = []
): JsonValue | undefined => {
  if (value === undefined) {
    return undefined
  }

  const key = keyPath.at(-1) ?? ''
  const parentKey = keyPath.at(-2) ?? ''
  const forceRedact = sensitiveKeyPattern.test(key) || parentKey === 'headers'

  if (typeof value === 'string') {
    if (endpointKeyPattern.test(key) && value.length > 0) {
      return formatEndpointHostOnly(value)
    }

    return forceRedact && value.length > 0 ? '[REDACTED]' : redactText(value)
  }

  if (Array.isArray(value)) {
    return value
      .map((item, index) => redactSummaryValue(item, [...keyPath, String(index)]))
      .filter((item): item is JsonValue => item !== undefined)
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactSummaryValue(entryValue, [...keyPath, entryKey])
      ])
    ) as { readonly [key: string]: JsonValue | undefined }
  }

  return typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
    ? value
    : undefined
}

export const createRedactedConfigSummary = (config: CodeReviewerConfig): string =>
  JSON.stringify(redactSummaryValue(config), null, 2)
