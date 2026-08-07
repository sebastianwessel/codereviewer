import { describe, expect, test } from 'vitest'
import {
  isReviewTaskExecutionError,
  runQueuedReviewTasks
} from './task-queue.js'
import { type WorkflowReviewTask } from './agent-contracts.js'

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
