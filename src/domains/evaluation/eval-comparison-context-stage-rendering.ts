import { appendComparisonCountDeltaTable } from './eval-comparison-count-delta-rendering.js'
import { type EvalReport } from './eval-report-contracts.js'

export const contextLedgerKindCounts = (
  report: EvalReport
): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>()

  for (const caseResult of report.caseResults) {
    for (const entry of caseResult.contextLedger) {
      counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1)
    }
  }

  return counts
}

export const agenticStageCounts = (
  report: EvalReport
): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>()

  for (const caseResult of report.caseResults) {
    for (const entry of caseResult.agenticStages) {
      counts.set(entry.stage, (counts.get(entry.stage) ?? 0) + entry.count)
    }
  }

  return counts
}

export const appendContextLedgerKindDeltas = (
  lines: string[],
  input: {
    readonly base: ReadonlyMap<string, number>
    readonly head: ReadonlyMap<string, number>
  }
): void => {
  appendComparisonCountDeltaTable(lines, {
    heading: '## Context Ledger Kind Deltas',
    labelHeader: 'Kind',
    base: input.base,
    head: input.head,
    includeZeroCountRows: true
  })
}

export const appendAgenticStageDeltas = (
  lines: string[],
  input: {
    readonly base: ReadonlyMap<string, number>
    readonly head: ReadonlyMap<string, number>
  }
): void => {
  appendComparisonCountDeltaTable(lines, {
    heading: '## Agentic Stage Deltas',
    labelHeader: 'Stage',
    base: input.base,
    head: input.head,
    includeZeroCountRows: false
  })
}
