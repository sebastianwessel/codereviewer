import { appendComparisonCountDeltaTable } from './eval-comparison-count-delta-rendering.js'
import { type EvalComparisonReport } from '../../report/eval-comparison-view.js'

export const contextLedgerKindCounts = (
  report: EvalComparisonReport
): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>()

  for (const caseResult of report.caseResults ?? []) {
    for (const entry of caseResult.contextLedger ?? []) {
      counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1)
    }
  }

  return counts
}

export const agenticStageCounts = (
  report: EvalComparisonReport
): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>()

  for (const caseResult of report.caseResults ?? []) {
    for (const entry of caseResult.agenticStages ?? []) {
      // A stage entry without a count is not a zero-count stage. Skipping it
      // keeps the tally free of invented numbers; the stage still appears in
      // the report it came from.
      if (entry.count === undefined) {
        continue
      }

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
