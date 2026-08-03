import { describe, expect, test } from 'vitest'
import type { TaskDiscoveryTelemetry } from '../../../../shared/contracts/index.js'
import { summarizeDiscoveryTelemetry } from './discovery-telemetry.js'

const telemetry = (
  overrides: Partial<TaskDiscoveryTelemetry> & { readonly taskId: string }
): TaskDiscoveryTelemetry => ({
  callCount: 0,
  rawFindingCount: 0,
  rawFindingsPerCall: [],
  candidateCount: 0,
  droppedCount: 0,
  suppressedByIdCount: 0,
  suppressedByLocationCount: 0,
  cappedByLimitCount: 0,
  contextOverflowSplitCount: 0,
  mergeCallCount: 0,
  mergeGroupCount: 0,
  mergedAwayCount: 0,
  ...overrides
})

describe('summarizeDiscoveryTelemetry', () => {
  test('sums every counter across tasks and keeps the per-task rows', () => {
    const summary = summarizeDiscoveryTelemetry([
      telemetry({
        taskId: 'task_one',
        callCount: 2,
        rawFindingCount: 5,
        rawFindingsPerCall: [3, 2],
        candidateCount: 3,
        droppedCount: 1,
        suppressedByIdCount: 1,
        contextOverflowSplitCount: 1,
        mergeCallCount: 1,
        mergeGroupCount: 1,
        mergedAwayCount: 1
      }),
      telemetry({
        taskId: 'task_two',
        callCount: 1,
        rawFindingCount: 4,
        rawFindingsPerCall: [4],
        candidateCount: 4,
        suppressedByLocationCount: 2
      })
    ])

    expect(summary?.totals).toEqual({
      callCount: 3,
      rawFindingCount: 9,
      // Concatenated, not averaged: the distribution is the measurement.
      rawFindingsPerCall: [3, 2, 4],
      candidateCount: 7,
      droppedCount: 1,
      suppressedByIdCount: 1,
      suppressedByLocationCount: 2,
      cappedByLimitCount: 0,
      contextOverflowSplitCount: 1,
      mergeCallCount: 1,
      mergeGroupCount: 1,
      mergedAwayCount: 1
    })
    expect(summary?.tasks.map((task) => task.taskId)).toEqual([
      'task_one',
      'task_two'
    ])
  })

  test('records nothing at all when no task issued a discovery call', () => {
    // An all-zero record would assert the run looked and found nothing. A run that
    // never looked is a different claim, and pooling the two is how an aggregate
    // starts lying.
    expect(summarizeDiscoveryTelemetry([])).toBeUndefined()
  })
})
