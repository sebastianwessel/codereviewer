import { normalizeError } from '../../../shared/errors/error-normalizer.js'
import {
  createReviewTaskQueue,
  type ReviewTaskQueueRecord
} from '../../review-planning/index.js'
import {
  WorkflowTaskEventSchema,
  type WorkflowReviewTask,
  type WorkflowTaskEvent
} from './agent-contracts.js'
import type { WorkflowLogger } from './debug-logger.js'

export class ReviewTaskExecutionError<R = unknown> extends Error {
  readonly taskEvents: readonly WorkflowTaskEvent[]
  readonly partialResults: readonly R[]
  readonly originalError: unknown
  /**
   * The failures of the OTHER workers that were already in flight, in the order
   * they happened.
   *
   * `originalError` stays the first failure and stays what the run is reported
   * as failing on — that classification is unchanged. What changed is that the
   * concurrent ones are no longer dropped: with N workers running, up to N-1
   * errors used to reach nothing but a `debug` line before the queue gave up, so
   * a run whose workers all failed for the same reason looked, to anyone reading
   * at any level above debug, like a run with exactly one failure.
   *
   * Empty for a single-worker run, and empty whenever only one worker failed.
   */
  readonly additionalErrors: readonly unknown[]

  constructor(input: {
    readonly taskEvents: readonly WorkflowTaskEvent[]
    readonly partialResults: readonly R[]
    readonly originalError: unknown
    readonly additionalErrors?: readonly unknown[]
  }) {
    super('One or more review tasks failed.')
    this.name = 'ReviewTaskExecutionError'
    this.taskEvents = input.taskEvents
    this.partialResults = input.partialResults
    this.originalError = input.originalError
    this.additionalErrors = input.additionalErrors ?? []
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
    readonly logger?: WorkflowLogger
    readonly runTask: (task: WorkflowReviewTask) => Promise<R>
    readonly onTaskEvent?: (event: WorkflowTaskEvent) => void
  }
): Promise<{
  readonly results: readonly R[]
  readonly taskEvents: readonly WorkflowTaskEvent[]
}> => {
  const queue = createReviewTaskQueue(input.tasks)
  const results: R[] = []
  // Every worker failure, in the order they happened. The FIRST is still the one
  // the run fails on; the rest used to be discarded by `firstError ??= error`
  // with nothing above `debug` recording that they had happened at all.
  const taskErrors: unknown[] = []
  // Asked as "has anything failed" rather than "is the first error still
  // undefined", which is the same question except when a task throws `undefined`
  // — where the old form kept claiming tasks after the run had already failed.
  const hasFailed = (): boolean => taskErrors.length > 0
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

    while (!hasFailed()) {
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

      try {
        const result = await input.runTask(task)

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
        // Recorded, not merged: a concurrent worker's failure is a second thing
        // that happened, and the run reports it rather than replacing it with the
        // first one or dropping it.
        taskErrors.push(error)
        // After the failure is recorded, so a waiting worker wakes to a loop
        // condition that is already false and returns instead of claiming
        // another task out of a queue the run has given up on.
        notifyQueueChanged()
        const failedRecord = queue.lastRecord()

        if (failedRecord !== undefined) {
          emitTaskEvent(failedRecord)
        }
        // At `warn`, not `debug`: this is the only line that says WHICH task
        // failed and with what, and at `debug` an operator running at any higher
        // level saw none of it. Deliberately not `error` — the run's terminal
        // failure is logged at `error` by `review-runner.ts`, and raising this
        // one too would report a single failed run as two errors.
        input.logger?.warn('Review task failed.', {
          task_id: task.id,
          task_round: task.round,
          worker_id: workerId,
          // The classified code only. The message is redacted by the normalizer
          // and still not logged: spec 07 puts error CODES in run logs, never
          // provider or tool text.
          error_code: normalizeError(error, { source: 'internal' }).code,
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

  if (hasFailed()) {
    const [firstError, ...additionalErrors] = taskErrors

    input.logger?.warn('Review task queue failed.', {
      completed_task_count: results.length,
      pending_task_count: Math.max(0, input.tasks.length - results.length),
      // How many workers failed, so a reader can tell one failure from several
      // that happened together. The individual codes are on the per-task lines
      // above; this line is what says how many of those to look for.
      failed_task_count: taskErrors.length
    })

    throw new ReviewTaskExecutionError({
      taskEvents: queue.snapshot().map(taskEventFromQueueRecord),
      partialResults: results,
      // Unchanged: the first failure is what the run is reported as failing on.
      originalError: firstError,
      additionalErrors
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
