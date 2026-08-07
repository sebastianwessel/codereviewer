import {
  createReviewTaskQueue,
  type ReviewTaskQueueRecord
} from '../../review-planning/index.js'
import {
  WorkflowTaskEventSchema,
  type WorkflowReviewTask,
  type WorkflowTaskEvent
} from './agent-contracts.js'
import { type DebugLogger } from './debug-logger.js'
import { EMPTY_SHARED_DIGEST } from './shared-digest.js'

export class ReviewTaskExecutionError<R = unknown> extends Error {
  readonly taskEvents: readonly WorkflowTaskEvent[]
  readonly partialResults: readonly R[]
  readonly originalError: unknown

  constructor(input: {
    readonly taskEvents: readonly WorkflowTaskEvent[]
    readonly partialResults: readonly R[]
    readonly originalError: unknown
  }) {
    super('One or more review tasks failed.')
    this.name = 'ReviewTaskExecutionError'
    this.taskEvents = input.taskEvents
    this.partialResults = input.partialResults
    this.originalError = input.originalError
  }
}

export const isReviewTaskExecutionError = (
  error: unknown
): error is ReviewTaskExecutionError =>
  error instanceof ReviewTaskExecutionError

const taskEventFromQueueRecord = (
  record: ReviewTaskQueueRecord<WorkflowReviewTask>
): WorkflowTaskEvent =>
  WorkflowTaskEventSchema.parse({
    id: record.id,
    kind: record.kind,
    round: record.round,
    paths: record.paths,
    state: record.state,
    ...(record.workerId === undefined ? {} : { workerId: record.workerId }),
    ...(record.message === undefined ? {} : { message: record.message })
  })

export const runQueuedReviewTasks = async <R>(
  input: {
    readonly tasks: readonly WorkflowReviewTask[]
    readonly maxConcurrentTasks: number
    readonly logger?: DebugLogger
    readonly runTask: (
      task: WorkflowReviewTask,
      sharedDigest: string
    ) => Promise<R>
    readonly sharedDigest?: () => string
    readonly onTaskEvent?: (event: WorkflowTaskEvent) => void
  }
): Promise<{
  readonly results: readonly R[]
  readonly taskEvents: readonly WorkflowTaskEvent[]
}> => {
  const queue = createReviewTaskQueue(input.tasks)
  const results: R[] = []
  let firstError: unknown
  const emitTaskEvent = (
    record: ReviewTaskQueueRecord<WorkflowReviewTask>
  ): void => {
    input.onTaskEvent?.(taskEventFromQueueRecord(record))
  }

  for (const record of queue.snapshot()) {
    emitTaskEvent(record)
  }

  // A worker that finds nothing to claim waits to be TOLD the queue moved, rather
  // than polling for it. The poll it replaces ran at 1 kHz and rebuilt the queue's
  // whole state from its append-only history on every tick, so every run's tail —
  // where there are fewer remaining tasks than workers — spent the duration of the
  // longest outstanding provider call burning the event loop in 1 ms slices while
  // that provider I/O was in flight.
  //
  // Ordering is what makes this safe: a waiter is registered BEFORE the claim
  // attempt, and nothing between the registration and the wait yields, so any
  // transition is either already visible to that claim or still to come and
  // therefore certain to wake it. Registering after a failed claim would lose the
  // transition that happened in between and hang the worker.
  let queueChangeWaiters: (() => void)[] = []
  const nextQueueChange = (): Promise<void> =>
    new Promise((resolve) => {
      queueChangeWaiters.push(resolve)
    })
  const notifyQueueChanged = (): void => {
    const waiters = queueChangeWaiters

    queueChangeWaiters = []
    for (const wake of waiters) {
      wake()
    }
  }

  input.logger?.debug('Review task queue started.', {
    task_count: input.tasks.length,
    max_concurrent_tasks: input.maxConcurrentTasks
  })

  const runWorker = async (workerIndex: number): Promise<void> => {
    const workerId = `worker-${workerIndex + 1}`

    while (firstError === undefined) {
      // Registered before the claim, see `nextQueueChange`.
      const queueChanged = nextQueueChange()
      const [task] = queue.claimBatch({
        limit: 1,
        workerId
      })

      if (task === undefined) {
        if (!queue.hasOpenTasks()) {
          return
        }

        await queueChanged
        continue
      }

      const claimedRecord = queue.lastRecord()

      if (claimedRecord !== undefined && claimedRecord.id === task.id) {
        emitTaskEvent(claimedRecord)
      }

      input.logger?.debug('Review task claimed.', {
        task_id: task.id,
        task_round: task.round,
        worker_id: workerId,
        completed_task_count: results.length,
        pending_task_count: Math.max(0, input.tasks.length - results.length)
      })

      const sharedDigest = input.sharedDigest?.() ?? EMPTY_SHARED_DIGEST

      try {
        const result = await input.runTask(task, sharedDigest)

        queue.complete(task.id, 'worker completed')
        notifyQueueChanged()
        const completedRecord = queue.lastRecord()

        if (completedRecord !== undefined) {
          emitTaskEvent(completedRecord)
        }
        results.push(result)
        input.logger?.debug('Review task completed.', {
          task_id: task.id,
          task_round: task.round,
          worker_id: workerId,
          completed_task_count: results.length,
          pending_task_count: Math.max(0, input.tasks.length - results.length)
        })
      } catch (error) {
        queue.fail(task.id, 'worker failed')
        firstError ??= error
        // After `firstError` is set, so a waiting worker wakes to a loop
        // condition that is already false and returns instead of claiming
        // another task out of a queue the run has given up on.
        notifyQueueChanged()
        const failedRecord = queue.lastRecord()

        if (failedRecord !== undefined) {
          emitTaskEvent(failedRecord)
        }
        input.logger?.debug('Review task failed.', {
          task_id: task.id,
          task_round: task.round,
          worker_id: workerId,
          completed_task_count: results.length,
          pending_task_count: Math.max(0, input.tasks.length - results.length)
        })
        return
      }
    }
  }

  await Promise.all(
    Array.from({ length: input.maxConcurrentTasks }, (_value, index) =>
      runWorker(index)
    )
  )

  if (firstError !== undefined) {
    input.logger?.debug('Review task queue failed.', {
      completed_task_count: results.length,
      pending_task_count: Math.max(0, input.tasks.length - results.length)
    })

    throw new ReviewTaskExecutionError({
      taskEvents: queue.snapshot().map(taskEventFromQueueRecord),
      partialResults: results,
      originalError: firstError
    })
  }

  input.logger?.debug('Review task queue drained.', {
    completed_task_count: results.length
  })

  return {
    results,
    taskEvents: queue.snapshot().map(taskEventFromQueueRecord)
  }
}
