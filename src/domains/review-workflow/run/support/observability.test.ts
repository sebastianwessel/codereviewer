import { describe, expect, test } from 'vitest'
import { createNoContentEventRecorder } from '../../../observability/index.js'
import type { StructuredError } from '../../../../shared/errors/error-normalizer.js'
import {
  recordObservedError,
  recordObservedTaskEvents
} from './observability.js'

describe('review runner observability helpers', () => {
  test('records task events with only safe task metadata', () => {
    const recorder = createNoContentEventRecorder()

    recordObservedTaskEvents(recorder, [
      {
        id: 'task-a',
        kind: 'file',
        round: 2,
        paths: ['src/app.ts', 'src/lib.ts'],
        state: 'running',
        workerId: 'worker-1',
        message: 'message should not be recorded'
      },
      {
        id: 'task-b',
        kind: 'dependency-cluster',
        round: 1,
        paths: [],
        state: 'planned'
      }
    ])

    const taskEvents = recorder
      .snapshot()
      .events.filter((event) => event.type === 'task-event')

    expect(taskEvents.map((event) => event.attributes)).toEqual([
      {
        taskId: 'task-a',
        kind: 'file',
        round: 2,
        state: 'running',
        pathCount: 2,
        workerId: 'worker-1'
      },
      {
        taskId: 'task-b',
        kind: 'dependency-cluster',
        round: 1,
        state: 'planned',
        pathCount: 0
      }
    ])
  })

  test('records structured errors without detail payloads', () => {
    const recorder = createNoContentEventRecorder()
    const error = {
      code: 'provider_error',
      message: 'Provider failed.',
      category: 'provider',
      recoverable: true,
      exitCode: 2,
      details: {
        prompt: 'must not be recorded'
      }
    } satisfies StructuredError

    recordObservedError(recorder, error)

    expect(recorder.snapshot().events).toEqual([
      expect.objectContaining({
        type: 'run-error',
        errorCode: 'provider_error',
        category: 'provider',
        recoverable: true
      })
    ])
  })
})
