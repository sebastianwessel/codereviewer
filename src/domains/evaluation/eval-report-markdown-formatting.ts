import { type EvalRegressionGateOutcome } from './eval-report-contracts.js'
import {
  type PrecisionBracket,
  type PrecisionBracketBound
} from './eval-precision-bracket.js'

export type EvalCostMetricInput = {
  readonly costUnavailableCount: number
  readonly costUsd: number
}

export type EvalDurationMetricInput = {
  readonly durationUnavailableCount: number
  readonly durationMs: number
}

export type EvalTokenMetricInput = {
  readonly usageUnavailableCount: number
}

// A value the report never recorded. Rendered, never defaulted: a counter added
// by a later engine build is absent from an older report, and printing 0 there
// would claim a measurement nobody made. Declared once so every renderer that
// has to say "the report is silent here" says it with the same words.
export const UNKNOWN_VALUE = 'unknown (not recorded)'

export const formatPercent = (value: number): string =>
  `${(value * 100).toFixed(1)}%`

// Deltas between two runs carry an explicit `+` because a reader scanning a
// comparison column needs the direction before the magnitude; a negative number
// already carries its own sign.
export const formatPercentagePointDelta = (
  base: number,
  head: number
): string => {
  const delta = (head - base) * 100
  const sign = delta > 0 ? '+' : ''

  return `${sign}${delta.toFixed(1)}pp`
}

export const formatNumberDelta = (base: number, head: number): string => {
  const delta = head - base
  const sign = delta > 0 ? '+' : ''

  return `${sign}${delta}`
}

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

export const formatCurrency = (value: number): string =>
  value === 0 ? '$0.00' : `$${value.toFixed(4)}`

export const formatInteger = (value: number): string =>
  value.toLocaleString('en-US')

// A total summed over only the cases that reported one is not an exact total,
// and must not be printed as though it were. The suffix is what a reader needs
// to know the figure is a floor rather than the run's actual spend.
export const formatCostMetric = (metrics: EvalCostMetricInput): string =>
  metrics.costUnavailableCount === 0
    ? formatCurrency(metrics.costUsd)
    : `${formatCurrency(metrics.costUsd)} known; unavailable for ${metrics.costUnavailableCount} case(s)`

// Summed review time, disclosed on the same terms as cost above: a case that
// never produced a review report contributed no duration, and the total says so.
export const formatDurationMetric = (
  metrics: EvalDurationMetricInput
): string =>
  metrics.durationUnavailableCount === 0
    ? formatDuration(metrics.durationMs)
    : `${formatDuration(metrics.durationMs)} known; unavailable for ${metrics.durationUnavailableCount} case(s)`

// The gate's three outcomes, spelled out. `NOT EVALUABLE` is deliberately not a
// synonym for either of the other two: it says the gate could not decide, which
// is the honest answer when a threshold is compared against a known-only total.
export const formatEvalGateOutcome = (
  outcome: EvalRegressionGateOutcome
): string => {
  switch (outcome) {
    case 'passed':
      return 'PASS'
    case 'failed':
      return 'FAIL'
    default:
      return 'NOT EVALUABLE'
  }
}

// A token total summed over only the cases that surfaced a usage record,
// disclosed on the same terms as cost and duration above. Same suffix wording on
// purpose: a reader learns one convention for "this figure is a floor".
export const formatTokenMetric = (
  tokens: number,
  metrics: EvalTokenMetricInput
): string =>
  metrics.usageUnavailableCount === 0
    ? formatInteger(tokens)
    : `${formatInteger(tokens)} known; unavailable for ${metrics.usageUnavailableCount} case(s)`

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
      return UNKNOWN_VALUE
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
