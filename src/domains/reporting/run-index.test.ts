import { describe, expect, test } from 'vitest'
import {
  emptyRunIndex,
  latestRunWithReport,
  maxRunIndexEntries,
  parseRunIndex,
  upsertRunIndexEntry,
  type RunIndexEntry
} from './run-index.js'

const entry = (runId: string, overrides: Partial<RunIndexEntry> = {}): RunIndexEntry => ({
  runId,
  startedAt: '2026-07-20T00:00:00.000Z',
  status: 'completed',
  reportPath: `.codereviewer/runs/${runId}/report.json`,
  ...overrides
})

describe('run index', () => {
  test('places the newest entry first', () => {
    const index = upsertRunIndexEntry(
      upsertRunIndexEntry(emptyRunIndex, entry('run_a')),
      entry('run_b')
    )

    expect(index.runs.map((run) => run.runId)).toEqual(['run_b', 'run_a'])
  })

  test('replaces an earlier entry for the same run', () => {
    const index = upsertRunIndexEntry(
      upsertRunIndexEntry(emptyRunIndex, entry('run_a', { status: 'failed' })),
      entry('run_a', { status: 'completed' })
    )

    expect(index.runs).toHaveLength(1)
    expect(index.runs[0]?.status).toBe('completed')
  })

  test('caps the index and drops the oldest entries', () => {
    const index = Array.from({ length: maxRunIndexEntries + 10 }).reduce<
      ReturnType<typeof upsertRunIndexEntry>
    >(
      (current, _value, position) =>
        upsertRunIndexEntry(current, entry(`run_${position}`)),
      emptyRunIndex
    )

    expect(index.runs).toHaveLength(maxRunIndexEntries)
    expect(index.runs[0]?.runId).toBe(`run_${maxRunIndexEntries + 9}`)
  })

  test('replaces a corrupt or missing index rather than throwing', () => {
    expect(parseRunIndex(undefined)).toEqual(emptyRunIndex)
    expect(parseRunIndex('not json at all')).toEqual(emptyRunIndex)
    expect(parseRunIndex('{"runs":[{"runId":""}]}')).toEqual(emptyRunIndex)
  })

  test('finds the newest run that actually produced a report', () => {
    const index = upsertRunIndexEntry(
      upsertRunIndexEntry(emptyRunIndex, entry('run_old')),
      { runId: 'run_failed', startedAt: '2026-07-20T01:00:00.000Z', status: 'failed' }
    )

    expect(latestRunWithReport(index)?.runId).toBe('run_old')
  })
})
