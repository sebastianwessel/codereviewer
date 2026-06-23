export type EvalCostMetricInput = {
  readonly costUnavailableCount: number
  readonly costUsd: number
}

export const formatPercent = (value: number): string =>
  `${(value * 100).toFixed(1)}%`

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

export const escapeMarkdownCell = (value: string): string =>
  value.replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ')

export const formatListValue = (values: readonly string[]): string =>
  values.length === 0 ? '-' : values.map(escapeMarkdownCell).join(', ')

export const appendMarkdownTable = (
  lines: string[],
  input: {
    readonly heading: string
    readonly header: string
    readonly alignment: string
    readonly rows: readonly string[]
  }
): void => {
  if (input.rows.length === 0) {
    return
  }

  lines.push(input.heading)
  lines.push('')
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
