import type { ReviewTask } from './task-planner.js'

type ReviewTaskQueueState = 'planned' | 'running' | 'completed' | 'failed'

export type ReviewTaskQueueRecord<TTask extends ReviewTask = ReviewTask> =
  TTask & {
    readonly state: ReviewTaskQueueState
    readonly workerId?: string
    readonly message?: string
  }

type ReviewTaskQueue<TTask extends ReviewTask = ReviewTask> = {
  readonly claimBatch: (options: {
    readonly limit: number
    readonly workerId?: string
    readonly workerIdForTask?: (task: TTask, index: number) => string
  }) => readonly TTask[]
  readonly complete: (taskId: string, message?: string) => void
  readonly fail: (taskId: string, message: string) => void
  readonly snapshot: () => readonly ReviewTaskQueueRecord<TTask>[]
  // The most recent transition, which is what a caller emitting one task event
  // per transition actually wants. `snapshot().at(-1)` answers the same question
  // by copying the entire append-only history first — roughly three records per
  // task — and workers ask it on every loop iteration.
  readonly lastRecord: () => ReviewTaskQueueRecord<TTask> | undefined
  // Whether any task is still `planned` or `running`. Answered from the current
  // state rather than by rebuilding it from the whole history.
  readonly hasOpenTasks: () => boolean
}

const sortTasks = <TTask extends ReviewTask>(
  tasks: readonly TTask[]
): readonly TTask[] =>
  [...tasks].sort(
    (left, right) =>
      left.round - right.round ||
      left.priority - right.priority ||
      left.id.localeCompare(right.id)
  )

const taskFromRecord = <TTask extends ReviewTask>(
  record: ReviewTaskQueueRecord<TTask>
): TTask => {
  const { state: _state, workerId: _workerId, message: _message, ...task } = record

  return task as unknown as TTask
}

export const createReviewTaskQueue = <TTask extends ReviewTask>(
  tasks: readonly TTask[]
): ReviewTaskQueue<TTask> => {
  const current = new Map<string, ReviewTaskQueueRecord<TTask>>()
  const history: ReviewTaskQueueRecord<TTask>[] = []

  const record = (
    task: TTask,
    state: ReviewTaskQueueState,
    workerId?: string,
    message?: string
  ): void => {
    const next = {
      ...task,
      state,
      ...(workerId === undefined ? {} : { workerId }),
      ...(message === undefined ? {} : { message })
    }

    current.set(task.id, next)
    history.push(next)
  }

  for (const task of sortTasks(tasks)) {
    record(task, 'planned')
  }

  const transition = (
    taskId: string,
    state: Exclude<ReviewTaskQueueState, 'planned' | 'running'>,
    message?: string
  ): void => {
    const task = current.get(taskId)

    if (task === undefined) {
      throw new TypeError(`Cannot transition missing review task: ${taskId}`)
    }

    record(task, state, task.workerId, message)
  }

  return {
    claimBatch: ({ limit, workerId, workerIdForTask }) => {
      if (!Number.isInteger(limit) || limit < 1) {
        throw new TypeError('limit must be an integer greater than 0.')
      }

      const activeTasks = sortTasks(
        [...current.values()].filter(
          (task) => task.state === 'planned' || task.state === 'running'
        )
      )
      const nextRound = activeTasks[0]?.round
      const plannedTasks = activeTasks.filter(
        (task) => task.state === 'planned'
      )
      const claimed = plannedTasks
        .filter((task) => task.round === nextRound)
        .slice(0, limit)

      for (const [index, task] of claimed.entries()) {
        const taskValue = taskFromRecord(task)
        const assignedWorkerId = workerIdForTask?.(taskValue, index) ?? workerId

        if (assignedWorkerId === undefined || assignedWorkerId.length === 0) {
          throw new TypeError(
            'workerId or workerIdForTask must assign a non-empty worker id.'
          )
        }

        record(taskValue, 'running', assignedWorkerId)
      }

      return claimed.map(taskFromRecord)
    },
    complete: (taskId, message) => {
      transition(taskId, 'completed', message)
    },
    fail: (taskId, message) => {
      transition(taskId, 'failed', message)
    },
    snapshot: () => history.map((record) => ({ ...record })),
    lastRecord: () => {
      const last = history.at(-1)

      // Copied like `snapshot`'s records are, so no caller can reach into the
      // queue's own history through the value it is handed.
      return last === undefined ? undefined : { ...last }
    },
    hasOpenTasks: () =>
      [...current.values()].some(
        (task) => task.state === 'planned' || task.state === 'running'
      )
  }
}
