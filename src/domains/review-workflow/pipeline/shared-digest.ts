import { type SharedContextEntry } from '../../shared-context/index.js'

const defaultEntryLimit = 12
const defaultMaxSummaryChars = 240
const defaultMaxDigestBytes = 4096

const digestEntryKinds = new Set<SharedContextEntry['kind']>([
  'support-signal-fact',
  'task-state',
  'admitted-finding'
])

const truncateText = (value: string, maxChars: number): string =>
  value.length <= maxChars
    ? value
    : `${value.slice(0, Math.max(0, maxChars - 3))}...`

const byteLength = (value: string): number => Buffer.byteLength(value)

const trimLinesToBudget = (
  lines: readonly string[],
  maxDigestBytes: number
): readonly string[] => {
  const selected = [...lines]

  while (
    selected.length > 1 &&
    byteLength(selected.join('\n')) > maxDigestBytes
  ) {
    selected.shift()
  }

  if (selected.length === 1 && byteLength(selected[0]!) > maxDigestBytes) {
    return [truncateText(selected[0]!, maxDigestBytes)]
  }

  return selected
}

export const renderSharedDigest = (
  entries: readonly SharedContextEntry[],
  options: {
    readonly limit?: number
    readonly maxSummaryChars?: number
    readonly maxDigestBytes?: number
  } = {}
): string => {
  const limit = options.limit ?? defaultEntryLimit
  const maxSummaryChars = options.maxSummaryChars ?? defaultMaxSummaryChars
  const maxDigestBytes = options.maxDigestBytes ?? defaultMaxDigestBytes
  const selected = entries
    .filter((entry) => digestEntryKinds.has(entry.kind))
    .slice(-limit)

  if (selected.length === 0) {
    return '(no admitted shared context yet)'
  }

  return trimLinesToBudget(
    selected.map((entry) => {
      const task = entry.taskId === undefined ? '' : ` task=${entry.taskId}`
      const evidence =
        entry.evidenceIds.length === 0
          ? ''
          : ` evidence=${entry.evidenceIds.length}`

      return `[${entry.kind} source=${entry.source}${task}] ${truncateText(
        entry.summary,
        maxSummaryChars
      )}${evidence}`
    }),
    maxDigestBytes
  ).join('\n')
}
