import { describe, expect, test } from 'vitest'
import { createStructuredError } from '../../../shared/errors/error-normalizer.js'
import {
  isReviewTaskExecutionError,
  runQueuedReviewTasks
} from './task-queue.js'
import type { WorkflowReviewTask } from './agent-contracts.js'

const task = (id: string, priority: number): WorkflowReviewTask => ({
  id: `task_${id}`,
  kind: 'file',
  round: 1,
  paths: [`src/${id}.ts`],
  factIds: [],
  evidenceIds: [],
  candidateIds: [],
  contextEntryIds: [],
  instructions: [],
  reviewContext: [],
  priority
})

describe('workflow task queue', () => {
  test('runs queued tasks in deterministic round, priority, id order', async () => {
    const calls: string[] = []
    const events: string[] = []

    const result = await runQueuedReviewTasks({
      tasks: [task('b', 1), task('a', 0)],
      maxConcurrentTasks: 1,
      onTaskEvent: (event) => {
        events.push(
          `${event.id}:${event.state}:${event.workerId ?? '-'}:${event.message ?? '-'}`
        )
      },
      runTask: async (queuedTask) => {
        calls.push(queuedTask.id)

        return queuedTask.id
      }
    })

    expect(result.results).toEqual(['task_a', 'task_b'])
    expect(calls).toEqual(['task_a', 'task_b'])
    expect(events).toEqual([
      'task_a:planned:-:-',
      'task_b:planned:-:-',
      'task_a:running:worker-1:-',
      'task_a:completed:worker-1:worker completed',
      'task_b:running:worker-1:-',
      'task_b:completed:worker-1:worker completed'
    ])
  })

  // A worker with nothing to claim used to poll for a change at 1 kHz; it now
  // waits to be told. These two cases are what says the waiting still ends: a
  // later round is gated behind an earlier one (so the free workers genuinely
  // wait), and a failure has to wake them too or the run would never return.
  test('later-round tasks still run once the earlier round drains, with idle workers waiting', async () => {
    const started: string[] = []
    const result = await runQueuedReviewTasks({
      tasks: [
        task('first', 0),
        { ...task('second', 0), id: 'task_second', round: 2 },
        { ...task('third', 1), id: 'task_third', round: 2 }
      ],
      // More workers than round 1 has tasks, so two of them find nothing to claim
      // while the round-1 task is still running and must wait for it.
      maxConcurrentTasks: 3,
      runTask: async (queuedTask) => {
        started.push(queuedTask.id)
        await Promise.resolve()

        return queuedTask.id
      }
    })

    expect(started[0]).toBe('task_first')
    expect([...result.results].sort()).toEqual([
      'task_first',
      'task_second',
      'task_third'
    ])
  })

  test('a failing task releases the workers waiting on the queue', async () => {
    const error = new Error('provider failed')

    // Without a wake on failure, the two workers idling behind round 1 would wait
    // for a change that never comes and this call would never settle.
    await expect(
      runQueuedReviewTasks({
        tasks: [
          task('first', 0),
          { ...task('second', 0), id: 'task_second', round: 2 }
        ],
        maxConcurrentTasks: 3,
        runTask: async () => {
          throw error
        }
      })
    ).rejects.toSatisfy(
      (caught: unknown) =>
        isReviewTaskExecutionError(caught) && caught.originalError === error
    )
  })

  // Every worker that failed is reported. `firstError ??= error` kept the first
  // and dropped the rest entirely, so a run where several workers failed at once
  // was indistinguishable from a run where one did.
  test('keeps the concurrent workers errors instead of discarding them', async () => {
    const failures = new Map([
      ['task_a', new Error('provider failed for a')],
      ['task_b', new Error('provider failed for b')],
      ['task_c', new Error('provider failed for c')]
    ])
    const started: string[] = []
    const releaseAll: (() => void)[] = []
    // Every worker fails, and none of them may fail before the others have
    // claimed: that is what puts more than one failure in flight at once.
    const allStarted = new Promise<void>((resolve) => {
      releaseAll.push(resolve)
    })

    const caught = await runQueuedReviewTasks({
      tasks: [task('a', 0), task('b', 1), task('c', 2)],
      maxConcurrentTasks: 3,
      runTask: async (queuedTask) => {
        started.push(queuedTask.id)

        if (started.length === 3) {
          for (const release of releaseAll) {
            release()
          }
        }
        await allStarted
        throw failures.get(queuedTask.id)
      }
    }).catch((error: unknown) => error)

    expect(isReviewTaskExecutionError(caught)).toBe(true)

    if (!isReviewTaskExecutionError(caught)) {
      return
    }

    // The primary error is unchanged: still the first failure.
    expect(caught.originalError).toBe(failures.get(started[0] ?? ''))
    expect(caught.additionalErrors).toHaveLength(2)
    expect([caught.originalError, ...caught.additionalErrors].sort()).toEqual(
      [...failures.values()].sort()
    )
  })

  test('a single failure carries no additional errors', async () => {
    const caught = await runQueuedReviewTasks({
      tasks: [task('a', 0)],
      maxConcurrentTasks: 1,
      runTask: async () => {
        throw new Error('provider failed')
      }
    }).catch((error: unknown) => error)

    expect(
      isReviewTaskExecutionError(caught) && caught.additionalErrors
    ).toEqual([])
  })

  // At `debug`, the only line naming the failed task produced nothing for an
  // operator running at `warn` — a run's per-task failure detail was invisible
  // at every level above the noisiest one.
  test('reports each task failure at warn, with the task id and the error code', async () => {
    const warnings: { message: string; metadata?: Record<string, unknown> }[] = []
    const logger = {
      debug: () => {},
      warn: (message: string, metadata?: Readonly<Record<string, unknown>>) => {
        warnings.push({ message, ...(metadata === undefined ? {} : { metadata }) })
      }
    }

    await runQueuedReviewTasks({
      tasks: [task('a', 0)],
      maxConcurrentTasks: 1,
      logger,
      runTask: async () => {
        throw createStructuredError({
          code: 'provider_rate_limited',
          message: 'The provider rate limited this call.',
          category: 'provider'
        })
      }
    }).catch(() => undefined)

    const taskFailure = warnings.find(
      (entry) => entry.message === 'Review task failed.'
    )

    // An already-classified failure keeps its own code; an unclassified throw
    // normalizes to `unknown_error` rather than being reported as nothing.
    expect(taskFailure?.metadata).toMatchObject({
      task_id: 'task_a',
      worker_id: 'worker-1',
      error_code: 'provider_rate_limited'
    })
    // The raw provider text never reaches the log line (spec 07).
    expect(JSON.stringify(taskFailure)).not.toContain('rate limited')
    expect(
      warnings.find((entry) => entry.message === 'Review task queue failed.')
        ?.metadata
    ).toMatchObject({ failed_task_count: 1 })
  })

  test('throws execution error with partial results and queue events on task failure', async () => {
    const error = new Error('provider failed')

    await expect(
      runQueuedReviewTasks({
        tasks: [task('a', 0), task('b', 1)],
        maxConcurrentTasks: 1,
        runTask: async (queuedTask) => {
          if (queuedTask.id === 'task_b') {
            throw error
          }

          return queuedTask.id
        }
      })
    ).rejects.toSatisfy(
      (caught: unknown) =>
        isReviewTaskExecutionError(caught) &&
        caught.originalError === error &&
        caught.partialResults.length === 1 &&
        caught.taskEvents.at(-1)?.state === 'failed'
    )
  })
})
