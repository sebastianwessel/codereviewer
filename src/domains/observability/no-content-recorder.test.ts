import { describe, expect, test } from 'vitest'
import { createNoContentEventRecorder } from './no-content-recorder.js'

describe('no-content event recorder', () => {
  test('records run, step, task, and error events without content fields', () => {
    const recorder = createNoContentEventRecorder()

    recorder.startRun({
      runId: 'run-1',
      mode: 'local',
      prompt: 'do not keep',
      sourceContent: 'do not keep',
      secretKey: 'sk-proj-secret'
    })
    const step = recorder.startStep('repository_intake', {
      changedFileCount: 2,
      rawOutput: 'do not keep'
    })
    step.end({
      skippedFileCount: 1,
      headers: ['do not keep']
    })
    recorder.recordTaskEvent({
      taskId: 'task_a',
      state: 'completed',
      pathCount: 1,
      source: 'do not keep'
    })
    recorder.recordError({
      code: 'provider_error',
      category: 'provider',
      recoverable: true
    })

    const snapshot = recorder.snapshot()
    const serialized = JSON.stringify(snapshot)

    expect(snapshot.events.map((event) => event.type)).toEqual([
      'run-started',
      'step-started',
      'step-ended',
      'task-event',
      'run-error'
    ])
    expect(serialized).toContain('run-1')
    expect(serialized).toContain('changedFileCount')
    expect(serialized).not.toContain('do not keep')
    expect(serialized).not.toContain('sk-proj-secret')
  })
})
