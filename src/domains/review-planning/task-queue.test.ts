import { describe, expect, test } from 'vitest'
import { createReviewTaskQueue } from './task-queue.js'
import type { ReviewTask } from './task-planner.js'

const task = (
  id: string,
  paths: readonly string[],
  priority: number,
  round = 1
): ReviewTask => ({
  id,
  round,
  kind: 'file',
  paths: [...paths],
  factIds: [],
  evidenceIds: [],
  candidateIds: [],
  contextEntryIds: [],
  priority
})

describe('review task queue', () => {
  test('claims deterministic batches up to the concurrency limit', () => {
    const queue = createReviewTaskQueue([
      task('task_c', ['c.ts'], 2),
      task('task_a', ['a.ts'], 0),
      task('task_b', ['b.ts'], 1)
    ])

    expect(queue.claimBatch({ limit: 2, workerId: 'worker-1' }).map((item) => item.id)).toEqual([
      'task_a',
      'task_b'
    ])
    expect(queue.claimBatch({ limit: 2, workerId: 'worker-2' }).map((item) => item.id)).toEqual([
      'task_c'
    ])
  })

  test('does not claim a later round until the earlier round is completed', () => {
    const queue = createReviewTaskQueue([
      task('task_policy', ['a.ts', 'b.ts'], 0, 2),
      task('task_file', ['a.ts'], 0, 1)
    ])
    const [fileTask] = queue.claimBatch({ limit: 8, workerId: 'worker-1' })

    expect(
      queue.claimBatch({ limit: 8, workerId: 'worker-2' }).map((item) => item.id)
    ).toEqual([])

    queue.complete(fileTask!.id, 'round 1 done')

    expect(
      queue.claimBatch({ limit: 8, workerId: 'worker-2' }).map((item) => item.id)
    ).toEqual(['task_policy'])
  })

  test('can assign distinct worker ids inside one batch', () => {
    const queue = createReviewTaskQueue([
      task('task_a', ['a.ts'], 0),
      task('task_b', ['b.ts'], 1)
    ])

    queue.claimBatch({
      limit: 2,
      workerIdForTask: (_task, index) => `worker-${index + 1}`
    })

    expect(
      queue
        .snapshot()
        .filter((record) => record.state === 'running')
        .map((record) => record.workerId)
    ).toEqual(['worker-1', 'worker-2'])
  })

  test('records append-only task transitions', () => {
    const queue = createReviewTaskQueue([task('task_a', ['a.ts'], 0)])
    const [claimed] = queue.claimBatch({ limit: 1, workerId: 'worker-1' })

    queue.complete(claimed!.id, 'reviewed')

    expect(queue.snapshot().map((record) => record.state)).toEqual([
      'planned',
      'running',
      'completed'
    ])
  })
})
