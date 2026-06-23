import {
  createReviewTaskQueue,
  type ReviewTaskQueueRecord
} from '../review-planning/index.js'
import {
  WorkflowTaskEventSchema,
  type WorkflowReviewTask,
  type WorkflowTaskEvent
} from './model-agent-contracts.js'

type WorkflowTaskQueueLogger = {
  readonly debug: (
    message: string,
    metadata?: Readonly<Record<string, unknown>>
  ) => void
}

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
    readonly logger?: WorkflowTaskQueueLogger
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

  const hasOpenTasks = (): boolean => {
    const latestByTaskId = new Map(
      queue.snapshot().map((record) => [record.id, record])
    )

    return [...latestByTaskId.values()].some(
      (record) => record.state === 'planned' || record.state === 'running'
    )
  }
  const waitForEligibleTask = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, 1))

  input.logger?.debug('Review task queue started.', {
    task_count: input.tasks.length,
    max_concurrent_tasks: input.maxConcurrentTasks
  })

  const runWorker = async (workerIndex: number): Promise<void> => {
    const workerId = `worker-${workerIndex + 1}`

    while (firstError === undefined) {
      const [task] = queue.claimBatch({
        limit: 1,
        workerId
      })
      const claimedRecord = queue.snapshot().at(-1)

      if (claimedRecord !== undefined && claimedRecord.id === task?.id) {
        emitTaskEvent(claimedRecord)
      }

      if (task === undefined) {
        if (!hasOpenTasks()) {
          return
        }

        await waitForEligibleTask()
        continue
      }

      input.logger?.debug('Review task claimed.', {
        task_id: task.id,
        task_round: task.round,
        worker_id: workerId,
        completed_task_count: results.length,
        pending_task_count: Math.max(0, input.tasks.length - results.length)
      })

      const sharedDigest =
        input.sharedDigest?.() ?? '(no admitted shared context yet)'

      try {
        const result = await input.runTask(task, sharedDigest)

        queue.complete(task.id, 'worker completed')
        const completedRecord = queue.snapshot().at(-1)

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
        const failedRecord = queue.snapshot().at(-1)

        if (failedRecord !== undefined) {
          emitTaskEvent(failedRecord)
        }
        firstError ??= error
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
