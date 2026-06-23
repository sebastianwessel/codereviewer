import {
  appendMarkdownTable,
  escapeMarkdownCell
} from './eval-report-markdown-formatting.js'

const formatNumberDelta = (base: number, head: number): string => {
  const delta = head - base
  const sign = delta > 0 ? '+' : ''

  return `${sign}${delta}`
}

const formatComparisonCountDeltaRow = (
  input: {
    readonly label: string
    readonly baseCount: number
    readonly headCount: number
  }
): string =>
  `| ${escapeMarkdownCell(input.label)} | ${input.baseCount} | ${input.headCount} | ${formatNumberDelta(
    input.baseCount,
    input.headCount
  )} |`

export const appendComparisonCountDeltaTable = (
  lines: string[],
  input: {
    readonly heading: string
    readonly labelHeader: string
    readonly base: ReadonlyMap<string, number>
    readonly head: ReadonlyMap<string, number>
    readonly includeZeroCountRows: boolean
  }
): void => {
  const labels = [...new Set([...input.base.keys(), ...input.head.keys()])]
    .filter(
      (label) =>
        input.includeZeroCountRows ||
        (input.base.get(label) ?? 0) > 0 ||
        (input.head.get(label) ?? 0) > 0
    )
    .sort((left, right) => left.localeCompare(right))

  appendMarkdownTable(lines, {
    heading: input.heading,
    header: `| ${input.labelHeader} | Base | Head | Delta |`,
    alignment: '| --- | ---: | ---: | ---: |',
    rows: labels.map((label) => {
      const baseCount = input.base.get(label) ?? 0
      const headCount = input.head.get(label) ?? 0
      return formatComparisonCountDeltaRow({
        label,
        baseCount,
        headCount
      })
    })
  })
}
