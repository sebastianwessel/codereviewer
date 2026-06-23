import { describe, expect, test } from 'vitest'
import {
  isReviewTaskExecutionError,
  runQueuedReviewTasks
} from './workflow-task-queue.js'
import { type WorkflowReviewTask } from './model-agent-contracts.js'

const task = (id: string, priority: number): WorkflowReviewTask => ({
  id: `task_${id}`,
  kind: 'file',
  round: 1,
  paths: [`src/${id}.ts`],
  factIds: [],
  evidenceIds: [],
  candidateIds: [],
  contextEntryIds: [],
  reviewContext: [],
  priority
})

describe('workflow task queue', () => {
  test('runs queued tasks in deterministic order with live shared digest snapshots', async () => {
    const calls: string[] = []
    const events: string[] = []

    const result = await runQueuedReviewTasks({
      tasks: [task('b', 1), task('a', 0)],
      maxConcurrentTasks: 1,
      sharedDigest: () => `digest-${calls.length}`,
      onTaskEvent: (event) => {
        events.push(
          `${event.id}:${event.state}:${event.workerId ?? '-'}:${event.message ?? '-'}`
        )
      },
      runTask: async (queuedTask, sharedDigest) => {
        calls.push(`${queuedTask.id}:${sharedDigest}`)

        return queuedTask.id
      }
    })

    expect(result.results).toEqual(['task_a', 'task_b'])
    expect(calls).toEqual(['task_a:digest-0', 'task_b:digest-1'])
    expect(events).toEqual([
      'task_a:planned:-:-',
      'task_b:planned:-:-',
      'task_a:running:worker-1:-',
      'task_a:completed:worker-1:worker completed',
      'task_b:running:worker-1:-',
      'task_b:completed:worker-1:worker completed'
    ])
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
