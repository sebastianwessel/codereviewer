import {
  type PrecisionBracket,
  type PrecisionBracketBound
} from './eval-precision-bracket.js'

export type EvalCostMetricInput = {
  readonly costUnavailableCount: number
  readonly costUsd: number
}

export const formatPercent = (value: number): string =>
  `${(value * 100).toFixed(1)}%`

// A rate computed over an empty denominator is undefined, not zero. Rendering it
// as 0.0% reads as total failure and has been misread that way: lineAccuracy
// shows an empty denominator on any corpus without a `path-line` expectation,
// which includes the whole real-repository corpus.
export const formatRateOverCount = (
  value: number | null,
  checkedCount: number
): string =>
  value === null || checkedCount === 0
    ? 'n/a (0 checked)'
    : `${formatPercent(value)} (${checkedCount} checked)`

export const formatDuration = (durationMs: number): string =>
  durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`

const formatCurrency = (value: number): string =>
  value === 0 ? '$0.00' : `$${value.toFixed(4)}`

export const formatInteger = (value: number): string =>
  value.toLocaleString('en-US')

export const formatCostMetric = (metrics: EvalCostMetricInput): string =>
  metrics.costUnavailableCount === 0
    ? formatCurrency(metrics.costUsd)
    : `${formatCurrency(metrics.costUsd)} known; unavailable for ${metrics.costUnavailableCount} case(s)`

// The precision bracket is rendered as one cell so the two bounds cannot be
// separated in transit. See `eval-precision-bracket.ts` for why the upper bound
// is "not measured" rather than equal to the lower bound when no plausibility
// judge ran.
export const formatPrecisionBound = (bound: PrecisionBracketBound): string => {
  switch (bound.status) {
    case 'known':
      return formatPercent(bound.value)
    case 'not-measured':
      return 'not measured (no plausibility judge)'
    default:
      return 'unknown (not recorded)'
  }
}

export const formatPrecisionBracket = (bracket: PrecisionBracket): string =>
  `${formatPrecisionBound(bracket.lower)} to ${formatPrecisionBound(bracket.upper)}${
    bracket.upper.status === 'known' && !bracket.upperTrustworthy
      ? ' (upper bound untrustworthy)'
      : ''
  }`

export const escapeMarkdownCell = (value: string): string =>
  value.replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ')

export const formatListValue = (values: readonly string[]): string =>
  values.length === 0 ? '-' : values.map(escapeMarkdownCell).join(', ')

export const appendMarkdownTable = (
  lines: string[],
  input: {
    // Omitted when the caller already emitted its own heading, so a table can be
    // nested under a section the caller owns without inventing a second one.
    readonly heading?: string | undefined
    readonly header: string
    readonly alignment: string
    readonly rows: readonly string[]
  }
): void => {
  if (input.rows.length === 0) {
    return
  }

  if (input.heading !== undefined) {
    lines.push(input.heading)
    lines.push('')
  }

  lines.push(input.header)
  lines.push(input.alignment)
  lines.push(...input.rows)
  lines.push('')
}

export const appendMarkdownBulletSection = (
  lines: string[],
  input: {
    readonly heading: string
    readonly rows: readonly string[]
  }
): void => {
  if (input.rows.length === 0) {
    return
  }

  lines.push(input.heading)
  lines.push('')
  lines.push(...input.rows)
  lines.push('')
}
